/**
 * workflow-e2e.ts — the whole staged workflow for real, with a scripted model.
 *
 *   node test/workflow-e2e.ts            (on the machine with docker and the pi-small-agent image)
 *
 * The stub server plays the model from test/fixtures/workflow-script.mjs, so
 * everything else is the real thing: workflow/run.ts, docker, pi in the
 * container, the plugin registering each step's submit tool, check.py in a
 * fresh no-network container, and the acceptance grader. The script takes each
 * recovery path once, and this test asserts that each one happened, not only
 * that the run ended well. The task is workflow/tasks/books-api, loaded from
 * its task.json like any other: test command, test-count pattern, its
 * stdlib-only check and its grader all come from there.
 */

import assert from "node:assert";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.WF_E2E_PORT ?? "8199";
const ALIAS = "Granite-4.2-3B-Q8_0"; // any roster alias: the plugin attaches to what the stub says it serves
const runDir = mkdtempSync(join(tmpdir(), "wf-e2e-"));

const stub = spawn(process.execPath, [join(ROOT, "test", "stub-server.mjs"), "--alias", ALIAS, "--host", "0.0.0.0", "--port", PORT, "-c", "16384"], {
	env: { ...process.env, PI_SMALL_STUB_SCRIPT: join(ROOT, "test", "fixtures", "workflow-script.mjs") },
	stdio: ["ignore", "ignore", "inherit"],
});
await new Promise((r) => setTimeout(r, 1500));

let code: number | null = null;
try {
	const r = spawnSync(
		process.execPath,
		[
			join(ROOT, "workflow", "run.ts"),
			"--task", join(ROOT, "workflow", "tasks", "books-api"),
			"--model", ALIAS,
			"--no-serve",
			"--port", PORT,
			"--run-dir", runDir,
			"--config", join(ROOT, "test", "fixtures", "workflow-e2e-config.json"),
		],
		{ stdio: "inherit", timeout: 30 * 60_000 },
	);
	code = r.status;
} finally {
	stub.kill();
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
const scOut = read(`steps/${step("scenarios")}/out.json`);
assert.equal(scOut.refusals, 1, "the bad scenario batch should have been refused in-session");
assert.equal(scOut.args.scenarios.length, 8, "the batches should have accumulated to 8 scenarios");
assert.ok(existsSync(join(runDir, "steps", step("breakdown"), "prompt-2-nudge.md")) || readdirSync(join(runDir, "steps", step("breakdown"))).some((f) => f.includes("nudge")), "the breakdown should have needed a nudge");
assert.equal(read(`steps/${step("implement-T1")}/out.json`).refusals, 1, "report_done should have refused the failing T1 test once");
assert.ok(steps.some((s) => s.includes("integrate-T2")), "T2 should have had an integration step");
assert.ok(!steps.some((s) => s.includes("integrate-T1")), "T1 had nothing earlier to integrate with");
assert.ok(steps.every((s) => !/-a2/.test(s)), `no step should have needed a fresh second attempt: ${steps.join(" ")}`);

// The workflow's system prompt reached the model: pi-small logs what each session was given.
const logs = readdirSync(join(runDir, "steps", step("scenarios"), "sessions")).filter((f) => f.includes("pi-small"));
const promptRec = logs.flatMap((f) => readFileSync(join(runDir, "steps", step("scenarios"), "sessions", f), "utf8").trim().split("\n").map((l) => JSON.parse(l))).find((r) => r.type === "system_prompt");
assert.ok(promptRec && /\+ workflow systemPrompt/.test(promptRec.source), JSON.stringify(promptRec));

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
