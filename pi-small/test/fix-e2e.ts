/**
 * fix-e2e.ts — the fix loop for real, with a scripted model: a smoke test.
 *
 *   node test/fix-e2e.ts            (on the machine with docker and the pi-small-agent image)
 *   node test/fix-e2e.ts --local    (no docker: pi and check.py run on this machine)
 *
 * Same principle as test/review-e2e.ts: the stub server plays the model
 * (test/fixtures/fix-script.mjs), so everything else is the real thing —
 * workflow/run.ts --fix starting proxy.mjs, ONE pi process in RPC mode,
 * `/workflow run` driving lib/fix-loop.ts, check.py as the probe and the gate,
 * workflow/checks/http_fuzz.py as the probe's extra check, report_done in the
 * plugin, the workspace snapshots, and the task's grader at the end.
 *
 * The seed is test/fixtures/books-reference with its `id=` filter's
 * try/except taken out — a crash the reference's own tests do not cover, so
 * only the fuzzer can find it. See fix-script.mjs for the path the run takes.
 */
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FixLoopResult } from "../lib/fix-loop.ts";

// What fix-script.mjs's reviews submit (MEDIUM, then LOW).
const MEDIUM = { priority: "medium", title: "GET /books ignores a blank q", where: "app.py", detail: "q= with an empty value should match every book" };
const LOW = { priority: "low", title: "error messages could name the field", where: "app.py", detail: "cosmetic" };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Different from the other e2e tests' ports so they can run at once.
const PORT = process.env.FIX_E2E_PORT ?? "8191";
const BACKEND = String(Number(PORT) + 1);
const MODELS = ["Granite-4.2-3B-Q8_0", "LFM2.5-2.6B-Q8_0"];
const local = process.argv.includes("--local");
const runDir = mkdtempSync(join(tmpdir(), "fix-e2e-"));

// The seed: the reference with one crash put back in.
const seedWs = mkdtempSync(join(tmpdir(), "fix-e2e-seed-"));
cpSync(join(ROOT, "test", "fixtures", "books-reference"), seedWs, { recursive: true, filter: (src) => !src.split(/[\\/]/).includes("__pycache__") });
const guarded = [
	'                try:',
	'                    filters["id"] = int(filters["id"])',
	'                except ValueError:',
	'                    return self.fail(400, "id must be an integer")',
].join("\n");
const refApp = readFileSync(join(seedWs, "app.py"), "utf8");
assert.ok(refApp.includes(guarded), "the reference's id filter is not where this test expects it");
writeFileSync(join(seedWs, "app.py"), refApp.replace(guarded, '                filters["id"] = int(filters["id"])'));

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
	PI_SMALL_STUB_SCRIPT: join(ROOT, "test", "fixtures", "fix-script.mjs"),
	...(local ? { PYTHONPATH: join(ROOT, "test", "fixtures", "local-python") } : {}),
};

let code: number | null = null;
try {
	const r = spawnSync(
		process.execPath,
		[
			join(ROOT, "workflow", "run.ts"),
			"--task", join(ROOT, "workflow", "tasks", "books-api"),
			"--models", MODELS.join(","),
			"--fix",
			"--seed-ws", seedWs,
			"--port", PORT,
			"--run-dir", runDir,
			"--config", join(ROOT, "test", "fixtures", "fix-e2e-config.json"),
			...(local ? ["--local"] : []),
		],
		{ stdio: "inherit", timeout: 15 * 60_000, env },
	);
	code = r.status;
} finally {
	spawnSync(process.execPath, [join(ROOT, "serve.mjs"), "--stop"], { env: { ...env, PI_SMALL_PORT: BACKEND }, stdio: "ignore" });
}

console.log(`\nrun dir: ${runDir}`);
assert.equal(code, 0, `run.ts exited ${code} (0 only when the loop ends clean) — see ${runDir}`);

const result: FixLoopResult = JSON.parse(readFileSync(join(runDir, "fix-loop.json"), "utf8"));
assert.equal(result.status, "clean");
assert.equal(result.rounds.length, 3, "fuzzer round, review round, clean assessment");

// Round 1: the fuzzer's crash, no review, a failed attempt reverted, then the fix on the next model.
const [r1, r2, r3] = result.rounds;
assert.equal(r1.review, undefined, "machine findings skip the review");
assert.equal(r1.machineFindings.length, 1, JSON.stringify(r1.machineFindings));
assert.match(r1.machineFindings[0].title, /^ValueError at app\.py:\d+ `filters\["id"\] = int\(filters\["id"\]\)`$/);
assert.match(r1.machineFindings[0].detail, /GET \/books\?id=abc/);
assert.deepEqual(r1.fixes.map((f) => [f.model, f.ok, f.reported]), [[MODELS[0], false, false], [MODELS[1], true, true]]);
const retryPrompt = readFileSync(join(runDir, "steps", r1.fixes[1].step, "prompt.md"), "utf8");
assert.match(retryPrompt, /## Findings to fix\n\n- \[high\] ValueError at app\.py/, "the retry carries the finding");
assert.match(retryPrompt, /## An earlier attempt at these fixes failed\n\nThe harness checks did NOT pass:\n- the test suite failed/);

// Round 2: a clean probe, a review told what the machine covers, only the medium finding fixed.
assert.ok(r2.probe.ok, JSON.stringify(r2.probe.problems));
assert.equal(r2.machineFindings.length, 0);
assert.deepEqual(r2.review?.findings, [MEDIUM, LOW]);
assert.match(readFileSync(join(runDir, "steps", r2.review!.step, "prompt.md"), "utf8"), /already run the test suite and its own automated checks/);
assert.deepEqual(r2.selected, [MEDIUM]);
assert.deepEqual(r2.fixes.map((f) => f.ok), [true]);

// Round 3: only a low finding left.
assert.ok(r3.probe.ok);
assert.deepEqual(r3.review?.findings, [LOW]);
assert.deepEqual(r3.selected, []);
assert.deepEqual(result.remaining, [LOW]);

// The workspace: the crash fixed, the new test kept, the broken attempt gone; the probe's test bar held.
const ws = join(runDir, "ws");
const app = readFileSync(join(ws, "app.py"), "utf8");
assert.ok(app.includes(guarded), "the try/except is back");
assert.doesNotMatch(app, /def broken\(:/, "the failed attempt was reverted");
assert.ok(existsSync(join(ws, "tests", "test_fix_id.py")));
assert.ok(r3.probe.tests?.count! > r1.probe.tests?.count!, `the new test ran (${r1.probe.tests?.count} → ${r3.probe.tests?.count})`);

// And the grader, which the loop never saw, agrees.
const grade = JSON.parse(readFileSync(join(runDir, "grade.json"), "utf8").trim().split("\n").pop()!);
assert.equal(grade.passed, grade.total, JSON.stringify(grade.checks?.filter((c: any) => !c.ok)));

console.log(`\nPASS  fix e2e: ${result.rounds.length} rounds, ${result.status}; grader ${grade.passed}/${grade.total}`);
