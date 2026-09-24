#!/usr/bin/env node
/**
 * from-plan.ts — start a new run from an earlier run's planning.
 *
 *   node workflow/from-plan.ts <earlier-run-dir> <new-run-dir>
 *   node workflow/run.ts --resume --run-dir <new-run-dir> --models … --config …
 *
 * Copies the scenarios, the breakdown and every task plan the earlier run
 * accepted; every planned task goes back to "planned" and the workspace starts
 * as the task starts it (empty, or its seed). So experiments on the coding
 * steps all start from the same plan, without paying for planning again, and
 * without inheriting the earlier run's code.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { profileOf, type TaskDefinition, type WorkflowState } from "../lib/workflow.ts";

const [src, dst] = process.argv.slice(2).map((p) => p && resolve(p));
if (!src || !dst) {
	console.error("usage: node workflow/from-plan.ts <earlier-run-dir> <new-run-dir>");
	process.exit(2);
}
if (existsSync(join(dst, "state.json"))) throw new Error(`${dst} already holds a run`);

const run = JSON.parse(readFileSync(join(src, "run.json"), "utf8"));
const earlier: WorkflowState = JSON.parse(readFileSync(join(src, "state.json"), "utf8"));
if (!earlier.scenarios.length || !earlier.tasks.length) throw new Error(`${src} has no accepted scenarios and breakdown`);

// The task definition as it is NOW: its profile (test command, patterns, checks) may have changed since.
const taskJson = resolve(run.taskDir.endsWith(".json") ? run.taskDir : join(run.taskDir, "task.json"));
const def: TaskDefinition = JSON.parse(readFileSync(taskJson, "utf8"));

const state: WorkflowState = {
	...earlier,
	status: "running",
	profile: profileOf(def),
	testCommand: def.testCommand ?? earlier.testCommand,
	tasks: earlier.tasks.map((t) => ({ ...t, status: t.scenarios.length ? "planned" : "pending" })),
};
delete state.failure;
delete state.retry;

mkdirSync(join(dst, "steps"), { recursive: true });
mkdirSync(join(dst, "ws"), { recursive: true });
if (def.seed) cpSync(join(dirname(taskJson), def.seed), join(dst, "ws"), { recursive: true });
writeFileSync(join(dst, "run.json"), JSON.stringify({ ...run, started: new Date().toISOString(), fromPlan: src }, null, 2));
writeFileSync(join(dst, "state.json"), JSON.stringify(state, null, 2));
console.log(`${dst}: ${state.scenarios.length} scenarios, ${state.tasks.length} tasks (${state.tasks.filter((t) => t.status === "planned").length} planned), empty workspace`);
