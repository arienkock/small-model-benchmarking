/**
 * fix-loop-test.ts — the fix loop (lib/fix-loop.ts) without a GPU, a container
 * or a model: its control flow against a fake WorkflowEnv, and the helpers that
 * turn a probe into findings and pick what to fix.
 *
 *   node test/fix-loop-test.ts
 *
 * The same loop with pi, check.py, the fuzzer and a scripted model is
 * test/fix-e2e.ts.
 */

import assert from "node:assert";
import { buildFixPrompt, machineFindings, REVIEW_NOTE, runFixLoop, selectFindings } from "../lib/fix-loop.ts";
import type { Finding } from "../lib/review.ts";
import type { AgentRun, StepDir, WorkflowEnv } from "../lib/workflow-runner.ts";
import { type CheckReport, type CheckSpec, DEFAULT_CONFIG, mergeConfig, type WorkflowConfig } from "../lib/workflow.ts";

let passed = 0;
const test = async (name: string, fn: () => void | Promise<void>) => {
	await fn();
	passed++;
	console.log(`PASS  ${name}`);
};

const FUZZ = { name: "fuzz", command: "python3 fuzz.py" };
const cfg: WorkflowConfig = mergeConfig(DEFAULT_CONFIG, { fixRounds: 4, fixBatch: 2, fixAttempts: 2, fixChecks: [FUZZ], feedback: "failures" });
const PROFILE = { testCommand: "run-tests", checks: [{ name: "stdlib", command: "stdlib.py" }] };
const f = (priority: Finding["priority"], title: string): Finding => ({ priority, title, where: "app.py", detail: `${title} detail` });

const CLEAN: CheckReport = { ok: true, problems: [], tests: { rc: 0, count: 7 }, checks: [{ name: "stdlib", ok: true }, { name: "fuzz", ok: true }] };
const fuzzFail = (...sites: string[]): CheckReport => ({
	ok: false,
	problems: ['the "fuzz" check failed (`python3 fuzz.py`).'],
	tests: { rc: 0, count: 7 },
	checks: [
		{ name: "stdlib", ok: true },
		{
			name: "fuzz",
			ok: false,
			tail: [...sites.flatMap((s) => [`FAIL  ${s}`, "      GET /x?id=abc  ->  ValueError: bad"]), `${sites.length} distinct failure(s) from 99 requests`].join("\n"),
		},
	],
});
const SUITE_FAIL: CheckReport = {
	ok: false,
	problems: ["the test suite failed (`run-tests` exited 1)."],
	tests: { rc: 1, count: 7, failures: [{ test: "test_a", error: "AssertionError: 400 != 404" }] },
	checks: [],
};

/**
 * A scripted environment. Step names carry what they are: "NN-probe-rK",
 * "NN-review-rK-<model>", "NN-fix-rK-aN". `probe(round)` answers a probe,
 * `review(round, model)` a review session's out file (null: no submission),
 * `gate(round, attempt)` the host's check after a fix session.
 */
function fakeEnv(script: {
	probe: (round: number) => CheckReport;
	review?: (round: number, model: string) => Finding[] | null;
	gate?: (round: number, attempt: number) => CheckReport;
}) {
	const events: any[] = [];
	const outs = new Map<string, any>();
	const log: string[] = [];
	const prompts = new Map<string, string>();
	const checks: Array<{ step: string; spec: CheckSpec }> = [];
	const models = new Map<string, string | undefined>();
	let clock = 0;
	const env: WorkflowEnv = {
		checkScript: "/check.py",
		prepareStep: (label) => ({ name: label, out: `/h/${label}/out.json`, checkSpecPath: `/h/${label}/check.json` }),
		writeStepFile: () => {},
		async runAgent(dir: StepDir, prompt, limits): Promise<AgentRun> {
			log.push(`agent ${dir.name}`);
			prompts.set(dir.name, prompt);
			models.set(dir.name, limits.model);
			const m = dir.name.match(/review-r(\d+)-(.+)$/);
			if (m) {
				const findings = script.review?.(Number(m[1]), m[2]) ?? null;
				if (findings) outs.set(dir.name, { accepted: true, args: { findings } });
			} else outs.set(dir.name, { accepted: true, args: { summary: "fixed" } });
			return { exitCode: 0, timedOut: false, durationMs: 1 };
		},
		readOut: (dir) => outs.get(dir.name) ?? null,
		async runCheck(dir: StepDir, spec: CheckSpec) {
			log.push(`check ${dir.name}`);
			checks.push({ step: dir.name, spec });
			const p = dir.name.match(/probe-r(\d+)$/);
			if (p) return script.probe(Number(p[1]));
			const g = dir.name.match(/fix-r(\d+)-a(\d+)$/)!;
			return script.gate?.(Number(g[1]), Number(g[2])) ?? CLEAN;
		},
		saveState: () => {},
		event: (e) => events.push(e),
		snapshotWorkspace: (key, replace) => log.push(`snapshot ${key}${replace ? " (replace)" : ""}`),
		restoreWorkspace: (key) => log.push(`restore ${key}`),
	};
	return { env, events, log, prompts, checks, models, tick: (ms: number) => (clock += ms), now: () => clock };
}

