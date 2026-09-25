/**
 * review-e2e.ts — the review-only experiment for real, with a scripted model.
 *
 *   node test/review-e2e.ts            (on the machine with docker and the pi-small-agent image)
 *   node test/review-e2e.ts --local    (no docker: pi and check.py run on this machine)
 *
 * Same principle as test/workflow-e2e.ts: the stub server plays the model
 * (test/fixtures/review-script.mjs), so everything else is the real thing —
 * workflow/run.ts starting proxy.mjs (which starts the stub through
 * serve.mjs, as it would llama-server), ONE pi process in RPC mode, and
 * `/workflow run` driving lib/review.ts's runReviews() instead of the staged
 * workflow because the run spec carries `review`. Two models each review the
 * same seeded workspace under two variants — 4 sessions — and the test checks
 * both the scripted findings AND that the workspace never changed: a review
 * run's whole point is that nothing does.
 */
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReviewResult } from "../lib/review.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Different from workflow-e2e.ts's 8199/8200 so both can run at once.
const PORT = process.env.REVIEW_E2E_PORT ?? "8195";
const BACKEND = String(Number(PORT) + 1);
const MODELS = ["Granite-4.2-3B-Q8_0", "LFM2.5-2.6B-Q8_0"];
const local = process.argv.includes("--local");
const runDir = mkdtempSync(join(tmpdir(), "review-e2e-"));
const seedWs = join(ROOT, "test", "fixtures", "books-reference");

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
	PI_SMALL_STUB_SCRIPT: join(ROOT, "test", "fixtures", "review-script.mjs"),
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
			"--models", MODELS.join(","),
			"--review", "completeness,fidelity",
			"--seed-ws", seedWs,
			"--port", PORT,
			"--run-dir", runDir,
			"--config", join(ROOT, "test", "fixtures", "workflow-e2e-config.json"),
			...(local ? ["--local"] : []),
		],
		{ stdio: "inherit", timeout: 10 * 60_000, env },
	);
	code = r.status;
} finally {
	// run.ts stops the proxy; the backend (the stub) outlives it by design.
	spawnSync(process.execPath, [join(ROOT, "serve.mjs"), "--stop"], { env: { ...env, PI_SMALL_PORT: BACKEND }, stdio: "ignore" });
}

assert.equal(code, 0, `run.ts exited ${code} — see ${runDir}`);

const reviews: ReviewResult[] = JSON.parse(readFileSync(join(runDir, "reviews.json"), "utf8"));
console.log(`\nrun dir: ${runDir}\nreviews: ${reviews.length}`);

assert.equal(reviews.length, 4, "2 models x 2 variants x 1 repeat");
assert.deepEqual(
	reviews.map((r) => `${r.model}/${r.variant}`).sort(),
	["Granite-4.2-3B-Q8_0/completeness", "Granite-4.2-3B-Q8_0/fidelity", "LFM2.5-2.6B-Q8_0/completeness", "LFM2.5-2.6B-Q8_0/fidelity"].sort(),
);
assert.ok(
	reviews.every((r) => r.ok),
	`every session should have submitted: ${JSON.stringify(reviews.filter((r) => !r.ok))}`,
);
for (const r of reviews) {
	if (r.variant === "completeness") {
		assert.deepEqual(r.findings, [{ priority: "high", title: "no DELETE endpoint", where: "app.py", detail: "the task asks for DELETE /books/{id}; app.py has no DELETE route" }]);
	} else {
		assert.deepEqual(r.findings, [], "the fidelity variant is scripted to find nothing");
	}
}

// The workspace was restored before every session and no session edited
// anything: it must still equal the seed (minus __pycache__, which the seed
// copy itself skips — see --seed-ws in workflow/run.ts).
function fileList(dir: string): string[] {
	const out: string[] = [];
	const walk = (d: string) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			if (e.name === "__pycache__") continue;
			const p = join(d, e.name);
			if (e.isDirectory()) walk(p);
			else out.push(relative(dir, p));
		}
	};
	walk(dir);
	return out.sort();
}
const ws = join(runDir, "ws");
const seedFiles = fileList(seedWs);
const wsFiles = fileList(ws);
assert.deepEqual(wsFiles, seedFiles, "the workspace's files must match the seed's");
for (const f of seedFiles) {
	assert.equal(readFileSync(join(ws, f), "utf8"), readFileSync(join(seedWs, f), "utf8"), `${f} must be byte-for-byte unchanged`);
}

console.log(`\nPASS  review e2e: ${reviews.length} review session(s), workspace unchanged from the seed`);
