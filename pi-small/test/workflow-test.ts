/**
 * workflow-test.ts — the staged workflow without a GPU, a container or a model.
 *
 *   node test/workflow-test.ts
 *
 * Covers the validators (with the mistakes small models actually make), the
 * step order, the runner's control flow against a fake environment (accept,
 * nudge, fresh retry with feedback, give up, integration), check.py on tiny
 * workspaces, and the submit tool the plugin registers. The same flow with pi,
 * docker and a scripted model is test/workflow-e2e.ts.
 */

import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildWorkflowTool } from "../lib/workflow-tool.ts";
import { type AgentRun, runWorkflow, type StepDir, type WorkflowEnv } from "../lib/workflow-runner.ts";
import {
	buildPrompt,
	type CheckReport,
	type CheckSpec,
	DEFAULT_CONFIG,
	initialState,
	mergeConfig,
	nextStep,
	renderSpec,
	requiredTokensThrough,
	taskDefinitionErrors,
	type StepFile,
	validateBreakdown,
	validateScenarios,
	validateTaskPlan,
	type WorkflowState,
} from "../lib/workflow.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CHECK = resolve(HERE, "..", "workflow", "check.py");
let passed = 0;
const test = async (name: string, fn: () => void | Promise<void>) => {
	await fn();
	passed++;
	console.log(`PASS  ${name}`);
};

const cfg = DEFAULT_CONFIG;
const sc = (kind: string, title: string) => ({ kind, title: `scenario ${title}`, given: "a store", when: `do ${title}`, then: `see ${title} happen` });
const SIX = [sc("happy", "a"), sc("happy", "b"), sc("happy", "c"), sc("unhappy", "d"), sc("unhappy", "e"), sc("unhappy", "f")];

// ------------------------------------------------------------ validators --

await test("scenarios: valid list gets S ids in order", () => {
	const r = validateScenarios({ scenarios: SIX }, cfg);
	assert.ok(r.ok);
	assert.deepEqual(r.value.map((s) => s.id), ["S1", "S2", "S3", "S4", "S5", "S6"]);
});

await test("scenarios: too few unhappy paths is rejected with a count", () => {
	const r = validateScenarios({ scenarios: SIX.slice(0, 4) }, cfg);
	assert.ok(!r.ok);
	assert.match(r.errors.join("\n"), /at least 3 unhappy-path scenarios, got 1/);
});

await test("scenarios: a stringified array and kind synonyms are accepted", () => {
	const r = validateScenarios({ scenarios: JSON.stringify(SIX.map((s, i) => ({ ...s, kind: i < 3 ? "Positive" : "error" }))) }, cfg);
	assert.ok(r.ok, JSON.stringify(r));
});

await test("scenarios: missing fields and bad kind are each named", () => {
	const r = validateScenarios({ scenarios: [...SIX, { kind: "meh", title: "x" }] }, cfg);
	assert.ok(!r.ok);
	const e = r.errors.join("\n");
	assert.match(e, /scenario 7: kind must be "happy" or "unhappy"/);
	assert.match(e, /scenario 7: "title" is missing or too short/);
	assert.match(e, /scenario 7: "then" is missing/);
});

const ids = ["S1", "S2", "S3"];
const task = (title: string, covers: string[]) => ({ title, goal: `${title} exists and works`, files: [`${title}.py`], covers });

await test("breakdown: every scenario must be covered, unknown ids named", () => {
	const r = validateBreakdown({ tasks: [task("store", ["S1", "S9"]), task("api", ["S2"])] }, cfg, ids);
	assert.ok(!r.ok);
	const e = r.errors.join("\n");
	assert.match(e, /covers unknown scenario "S9"/);
	assert.match(e, /not covered: S3/);
});