const steps = (log: string[]) => log.filter((l) => l.startsWith("agent ")).map((l) => l.replace(/^agent \d+-/, ""));

// ------------------------------------------------------------------ helpers --

await test("machineFindings: one finding per FAIL block of a failing check, with where it crashed", () => {
	const got = machineFindings(fuzzFail("ValueError at app.py:112 `int(x)`", "KeyError at app.py:122 `b[f]`"), "run-tests");
	assert.equal(got.length, 2);
	assert.deepEqual(got.map((x) => [x.priority, x.where]), [["high", "app.py:112"], ["high", "app.py:122"]]);
	assert.equal(got[0].title, "ValueError at app.py:112 `int(x)`");
	assert.match(got[0].detail, /Found by the "fuzz" check:\nGET \/x\?id=abc {2}-> {2}ValueError: bad/);
	assert.match(buildFixPrompt("t", {}, got), /- \[high\] ValueError at app\.py:112 `int\(x\)` \(app\.py:112\): Found by the "fuzz" check:\n  GET \/x\?id=abc/, "a multi-line detail stays under its bullet");
});

await test("machineFindings: a failing suite is one finding with its failing tests; a check without FAIL lines is one with its output", () => {
	const r: CheckReport = { ...SUITE_FAIL, problems: [...SUITE_FAIL.problems, 'the "stdlib" check failed (`stdlib.py`).'], checks: [{ name: "stdlib", ok: false, tail: "app.py imports 'flask'" }] };
	const got = machineFindings(r, "run-tests");
	assert.equal(got.length, 2);
	assert.equal(got[0].title, "the test suite failed (`run-tests` exited 1)");
	assert.equal(got[0].where, "run-tests");
	assert.match(got[0].detail, /test_a: AssertionError: 400 != 404/);
	assert.deepEqual([got[1].title, got[1].detail], ['the "stdlib" check fails', "app.py imports 'flask'"]);
	assert.deepEqual(machineFindings(CLEAN, "run-tests"), []);
});

await test("selectFindings: high before medium, low never, at most n, stable within a priority", () => {
	const got = selectFindings([f("low", "l1"), f("medium", "m1"), f("high", "h1"), f("medium", "m2"), f("high", "h2")], 3);
	assert.deepEqual(got.map((x) => x.title), ["h1", "h2", "m1"]);
	assert.deepEqual(selectFindings([f("low", "l1")], 3), []);
});

