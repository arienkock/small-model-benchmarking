/**
 * workflow-e2e.ts — the whole staged workflow for real, with a scripted model.
 *
 *   node test/workflow-e2e.ts            (on the machine with docker and the pi-small-agent image)
 *   node test/workflow-e2e.ts --local    (no docker: pi and the checks run on this machine)
 *
 * The stub server plays the model from test/fixtures/workflow-script.mjs, so
 * everything else is the real thing: workflow/run.ts starting proxy.mjs (which
 * starts the stub through serve.mjs, as it would llama-server), ONE pi process
 * in RPC mode for the whole run, `/workflow run` driving every step and fresh
 * retry inside it, the plugin registering each step's submit tool, check.py,
 * and the acceptance grader. The script takes each recovery path once, and this
 * test asserts that each one happened, not only that the run ended well. The
 * task is workflow/tasks/books-api, loaded from its task.json like any other.
 */

import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.WF_E2E_PORT ?? "8199";
const BACKEND = String(Number(PORT) + 1);
// A two-model rotation: every failed session (the hung scenarios session, the
// bad breakdown) moves to the other model, switched through the proxy in-process.
const ROTATION = ["Granite-4.2-3B-Q8_0", "LFM2.5-2.6B-Q8_0"];
const local = process.argv.includes("--local");
const runDir = mkdtempSync(join(tmpdir(), "wf-e2e-"));

const stubServerPath = join(ROOT, "test", "stub-server.mjs");
let stubBin = stubServerPath;
if (process.platform === "win32") {
	stubBin = join(runDir, "stub-server.cmd");
	writeFileSync(stubBin, `@echo off\r\nnode "${stubServerPath}" %*\r\n`);
}
const env = {
	...process.env,
	PI_SMALL_LLAMA_BIN: stubBin,
	PI_SMALL_BACKEND_PORT: BACKEND,
	PI_SMALL_LOG_DIR: runDir,
	PI_SMALL_START_TIMEOUT: "30",
	PI_SMALL_STUB_SCRIPT: join(ROOT, "test", "fixtures", "workflow-script.mjs"),
	// Local Python only: skip macOS's slow reverse lookup on every server start.
	...(local ? { PYTHONPATH: join(ROOT, "test", "fixtures", "local-python") } : {}),
};

let code: number | null = null;
try {
	const r = spawnSync(
		process.execPath,
		[
			join(ROOT, "workflow", "run.ts"),
			"--task", join(ROOT, "workflow", "tasks", "books-api"),
			"--models", ROTATION.join(","),
			"--port", PORT,
			"--run-dir", runDir,
			"--config", join(ROOT, "test", "fixtures", "workflow-e2e-config.json"),
			...(local ? ["--local"] : []),
		],
		{ stdio: "inherit", timeout: 30 * 60_000, env },
	);
	code = r.status;
} finally {
	// run.ts stops the proxy; the backend (the stub) outlives it by design.
	spawnSync(process.execPath, [join(ROOT, "serve.mjs"), "--stop"], { env: { ...env, PI_SMALL_PORT: BACKEND }, stdio: "ignore" });
}

assert.equal(code, 0, `run.ts exited ${code} — see ${runDir}`);
const read = (p: string) => JSON.parse(readFileSync(join(runDir, p), "utf8"));
const steps = readdirSync(join(runDir, "steps")).sort();
console.log(`\nrun dir: ${runDir}\nsteps: ${steps.join(" ")}`);

const state = read("state.json");
assert.equal(state.status, "completed", state.failure);
assert.deepEqual(state.tasks.map((t: any) => [t.id, t.status]), [["T1", "implemented"], ["T2", "integrated"]]);
assert.equal(state.scenarios.length, 8);
assert.deepEqual(state.tasks[1].scenarios.map((s: any) => s.id), ["T2.S1", "T2.S2"]);