await test("breakdown: task count limits and path hygiene", () => {
	const one = validateBreakdown({ tasks: [task("all", ids)] }, cfg, ids);
	assert.ok(!one.ok && /between 2 and 6 tasks, got 1/.test(one.errors.join()));
	const bad = validateBreakdown({ tasks: [{ ...task("alpha", ids), files: ["../etc/passwd"] }, task("beta", [])] }, cfg, ids);
	assert.ok(!bad.ok && /relative path inside the workspace/.test(bad.errors.join()));
	const ok = validateBreakdown({ tasks: [{ ...task("alpha", ["s1", "S2"]), files: ["/workspace/a.py", "./b.py"] }, task("beta", ["S3"])] }, cfg, ids);
	assert.ok(ok.ok);
	assert.deepEqual(ok.value.tasks[0].files, ["a.py", "b.py"]);
	assert.deepEqual(ok.value.tasks[0].covers, ["S1", "S2"]);
	assert.deepEqual(ok.value.tasks.map((t) => t.id), ["T1", "T2"]);
	assert.equal(ok.value.testCommand, undefined, "no test command asked for, none taken");
});

await test("breakdown: a task without a test command makes the model propose one", () => {
	const tasks = [task("alpha", ["S1", "S2"]), task("beta", ["S3"])];
	const none = validateBreakdown({ tasks }, cfg, ids, true);
	assert.ok(!none.ok && /"test_command" is required/.test(none.errors.join()));
	const given = validateBreakdown({ tasks, test_command: "npm test" }, cfg, ids, true);
	assert.ok(given.ok);
	assert.equal(given.value.testCommand, "npm test");
});

await test("task plan: T-scoped ids; logic as a string becomes a list", () => {
	const r = validateTaskPlan({ scenarios: [sc("happy", "x"), sc("unhappy", "y")], logic: "1. a dict of books\n2. validate input" }, cfg, "T2");
	assert.ok(r.ok, JSON.stringify(r));
	assert.deepEqual(r.value.scenarios.map((s) => s.id), ["T2.S1", "T2.S2"]);
	assert.deepEqual(r.value.logic, ["a dict of books", "validate input"]);
	const empty = validateTaskPlan({ scenarios: [sc("happy", "x"), sc("unhappy", "y")], logic: [] }, cfg, "T1");
	assert.ok(!empty.ok && /"logic" needs at least 1/.test(empty.errors.join()));
});

// ----------------------------------------------------------- step order --

function planned(preexisting = false): WorkflowState {
	const s = initialState("Build it.", preexisting, { testCommand: "run-the-tests" });
	s.scenarios = validateScenarios({ scenarios: SIX }, cfg).ok ? (validateScenarios({ scenarios: SIX }, cfg) as any).value : [];
	s.tasks = [
		{ id: "T1", title: "store", goal: "g", files: ["store.py"], covers: ["S1", "S4"], scenarios: [], logic: [], status: "pending" },
		{ id: "T2", title: "api", goal: "g", files: ["app.py"], covers: ["S2", "S3", "S5", "S6"], scenarios: [], logic: [], status: "pending" },
	];
	return s;
}

await test("next step: scenarios, breakdown, all plans before any code, then implement/integrate", () => {
	const s = initialState("x", false);
	assert.deepEqual(nextStep(s), { kind: "scenarios" });
	const p = planned();
	assert.deepEqual(nextStep(p), { kind: "task_plan", taskId: "T1" });
	p.tasks[0].status = "planned";
	assert.deepEqual(nextStep(p), { kind: "task_plan", taskId: "T2" });
	p.tasks[1].status = "planned";
	assert.deepEqual(nextStep(p), { kind: "implement", taskId: "T1" });
	p.tasks[0].status = "implemented"; // T1 has nothing earlier to integrate with
	assert.deepEqual(nextStep(p), { kind: "implement", taskId: "T2" });
	p.tasks[1].status = "implemented";
	assert.deepEqual(nextStep(p), { kind: "integrate", taskId: "T2" });
	p.tasks[1].status = "integrated";
	assert.equal(nextStep(p), null);
});

await test("next step: existing code means T1 is integrated too", () => {
	const p = planned(true);
	p.tasks.forEach((t) => (t.status = "planned"));
	p.tasks[0].status = "implemented";
	assert.deepEqual(nextStep(p), { kind: "integrate", taskId: "T1" });
});