await test("buildFixPrompt: the findings, the retry's check failure, the test command and conventions", () => {
	const p = buildFixPrompt("Build it.", { testCommand: "run-tests", conventions: "Use unittest." }, [f("high", "crash on q")], "The harness checks did NOT pass:\n- the test suite failed");
	assert.match(p, /^# Fix\n/);
	assert.match(p, /## Findings to fix\n\n- \[high\] crash on q \(app\.py\): crash on q detail/);
	assert.match(p, /## An earlier attempt at these fixes failed\n\nThe harness checks did NOT pass/);
	assert.match(p, /`run-tests`/);
	assert.match(p, /Use unittest\./);
	assert.match(p, /## The task\n\nBuild it\./);
	assert.doesNotMatch(buildFixPrompt("t", {}, [f("high", "x")]), /earlier attempt/);
});

// --------------------------------------------------------------- the loop --

await test("loop: probe findings are fixed first without a review; then review findings; clean when only low ones remain", async () => {
	const x = fakeEnv({
		probe: (r) => (r === 1 ? fuzzFail("ValueError at app.py:1 `a`", "KeyError at app.py:2 `b`", "TypeError at app.py:3 `c`") : CLEAN),
		review: (r) => (r === 2 ? [f("low", "style"), f("medium", "wrong status")] : [f("low", "style")]),
	});
	const res = await runFixLoop(x.env, { config: cfg, task: "Build it.", profile: PROFILE, reviewers: ["R1"], fixers: ["F1", "F2"] });
	assert.equal(res.status, "clean");
	assert.deepEqual(steps(x.log), ["fix-r1-a1", "review-r2-R1", "fix-r2-a1", "review-r3-R1"]);
	assert.equal(res.rounds.length, 3);
	// Round 1: the probe's three crash sites, two of them (fixBatch) handed to the fixer; no review.
	assert.equal(res.rounds[0].review, undefined);
	assert.deepEqual(res.rounds[0].selected.map((s) => s.where), ["app.py:1", "app.py:2"]);
	assert.match(x.prompts.get("02-fix-r1-a1")!, /ValueError at app\.py:1/);
	assert.doesNotMatch(x.prompts.get("02-fix-r1-a1")!, /TypeError at app\.py:3/);
	// Round 2: the review, told what the machine checks cover; its medium finding is fixed, its low one is not.
	assert.ok(x.prompts.get("04-review-r2-R1")!.includes(REVIEW_NOTE));
	assert.deepEqual(res.rounds[1].selected.map((s) => s.title), ["wrong status"]);
	assert.deepEqual(res.remaining.map((s) => s.title), ["style"]);
	assert.deepEqual(x.models.get("02-fix-r1-a1"), "F1");
	assert.ok(x.events.some((e) => e.type === "fix_end" && e.status === "clean"));
});

await test("loop: the probe runs the extra fixChecks, the fix gate does not, and neither lets the test count drop", async () => {
	const x = fakeEnv({ probe: (r) => (r === 1 ? fuzzFail("ValueError at app.py:1 `a`") : CLEAN), review: () => [] });
	await runFixLoop(x.env, { config: cfg, task: "t", profile: PROFILE, reviewers: ["R1"], fixers: ["F1"] });
	const probe1 = x.checks.find((c) => c.step.endsWith("probe-r1"))!.spec;
	const gate = x.checks.find((c) => c.step.includes("fix-r1"))!.spec;
	const probe2 = x.checks.find((c) => c.step.endsWith("probe-r2"))!.spec;
	assert.deepEqual(probe1.checks.map((c) => c.name), ["stdlib", "fuzz"]);
	assert.deepEqual(gate.checks.map((c) => c.name), ["stdlib"]);
	assert.equal(probe1.minTests, 0, "the first probe sets the bar");
	assert.equal(gate.minTests, 7);
	assert.equal(probe2.minTests, 7);
});

await test("loop: a failed fix is reverted and retried on the next fixer, with the same findings and what went wrong", async () => {
	const x = fakeEnv({
		probe: (r) => (r === 1 ? fuzzFail("ValueError at app.py:1 `a`") : CLEAN),
		review: () => [],
		gate: (r, a) => (r === 1 && a === 1 ? SUITE_FAIL : CLEAN),
	});
	const res = await runFixLoop(x.env, { config: cfg, task: "t", profile: PROFILE, reviewers: ["R1"], fixers: ["F1", "F2"] });
	assert.equal(res.status, "clean");
	assert.deepEqual(steps(x.log), ["fix-r1-a1", "fix-r1-a2", "review-r2-R1"]);
	const i = x.log.indexOf("check 03-fix-r1-a2");
	assert.ok(x.log.slice(x.log.indexOf("check 02-fix-r1-a1"), i).includes("restore fix-round-1"), "reverted before the retry");
	assert.equal(x.models.get("02-fix-r1-a1"), "F1");
	assert.equal(x.models.get("03-fix-r1-a2"), "F2");
	const retry = x.prompts.get("03-fix-r1-a2")!;
	assert.match(retry, /ValueError at app\.py:1/, "the retry prompt carries the findings");
	assert.match(retry, /## An earlier attempt at these fixes failed[\s\S]*test_a: AssertionError: 400 != 404/);
	assert.deepEqual(res.rounds[0].fixes.map((a) => a.ok), [false, true]);
});

await test("loop: every fix attempt failing stops it 'stuck', with the round's starting workspace back", async () => {
	const x = fakeEnv({ probe: () => fuzzFail("ValueError at app.py:1 `a`"), gate: () => SUITE_FAIL });
	const res = await runFixLoop(x.env, { config: cfg, task: "t", profile: PROFILE, reviewers: ["R1"], fixers: ["F1", "F2"] });
	assert.equal(res.status, "stuck");
	assert.deepEqual(steps(x.log), ["fix-r1-a1", "fix-r1-a2"]);
	assert.equal(x.log.at(-1), "restore fix-round-1");
	assert.equal(res.remaining.length, 1);
});

await test("loop: after fixRounds fixes, one last assessment and no more fixing — 'rounds_exhausted'", async () => {
	const x = fakeEnv({ probe: () => CLEAN, review: () => [f("high", "still wrong")] });
	const res = await runFixLoop(x.env, { config: mergeConfig(cfg, { fixRounds: 2 }), task: "t", profile: PROFILE, reviewers: ["R1"], fixers: ["F1"] });
	assert.equal(res.status, "rounds_exhausted");
	assert.deepEqual(steps(x.log), ["review-r1-R1", "fix-r1-a1", "review-r2-R1", "fix-r2-a1", "review-r3-R1"]);
	assert.deepEqual(res.rounds[2].selected, []);
	assert.deepEqual(res.remaining.map((s) => s.title), ["still wrong"]);
});

await test("loop: a reviewer that does not submit hands over to the next; none submitting ends it 'no_review'", async () => {
	const x = fakeEnv({ probe: () => CLEAN, review: (_r, m) => (m === "R2" ? [] : null) });
	const res = await runFixLoop(x.env, { config: cfg, task: "t", profile: PROFILE, reviewers: ["R1", "R2"], fixers: ["F1"] });
	assert.equal(res.status, "clean");
	assert.deepEqual(steps(x.log), ["review-r1-R1", "review-r1-R2"]);
	assert.ok(x.log.includes("restore fix-round-1"), "the workspace is put back after the reviews");

	const y = fakeEnv({ probe: () => CLEAN, review: () => null });
	const res2 = await runFixLoop(y.env, { config: cfg, task: "t", profile: PROFILE, reviewers: ["R1", "R2"], fixers: ["F1"] });
	assert.equal(res2.status, "no_review");
	assert.deepEqual(steps(y.log), ["review-r1-R1", "review-r1-R2"]);
});

await test("loop: no session starts after the deadline — 'stopped' with the latest findings", async () => {
	const x = fakeEnv({ probe: () => CLEAN, review: () => [f("high", "h")] });
	const origRun = x.env.runAgent;
	x.env.runAgent = async (dir, prompt, limits, w) => {
		const r = await origRun(dir, prompt, limits, w);
		if (dir.name.includes("fix-r1")) x.tick(10_000);
		return r;
	};
	const res = await runFixLoop(x.env, { config: cfg, task: "t", profile: PROFILE, reviewers: ["R1"], fixers: ["F1"], deadline: 5_000, now: x.now });
	assert.equal(res.status, "stopped");
	assert.deepEqual(steps(x.log), ["review-r1-R1", "fix-r1-a1"]);
	assert.deepEqual(res.remaining.map((s) => s.title), ["h"]);
});

await test("loop: refuses to start without a test command, a reviewer or a fixer", async () => {
	const x = fakeEnv({ probe: () => CLEAN });
	await assert.rejects(runFixLoop(x.env, { config: cfg, task: "t", profile: {}, reviewers: ["R"], fixers: ["F"] }), /testCommand/);
	await assert.rejects(runFixLoop(x.env, { config: cfg, task: "t", profile: PROFILE, reviewers: [], fixers: ["F"] }), /reviewer/);
});

console.log(`\n${passed} fix-loop tests passed`);