// Each recovery path happened, in the step where the script put it.
const step = (kind: string) => steps.find((s) => s.includes(kind))!;
const scOut = read(`steps/${step("scenarios-a2")}/out.json`);
assert.equal(scOut.refusals, 1, "the bad scenario batch should have been refused in-session");
assert.equal(scOut.args.scenarios.length, 8, "the batches should have accumulated to 8 scenarios");
assert.ok(steps.includes(steps.find((x) => x.endsWith("breakdown-a1"))!) && steps.some((x) => x.endsWith("breakdown-a2")), "the breakdown should have needed a fresh second attempt");
assert.match(readFileSync(join(runDir, "steps", step("breakdown-a2"), "prompt.md"), "utf8"), /## A previous attempt at this step failed/);
assert.equal(read(`steps/${step("implement-T1")}/out.json`).refusals, 1, "report_done should have refused the failing T1 test once");
assert.ok(steps.some((s) => s.includes("integrate-T2")), "T2 should have had an integration step");
assert.ok(!steps.some((s) => s.includes("integrate-T1")), "T1 had nothing earlier to integrate with");
assert.deepEqual(steps.filter((s) => /-a2/.test(s)).map((s) => s.replace(/^\d+-/, "")), ["scenarios-a2", "breakdown-a2"], `second attempts: ${steps.join(" ")}`);
// The hung session was cut off at the limit and retried fresh, told why.
const events = readFileSync(join(runDir, "events.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
assert.ok(events.some((e) => e.type === "step_run" && e.step.endsWith("scenarios-a1") && e.timedOut), "the hung scenarios session should have timed out");
assert.match(readFileSync(join(runDir, "steps", step("scenarios-a2"), "prompt.md"), "utf8"), /stopped at the time limit/);
// One agent process for the whole run, one fresh in-process session per step and attempt.
const sessions = readFileSync(join(runDir, "workflow.log"), "utf8").split("\n").filter((l) => /session ended/.test(l)).length;
assert.equal(sessions, steps.length - 1, "a fresh session for every step and attempt (the final check is not a session)");
assert.ok(!readFileSync(join(runDir, "agent.stderr.log"), "utf8").match(/\[pi process exited: [1-9]/), "the pi process should not have crashed");

// The workflow's system prompt reached the model: pi-small logs what each session was given.
const logDir = join(runDir, "home", ".pi-small");
const records = (existsSync(logDir) ? readdirSync(logDir) : []).flatMap((f) =>
	readFileSync(join(logDir, f), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)),
);
const prompts = records.filter((r) => r.type === "system_prompt");
// The rotation really switched models: sessions ran on both, in the order the failures dictate.
assert.deepEqual([...new Set(prompts.map((r) => r.model))].sort(), [...ROTATION].sort(), "sessions should have run on both models");
assert.match(readFileSync(join(runDir, "workflow.log"), "utf8"), /02-scenarios-a2\n.*on LFM2\.5-2\.6B-Q8_0/, "the retry after the hung session should be on the next model");
assert.match(readFileSync(join(runDir, "proxy.log"), "utf8"), /serving LFM2\.5-2\.6B-Q8_0/);
assert.ok(prompts.length >= sessions && prompts.every((r) => /\+ workflow systemPrompt/.test(r.source)), JSON.stringify(prompts.slice(0, 2)));

// The planning steps really had no coding tools, and the task's own settings reached the checks.
const planStep = read(`steps/${step("scenarios")}/step.json`);
assert.deepEqual(planStep.toolKinds, []);
const implCheck = read(`steps/${step("implement-T2")}/check.json`);
assert.equal(implCheck.testCommand, "python3 -m unittest discover -s tests -v");
assert.deepEqual(implCheck.checks.map((c: any) => c.name), ["Python standard library only"]);
const finalReport = read(`steps/${step("final-check")}/check-report-1.json`);
assert.equal(finalReport.tests.count, 13);
assert.ok(finalReport.checks.every((c: any) => c.ok));

const grade = JSON.parse(readFileSync(join(runDir, "grade.json"), "utf8").trim().split("\n").pop()!);
assert.ok(grade.startup.ok, JSON.stringify(grade.startup));
assert.equal(grade.passed, grade.total, JSON.stringify(grade.checks.filter((c: any) => !c.ok)));

console.log(`\nPASS  workflow e2e: ${steps.length} step dirs, grader ${grade.passed}/${grade.total}`);
