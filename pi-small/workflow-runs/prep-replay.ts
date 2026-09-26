// Build the T1 replay base from the rotation run: T1 only, the workspace as it
// was after attempt 1, and the retry feedback the NEW check gives for it.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { checkSpecFor, describeCheck, DEFAULT_CONFIG, mergeConfig, profileOf } from "../lib/workflow.ts";

const P = "D:/llama.cpp/pi-small";
const src = `${P}/workflow-runs/rotation-20260924-201405`;
const base = `${P}/workflow-runs/replay-T1-base`;
mkdirSync(base, { recursive: true });
cpSync(`${src}/run.json`, `${base}/run.json`);
const state = JSON.parse(readFileSync(`${src}/state.json`, "utf8"));
const def = JSON.parse(readFileSync(`${P}/workflow/tasks/books-api/task.json`, "utf8"));
state.status = "running";
delete state.failure;
state.profile = profileOf(def); // the new failurePattern
state.tasks = [{ ...state.tasks[0], status: "planned" }];
const cfg = mergeConfig(DEFAULT_CONFIG, JSON.parse(readFileSync(`${P}/workflow/configs/rotation-10turns.json`, "utf8")));
const spec = checkSpecFor(state, "implement", "T1", cfg);
writeFileSync(`${base}/check-spec.json`, JSON.stringify(spec, null, 2));
const r = spawnSync("docker", ["run", "--rm", "--network", "none", "-v", `${base}/ws:/workspace`, "-v", `${P}:/opt/pi-small:ro`, "-v", `${base}:/spec:ro`, "-w", "/workspace",
	"pi-small-agent:latest", "python3", "/opt/pi-small/workflow/check.py", "/spec/check-spec.json", "/workspace"], { encoding: "utf8", timeout: 300_000 });
const report = JSON.parse(r.stdout.trim().split("\n").pop()!);
writeFileSync(`${base}/check-report.json`, JSON.stringify(report, null, 2));
const feedback = describeCheck(report) + "\n\nThe files from that attempt are still in /workspace; continue from them or replace them.";
state.retry = { step: "implement-T1", feedback };
writeFileSync(`${base}/state.json`, JSON.stringify(state, null, 2));
console.log(JSON.stringify(spec));
console.log("----- feedback -----\n" + feedback);