await test("required tokens are cumulative, tokenised, and include integration once due", () => {
	const p = planned();
	p.tasks[0].scenarios = [{ id: "T1.S1", kind: "happy", title: "t", given: "g", when: "w", then: "t" }];
	assert.deepEqual(requiredTokensThrough(p, "T1"), ["S1", "S4", "T1_S1"]);
	assert.deepEqual(requiredTokensThrough(p, "T2", "implement"), ["S1", "S4", "T1_S1", "S2", "S3", "S5", "S6"]);
	assert.deepEqual(requiredTokensThrough(p, "T2", "integrate"), ["S1", "S4", "T1_S1", "S2", "S3", "S5", "S6", "I2"]);
	const pre = planned(true);
	assert.deepEqual(requiredTokensThrough(pre, "T2", "implement"), ["S1", "S4", "I1", "S2", "S3", "S5", "S6"], "T1's integration is due before T2");
});

await test("spec and prompts carry what the next fresh session needs", () => {
	const p = planned();
	p.tasks[0].scenarios = [{ id: "T1.S1", kind: "happy", title: "ids increase", given: "g", when: "w", then: "t" }];
	p.tasks[0].logic = ["a dict"];
	p.tasks[0].status = "planned";
	const spec = renderSpec(p, "T1");
	assert.match(spec, /## Current task: T1 — store/);
	assert.match(spec, /\*\*T1\.S1\*\* \[happy\] ids increase/);
	assert.match(spec, /Whole-task scenarios this task must provide tests for:\n- \*\*S1\*\*/);
	const prompt = buildPrompt(p, { kind: "implement", taskId: "T1" }, cfg, "tests failed");
	assert.match(prompt, /^# Workflow step: implement T1\n/);
	assert.match(prompt, /`test_T2_S1_<what>`/);
	assert.match(prompt, /runs the whole test suite from \/workspace with: `run-the-tests`/);
	assert.doesNotMatch(prompt, /python|unittest|urllib|HTTP|standard library/i, "the harness's own words must not assume a language or a task");
	assert.match(prompt, /## A previous attempt at this step failed\n\ntests failed/);
	assert.match(buildPrompt(p, { kind: "scenarios" }, cfg), /Do not write any code in this step/);
});

await test("task conventions reach every step; the harness adds none of its own", () => {
	const p = planned();
	p.profile.conventions = "Tests use node:test in tests/*.test.ts.";
	for (const step of [{ kind: "scenarios" }, { kind: "breakdown" }, { kind: "task_plan", taskId: "T1" }, { kind: "implement", taskId: "T1" }] as const) {
		assert.match(buildPrompt(p, step as any, cfg), /## Rules for this task\n\nTests use node:test/);
	}
	assert.doesNotMatch(buildPrompt(planned(), { kind: "implement", taskId: "T1" }, cfg), /## Rules for this task/);
});

await test("the breakdown prompt asks for a test command only when the task has none", () => {
	const p = planned();
	p.tasks = [];
	assert.doesNotMatch(buildPrompt(p, { kind: "breakdown" }, cfg), /test_command/);
	p.testCommand = undefined;
	assert.match(buildPrompt(p, { kind: "breakdown" }, cfg), /Also give `test_command`/);
});

await test("task.json problems are caught before any model runs", () => {
	assert.deepEqual(taskDefinitionErrors({ prompt: "p.md", testCommand: "make test", checks: [{ name: "x", command: "true" }] }), []);
	const e = taskDefinitionErrors({ testFiles: "tests/*", testCountPattern: "Ran \\d+", checks: [{ name: "x" }] }).join("\n");
	assert.match(e, /"prompt"/);
	assert.match(e, /"testFiles" must be a list/);
	assert.match(e, /capture group/);
	assert.match(e, /"checks" must be a list/);
});

// ---------------------------------------------------------------- runner --

type Script = (step: StepDir, prompt: string, resume: boolean) => { out?: any; check?: CheckReport; timedOut?: boolean };

function fakeEnv(script: Script) {
	const events: any[] = [];
	const outs = new Map<string, any>();
	const checks = new Map<string, CheckReport>();
	const prompts: Array<{ step: string; prompt: string; resume: boolean; timeoutMs: number }> = [];
	let saved: WorkflowState | undefined;
	const env: WorkflowEnv = {
		checkScript: "/check.py",
		prepareStep: (label) => ({ name: label, out: `/h/${label}/out.json`, checkSpecPath: `/h/${label}/check.json` }),
		writeStepFile: () => {},
		async runAgent(dir, prompt, resume, timeoutMs): Promise<AgentRun> {
			prompts.push({ step: dir.name, prompt, resume, timeoutMs });
			const r = script(dir, prompt, resume);
			if (r.out !== undefined) outs.set(dir.name, r.out);
			if (r.check) checks.set(dir.name, r.check);
			return { exitCode: 0, timedOut: !!r.timedOut, durationMs: 1 };
		},
		readOut: (dir) => outs.get(dir.name) ?? null,
		async runCheck(dir, _spec: CheckSpec) {
			return checks.get(dir.name) ?? { ok: true, problems: [], tests: { ran: 3, failures: 0, errors: 0, rc: 0 } };
		},
		saveState: (s) => (saved = s),
		event: (e) => events.push(e),
	};
	return { env, events, prompts, get state() { return saved!; } };
}

const good: Record<string, any> = {
	scenarios: { accepted: true, args: { scenarios: SIX } },
	breakdown: { accepted: true, args: { tasks: [task("store", ["S1", "S2", "S3"]), task("api", ["S4", "S5", "S6"])] } },
	task_plan: { accepted: true, args: { scenarios: [sc("happy", "x"), sc("unhappy", "y")], logic: ["do it"] } },
	done: { accepted: true, args: { summary: "did it" } },
};
const kindOf = (name: string) => name.split("-")[1];
const PROFILE = { testCommand: "run-the-tests" };
const answerFor = (name: string) => good[kindOf(name)] ?? good.done;

await test("runner: a clean run walks every step and ends completed", async () => {
	const f = fakeEnv((dir) => ({ out: answerFor(dir.name) }));
	const s = await runWorkflow(f.env, { config: cfg, task: "Build it.", profile: PROFILE, preexistingCode: false });
	assert.equal(s.status, "completed", s.failure);
	assert.deepEqual(
		f.prompts.map((p) => p.step.replace(/^\d+-/, "")),
		["scenarios-a1", "breakdown-a1", "task_plan-T1-a1", "task_plan-T2-a1", "implement-T1-a1", "implement-T2-a1", "integrate-T2-a1"],
	);
	assert.ok(f.events.some((e) => e.type === "final_check" && e.ok));
	assert.deepEqual(s.tasks.map((t) => t.status), ["implemented", "integrated"]);
});

await test("runner: a session that ends without submitting is nudged in place", async () => {
	let first = true;
	const f = fakeEnv((dir, _p, resume) => {
		if (kindOf(dir.name) === "breakdown" && first) {
			first = false;
			return {};
		}
		return { out: answerFor(dir.name) };
	});
	const s = await runWorkflow(f.env, { config: cfg, task: "x", profile: PROFILE, preexistingCode: false });
	assert.equal(s.status, "completed");
	const b = f.prompts.filter((p) => p.step.includes("breakdown"));
	assert.equal(b.length, 2);
	assert.equal(b[1].resume, true);
	assert.match(b[1].prompt, /not called successfully/);
});

await test("runner: after the nudges, a fresh attempt gets the failure as feedback", async () => {
	const nudges = mergeConfig(cfg, { nudges: 1 });
	const f = fakeEnv((dir) => {
		if (dir.name.includes("implement-T1-a1")) return { out: good.done, check: { ok: false, problems: ["the test suite failed: 1 failure(s)"], tests: { ran: 2, failures: 1, errors: 0, rc: 1, tail: "AssertionError: 3 != 2" } } };
		return { out: answerFor(dir.name) };
	});
	const s = await runWorkflow(f.env, { config: nudges, task: "x", profile: PROFILE, preexistingCode: false });
	assert.equal(s.status, "completed");
	const impl = f.prompts.filter((p) => p.step.includes("implement-T1"));
	assert.deepEqual(impl.map((p) => [p.step.replace(/^\d+-/, ""), p.resume]), [["implement-T1-a1", false], ["implement-T1-a1", true], ["implement-T1-a2", false]]);
	assert.match(impl[1].prompt, /AssertionError: 3 != 2/);
	assert.match(impl[2].prompt, /## A previous attempt at this step failed/);
	assert.match(impl[2].prompt, /still in \/workspace/);
});

await test("runner: an invalid submission is re-validated by the host, whatever the tool said", async () => {
	const f = fakeEnv((dir) => (kindOf(dir.name) === "scenarios" && dir.name.endsWith("a1") ? { out: { accepted: true, args: { scenarios: SIX.slice(0, 2) } } } : { out: answerFor(dir.name) }));
	const s = await runWorkflow(f.env, { config: mergeConfig(cfg, { nudges: 0 }), task: "x", profile: PROFILE, preexistingCode: false });
	assert.equal(s.status, "completed");
	assert.match(f.prompts[1].prompt, /at least 3 unhappy-path scenarios/);
});

await test("runner: out of attempts stops the workflow and marks the task failed", async () => {
	const f = fakeEnv((dir) => (dir.name.includes("implement-T2") ? { out: good.done, check: { ok: false, problems: ["no test method is named for scenario(s) S4"] } } : { out: answerFor(dir.name) }));
	const s = await runWorkflow(f.env, { config: mergeConfig(cfg, { nudges: 0, attempts: { implement: 2 } }), task: "x", profile: PROFILE, preexistingCode: false });
	assert.equal(s.status, "failed");
	assert.match(s.failure!, /implement-T2 not accepted after 2 attempt/);
	assert.deepEqual(s.tasks.map((t) => t.status), ["implemented", "failed"]);
	assert.equal(f.prompts.filter((p) => p.step.includes("implement-T2")).length, 2);
	assert.ok(!f.prompts.some((p) => p.step.includes("integrate")));
});

await test("runner: a timed-out session is not nudged", async () => {
	const f = fakeEnv((dir) => (kindOf(dir.name) === "scenarios" && dir.name.endsWith("a1") ? { timedOut: true } : { out: answerFor(dir.name) }));
	const s = await runWorkflow(f.env, { config: cfg, task: "x", profile: PROFILE, preexistingCode: false });
	assert.equal(s.status, "completed");
	assert.equal(f.prompts[1].step.replace(/^\d+-/, ""), "scenarios-a2");
	assert.match(f.prompts[1].prompt, /stopped at the time limit/);
});

await test("runner: existing code gives T1 an integration step and planning read/ls", async () => {
	const f = fakeEnv((dir) => ({ out: answerFor(dir.name) }));
	const files: any[] = [];
	f.env.writeStepFile = (_d, name, data) => files.push({ name, data });
	const s = await runWorkflow(f.env, { config: cfg, task: "x", profile: PROFILE, preexistingCode: true });
	assert.equal(s.status, "completed");
	assert.ok(f.prompts.some((p) => p.step.includes("integrate-T1")));
	const planStep = files.find((x) => x.name === "step.json" && x.data.kind === "scenarios").data as StepFile;
	assert.deepEqual(planStep.toolKinds, ["read", "ls"]);
	assert.match(planStep.systemPrompt!, /^Response style: terse/, "every step carries the workflow's system prompt");
	const implStep = files.find((x) => x.name === "step.json" && x.data.kind === "implement").data as StepFile;
	assert.equal(implStep.toolKinds, undefined);
	assert.equal(implStep.tool, "report_done");
});

await test("runner: an empty systemPrompt in the config sends none", async () => {
	const files: any[] = [];
	const f = fakeEnv((dir) => ({ out: answerFor(dir.name) }));
	f.env.writeStepFile = (_d, name, data) => files.push({ name, data });
	await runWorkflow(f.env, { config: mergeConfig(cfg, { systemPrompt: "" }), task: "x", profile: PROFILE, preexistingCode: false });
	assert.ok(files.filter((x) => x.name === "step.json").every((x) => x.data.systemPrompt === undefined));
});

await test("runner: with no task test command, the breakdown's own becomes the check's", async () => {
	const specs: CheckSpec[] = [];
	const files: any[] = [];
	const f = fakeEnv((dir) => ({ out: kindOf(dir.name) === "breakdown" ? { accepted: true, args: { ...good.breakdown.args, test_command: "npm test" } } : answerFor(dir.name) }));
	const runCheck = f.env.runCheck;
	f.env.runCheck = async (d, spec) => (specs.push(spec), runCheck(d, spec));
	f.env.writeStepFile = (_d, name, data) => files.push({ name, data });
	const s = await runWorkflow(f.env, { config: cfg, task: "x", profile: {}, preexistingCode: false });
	assert.equal(s.status, "completed", s.failure);
	assert.equal(s.testCommand, "npm test");
	assert.equal(files.find((x) => x.name === "step.json" && x.data.kind === "breakdown").data.needsTestCommand, true);
	assert.ok(specs.length > 0 && specs.every((sp) => sp.testCommand === "npm test"));
});

await test("runner: the deadline caps each session and stops the run between steps", async () => {
	let clock = 1_000_000;
	const f = fakeEnv((dir) => {
		clock += 10 * 60_000; // every session takes 10 minutes
		return { out: answerFor(dir.name) };
	});
	const s = await runWorkflow(f.env, { config: cfg, task: "x", profile: PROFILE, preexistingCode: false, now: () => clock, deadline: 1_000_000 + 25 * 60_000 });
	assert.equal(s.status, "stopped");
	assert.match(s.failure!, /time budget ran out before task_plan-T2/);
	assert.equal(f.prompts.length, 3);
	assert.equal(f.prompts[0].timeoutMs, 25 * 60_000, "first session capped by the budget, not the 40-minute step limit");
	assert.equal(f.prompts[2].timeoutMs, 5 * 60_000);
});

// -------------------------------------------------------------- check.py --

function workspace(files: Record<string, string>): string {
	const ws = mkdtempSync(join(tmpdir(), "wf-check-"));
	for (const [p, content] of Object.entries(files)) {
		mkdirSync(dirname(join(ws, p)), { recursive: true });
		writeFileSync(join(ws, p), content);
	}
	return ws;
}

// The unit-test command check.py is given in these tests. A task supplies its own.
const PY_TESTS = { testCommand: "python3 -m unittest discover -s tests -v", testCountPattern: "^Ran (\\d+) tests?" };

function runCheckPy(ws: string, spec: Partial<CheckSpec>): CheckReport {
	const specPath = join(ws, ".check.json");
	writeFileSync(specPath, JSON.stringify({ requiredTokens: [], testTimeoutSec: 30, checks: [], ...PY_TESTS, ...spec }));
	const r = spawnSync("python3", [CHECK, specPath, ws], { encoding: "utf8" });
	try {
		return JSON.parse(r.stdout);
	} catch {
		throw new Error(`check.py gave no report: ${r.stderr}`);
	}
}

const MOD = "def add(a, b):\n    return a + b\n";
const TEST = (body = "self.assertEqual(add(1, 2), 3)") =>
	`import unittest\nfrom mod import add\n\nclass T(unittest.TestCase):\n    def test_S1_adds(self):\n        ${body}\n\n    def test_T1_S1_more(self):\n        self.assertEqual(add(2, 2), 4)\n`;

await test("check.py: passes a clean workspace with the required tokens", () => {
	const r = runCheckPy(workspace({ "mod.py": MOD, "tests/test_mod.py": TEST() }), { requiredTokens: ["S1", "T1_S1"] });
	assert.ok(r.ok, JSON.stringify(r));
	assert.equal(r.tests!.count, 2);
});

await test("check.py: a missing scenario token is named", () => {
	const r = runCheckPy(workspace({ "mod.py": MOD, "tests/test_mod.py": TEST() }), { requiredTokens: ["S1", "S2"] });
	assert.ok(!r.ok);
	assert.deepEqual(r.missingTokens, ["S2"]);
	assert.match(r.problems.join(), /test_S2_<what>/);
});

await test("check.py: S1 is not satisfied by T2_S1 or S10, T2_S1 not by T2_S10", () => {
	const ws = workspace({ "tests/test_x.py": "def test_T2_S1_a(): pass\ndef test_S10_b(): pass\ndef test_T3_S10_c(): pass\n" });
	const r = runCheckPy(ws, { requiredTokens: ["S1", "T3_S1", "T2_S1", "S10"], testCommand: "true", testCountPattern: undefined });
	assert.deepEqual(r.missingTokens, ["S1", "T3_S1"]);
});

await test("check.py: any language — tokens in a JS test file, found without a glob", () => {
	const ws = workspace({ "src/orders.js": "export const n = 1;\n", "src/orders.test.js": 'test("S1: creates an order", () => {});\nit("T1_S2 rejects bad input", () => {});\n' });
	const r = runCheckPy(ws, { requiredTokens: ["S1", "T1_S2"], testCommand: "true", testCountPattern: undefined });
	assert.ok(r.ok, JSON.stringify(r));
});

await test("check.py: a failing suite fails the check with its output", () => {
	const r = runCheckPy(workspace({ "mod.py": MOD, "tests/test_mod.py": TEST("self.assertEqual(add(1, 2), 4)") }), { requiredTokens: ["S1"] });
	assert.ok(!r.ok);
	assert.notEqual(r.tests!.rc, 0);
	assert.match(r.tests!.tail!, /AssertionError: 3 != 4/);
});

await test("check.py: with a count pattern, a suite that runs nothing fails", () => {
	const r = runCheckPy(workspace({ "tests/test_none.py": "# S1 nothing here\n" }), { requiredTokens: ["S1"], testCommand: "python3 -m unittest discover -s tests -v || true" });
	assert.ok(!r.ok && /ran no tests/.test(r.problems.join()), JSON.stringify(r));
});

await test("check.py: a hanging suite is killed at the time limit", () => {
	const t0 = Date.now();
	const r = runCheckPy(workspace({ "mod.py": MOD, "tests/test_mod.py": TEST("import time; time.sleep(60)") }), { testTimeoutSec: 2 });
	assert.ok(!r.ok && r.tests!.timedOut);
	assert.ok(Date.now() - t0 < 20_000);
});

await test("check.py: task checks run, and a failing one is reported with its output", () => {
	const stdlib = resolve(HERE, "..", "workflow", "checks", "python_stdlib_only.py");
	const checks = [{ name: "stdlib only", command: `python3 "${stdlib.replace(/\\/g, "/")}"` }];
	const ws = workspace({ "mod.py": "import json, os.path\nimport requests\nfrom flask import Flask\n" + MOD, "tests/test_mod.py": TEST() });
	const r = runCheckPy(ws, { requiredTokens: ["S1"], checks });
	assert.ok(!r.ok && /"stdlib only" check failed/.test(r.problems.join()));
	assert.match(r.checks![0].tail!, /imports 'requests'/);
	assert.match(r.checks![0].tail!, /imports 'flask'/);
	assert.ok(runCheckPy(workspace({ "mod.py": MOD, "tests/test_mod.py": TEST() }), { requiredTokens: ["S1"], checks }).ok);
});

await test("check.py: integration tokens are required like any other", () => {
	const ws = workspace({ "mod.py": MOD, "tests/test_mod.py": TEST() });
	assert.deepEqual(runCheckPy(ws, { requiredTokens: ["S1", "I2"] }).missingTokens, ["I2"]);
	writeFileSync(join(ws, "tests/test_integration.py"), "import unittest\nclass I(unittest.TestCase):\n    def test_I2_end_to_end(self):\n        pass\n");
	assert.ok(runCheckPy(ws, { requiredTokens: ["S1", "I2"] }).ok);
});

// ------------------------------------------------------------ submit tool --

function stepFile(kind: StepFile["kind"], extra: Partial<StepFile> = {}): { step: StepFile; out: string } {
	const dir = mkdtempSync(join(tmpdir(), "wf-tool-"));
	const out = join(dir, "out.json");
	const tools: Record<string, string> = { scenarios: "submit_scenarios", breakdown: "submit_breakdown", task_plan: "submit_task_plan", implement: "report_done", integrate: "report_done" };
	return { step: { kind, tool: tools[kind], toolset: "planning", out, config: mergeConfig(cfg, { doneRefusals: 2 }), ...extra }, out };
}

await test("tool: scenarios in one call are still accepted in one call", async () => {
	const { step, out } = stepFile("scenarios");
	const r = await buildWorkflowTool(step).execute("1", { scenarios: SIX });
	assert.equal(r.terminate, true);
	const saved = JSON.parse(readFileSync(out, "utf8"));
	assert.equal(saved.accepted, true);
	assert.deepEqual(saved.value.map((x: any) => x.id), ["S1", "S2", "S3", "S4", "S5", "S6"]);
});

await test("tool: scenarios arrive in batches, and done: true finishes them", async () => {
	const { step, out } = stepFile("scenarios");
	const t = buildWorkflowTool(step);
	const r1 = await t.execute("1", { scenarios: SIX.slice(0, 3), done: false });
	assert.equal(r1.terminate, false);
	assert.match(r1.content[0].text, /3 scenarios recorded so far: 3 happy, 0 unhappy/);
	const r2 = await t.execute("2", { scenarios: SIX.slice(3), done: "true" });
	assert.equal(r2.terminate, true);
	assert.equal(JSON.parse(readFileSync(out, "utf8")).args.scenarios.length, 6);
});

await test("tool: done: true too early is refused with the counts; the draft is kept", async () => {
	const { step } = stepFile("scenarios", { config: mergeConfig(cfg, { doneRefusals: 5 }) });
	const t = buildWorkflowTool(step);
	await t.execute("1", { scenarios: SIX.slice(0, 3), done: false });
	await assert.rejects(t.execute("2", { scenarios: SIX.slice(3, 4), done: true }), /at least 3 unhappy-path scenarios, got 1/);
	const r = await t.execute("3", { scenarios: SIX.slice(4), done: true });
	assert.equal(r.terminate, true);
});

await test("tool: a bad item rejects only its batch, named within the call", async () => {
	const { step, out } = stepFile("scenarios", { config: mergeConfig(cfg, { doneRefusals: 5 }) });
	const t = buildWorkflowTool(step);
	await t.execute("1", { scenarios: SIX.slice(0, 3), done: false });
	await assert.rejects(t.execute("2", { scenarios: [SIX[3], { ...SIX[4], then: "" }] }), /scenario 2 of this call: "then" is missing/);
	await assert.rejects(t.execute("3", { scenarios: [SIX[0]] }), /duplicate title/);
	const r = await t.execute("4", { scenarios: SIX.slice(3) });
	assert.equal(r.terminate, true);
	assert.equal(JSON.parse(readFileSync(out, "utf8")).args.scenarios.length, 6);
});

await test("tool: the draft outlives the process, so a nudged session carries on", async () => {
	const { step } = stepFile("scenarios");
	await buildWorkflowTool(step).execute("1", { scenarios: SIX.slice(0, 4), done: false });
	const r = await buildWorkflowTool(step).execute("2", { scenarios: SIX.slice(4), done: true });
	assert.equal(r.terminate, true);
});

await test("tool: repeated invalid submissions end the session unaccepted", async () => {
	const { step, out } = stepFile("breakdown", { scenarioIds: ["S1"] });
	const t = buildWorkflowTool(step);
	await assert.rejects(t.execute("1", { tasks: [] }), /Not accepted/);
	const r = await t.execute("2", { tasks: [] });
	assert.equal(r.terminate, true);
	assert.equal(JSON.parse(readFileSync(out, "utf8")).accepted, false);
});

await test("tool: report_done refuses while check.py fails, accepts once it passes", async () => {
	const ws = workspace({ "mod.py": MOD, "tests/test_mod.py": TEST("self.assertEqual(add(1, 2), 4)") });
	const specPath = join(ws, ".check.json");
	const spec: CheckSpec = { ...PY_TESTS, requiredTokens: ["S1"], testTimeoutSec: 30, checks: [] };
	writeFileSync(specPath, JSON.stringify(spec));
	const { step, out } = stepFile("implement", { toolset: "coding", checkScript: CHECK, checkSpecPath: specPath, check: spec, config: mergeConfig(cfg, { doneRefusals: 3 }) });
	const cwd = process.cwd();
	process.chdir(ws);
	try {
		const t = buildWorkflowTool(step);
		await assert.rejects(t.execute("1", { summary: "done" }), /did NOT pass[\s\S]*AssertionError: 3 != 4[\s\S]*1 of 3 tries/);
		writeFileSync(join(ws, "tests/test_mod.py"), TEST());
		const r = await t.execute("2", { summary: "fixed" });
		assert.equal(r.terminate, true);
		assert.equal(JSON.parse(readFileSync(out, "utf8")).check.ok, true);
	} finally {
		process.chdir(cwd);
	}
});

console.log(`\n${passed} workflow tests passed`);
