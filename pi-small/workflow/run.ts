#!/usr/bin/env node
/**
 * run.ts — drive one task through the staged workflow (../lib/workflow.ts),
 * one fresh pi-small session per step, each in the sandbox container.
 *
 *   node workflow/run.ts --task workflow/tasks/books-api --model Granite-4.2-3B-Q8_0
 *   node workflow/run.ts --resume --run-dir workflow-runs/<dir>

 * The harness is task-agnostic; everything about a particular task — its text,
 * how to run its tests, extra checks, a grader, starting code — comes from the
 * task directory's task.json (see tasks/README.md).
 *
 * Options:
 *   --task DIR         a task directory holding task.json (or the task.json itself);
 *                      required unless --resume
 *   --model ALIAS      roster alias; served on the host via serve.mjs
 *   --thinking on|off  thinking mode, for models that have one
 *   --run-dir DIR      where state, logs and the workspace go
 *                      (default workflow-runs/<timestamp>-<model>)
 *   --ws DIR           the workspace (default <run-dir>/ws)
 *   --config FILE      JSON overrides for DEFAULT_CONFIG, applied over the task's own
 *   --no-grade         skip the task's grader
 *   --deadline TIME    ISO time (or epoch ms): no step starts after it, a running
 *                      session is cut off at it, the run ends "stopped" and is
 *                      still graded
 *   --no-serve         do not start/check the model server (it is already up, or a stub)
 *   --build            rebuild the sandbox image first (default: only when it is missing)
 *   --no-build         never build it, even when missing
 *   --port N --api-key K --image NAME
 *   --resume           continue the run in --run-dir from its state.json
 *
 * The run directory:
 *   state.json    the workflow state (the source of truth; --resume reads it)
 *   spec.md       the enriched task as it stands
 *   events.jsonl  every step start, run, judgement, with timings
 *   steps/NN-<kind>[-Tk]-aN/   prompt(s), step.json, check.json, out.json,
 *                 pi stdout/stderr, check reports, copies of the session logs
 *   grade.json    the task grader's output, if the task has one
 *   ws/           the workspace the model worked in
 */

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type CheckReport, type CheckSpec, DEFAULT_CONFIG, mergeConfig, profileOf, renderSpec, type TaskDefinition, taskDefinitionErrors, type WorkflowState } from "../lib/workflow.ts";
import { type AgentRun, runWorkflow, type StepDir, type WorkflowEnv } from "../lib/workflow-runner.ts";

const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ------------------------------------------------------------------ args --

function parseArgs(argv: string[]) {
	const o: Record<string, string | boolean> = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`);
		const key = a.slice(2);
		if (["no-serve", "no-build", "build", "resume", "help", "no-grade"].includes(key)) o[key] = true;
		else o[key] = argv[++i] ?? "";
	}
	return o;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
	console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
	process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const model = (args.model as string) || "";
const runDir = resolve((args["run-dir"] as string) || join("workflow-runs", `${stamp}-${model || "served"}`));
const ws = resolve((args.ws as string) || join(runDir, "ws"));
const image = (args.image as string) || "pi-small-agent:latest";
const port = (args.port as string) || process.env.PI_SMALL_PORT || "8123";
const apiKey = (args["api-key"] as string) || process.env.PI_SMALL_API_KEY || "sk-bench";
const thinking = (args.thinking as string) || "";

mkdirSync(join(runDir, "steps"), { recursive: true });
mkdirSync(ws, { recursive: true });

const log = (msg: string) => console.error(`[workflow ${new Date().toISOString().slice(11, 19)}] ${msg}`);
const event = (e: Record<string, unknown>) => appendFileSync(join(runDir, "events.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...e }) + "\n");

// ------------------------------------------------------------- the model --

// Built only when missing, or on --build. A build asks the registry about the
// base image even when every layer is cached, and over ssh on the laptop that
// fails: Docker's Windows credential helper has no logon session there ("A
// specified logon session does not exist").
const haveImage = spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" }).status === 0;
if (args.build || (!haveImage && !args["no-build"])) {
	log(`building ${image} …`);
	const b = spawnSync("docker", ["build", "-q", "-t", image, join(PLUGIN_DIR, "docker")], { stdio: ["ignore", "ignore", "inherit"] });
	if (b.status !== 0) throw new Error("docker build failed");
}
if (!args["no-serve"]) {
	log(`serving ${model || "the roster default"} on the host …`);
	const s = spawnSync(process.execPath, [join(PLUGIN_DIR, "serve.mjs"), ...(model ? [model] : []), ...(thinking ? ["--thinking", thinking] : [])], {
		stdio: "inherit",
		env: { ...process.env, PI_SMALL_PORT: port },
	});
	if (s.status !== 0) throw new Error(`serve.mjs exited ${s.status} — not starting the workflow`);
}

// ------------------------------------------------------------ the task --

let state: WorkflowState | undefined;
if (args.resume) state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));

// The task directory: from --task, or on --resume from the run it belongs to.
const taskArg = (args.task as string) || (args.resume ? JSON.parse(readFileSync(join(runDir, "run.json"), "utf8")).taskDir : "");
if (!taskArg) throw new Error("--task is required");
const taskJson = resolve(taskArg.endsWith(".json") ? taskArg : join(taskArg, "task.json"));
const taskDir = dirname(taskJson);
const def: TaskDefinition = JSON.parse(readFileSync(taskJson, "utf8"));
const defErrors = taskDefinitionErrors(def);
if (defErrors.length) throw new Error(`${taskJson}:\n- ${defErrors.join("\n- ")}`);
const config = mergeConfig(mergeConfig(DEFAULT_CONFIG, def.config ?? {}), args.config ? JSON.parse(readFileSync(args.config as string, "utf8")) : {});

let task = "";
if (state) {
	task = state.task;
	if (state.status === "failed") {
		// A resumed failed run retries the step it stopped on.
		state.status = "running";
		delete state.failure;
		for (const t of state.tasks) if (t.status === "failed") t.status = t.scenarios.length ? "planned" : "pending";
	}
} else {
	task = readFileSync(join(taskDir, def.prompt), "utf8");
	if (def.seed) cpSync(join(taskDir, def.seed), ws, { recursive: true });
}

/** Anything in the workspace before the first step is existing work: T1 then also gets an integration step. */
function workspaceHasFiles(): boolean {
	const walk = (d: string): boolean =>
		readdirSync(d, { withFileTypes: true }).some((e) => (e.name.startsWith(".") ? false : e.isDirectory() ? walk(join(d, e.name)) : true));
	return walk(ws);
}

writeFileSync(
	join(runDir, "run.json"),
	JSON.stringify({ started: new Date().toISOString(), model, thinking, image, port, taskDir, config }, null, 2),
);

// ----------------------------------------------------------- the docker env --

const docker = (argv: string[], opts: { input?: string; timeoutMs: number; name: string; stdout?: string; stderr?: string }) =>
	new Promise<{ code: number | null; timedOut: boolean; out: string; ms: number }>((done) => {
		const t0 = Date.now();
		const p = spawn("docker", argv, { stdio: ["pipe", "pipe", "pipe"] });
		let out = "";
		let timedOut = false;
		p.stdout.on("data", (d) => {
			out += d;
			if (opts.stdout) appendFileSync(opts.stdout, d);
		});
		p.stderr.on("data", (d) => {
			if (opts.stderr) appendFileSync(opts.stderr, d);
		});
		const timer = setTimeout(() => {
			timedOut = true;
			spawnSync("docker", ["kill", opts.name], { stdio: "ignore" });
		}, opts.timeoutMs);
		p.on("close", (code) => {
			clearTimeout(timer);
			done({ code, timedOut, out, ms: Date.now() - t0 });
		});
		p.stdin.end(opts.input ?? "");
	});

// The task's own check scripts (task.json `checks` may call /task/checks/...) are
// visible to the agent — it has to pass them — but the rest of the task
// directory, the grader above all, is not.
const taskChecks = existsSync(join(taskDir, "checks")) ? ["-v", `${join(taskDir, "checks")}:/task/checks:ro`] : [];
const mounts = (stepHost: string) => ["-v", `${ws}:/workspace`, "-v", `${PLUGIN_DIR}:/opt/pi-small:ro`, "-v", `${stepHost}:/harness`, ...taskChecks, "-w", "/workspace"];

/** Copy session files written during a run (pi's own + pi-small's log) into the step directory. */
function collectSessions(stepHost: string, since: number) {
	const home = join(ws, ".home");
	if (!existsSync(home)) return;
	const walk = (d: string) => {
		for (const e of readdirSync(d, { withFileTypes: true })) {
			const p = join(d, e.name);
			if (e.isDirectory()) walk(p);
			else if (e.name.endsWith(".jsonl") && statSync(p).mtimeMs >= since - 1000) {
				const dest = join(stepHost, "sessions", relative(home, p).replace(/[\\/]/g, "__").replace(/^\.+/, ""));
				mkdirSync(dirname(dest), { recursive: true });
				copyFileSync(p, dest);
			}
		}
	};
	walk(home);
}

const hostDirs = new Map<string, string>();
let agentRuns = 0;

const env: WorkflowEnv = {
	checkScript: "/opt/pi-small/workflow/check.py",
	prepareStep(label) {
		let name = label;
		for (let n = 2; existsSync(join(runDir, "steps", name)); n++) name = `${label}~${n}`;
		const host = join(runDir, "steps", name);
		mkdirSync(host, { recursive: true });
		hostDirs.set(name, host);
		log(`step ${name}`);
		return { name, out: "/harness/out.json", checkSpecPath: "/harness/check.json" };
	},
	writeStepFile(dir, name, data) {
		writeFileSync(join(hostDirs.get(dir.name)!, name), JSON.stringify(data, null, 2));
	},
	async runAgent(dir, prompt, resume, timeoutMs): Promise<AgentRun> {
		const host = hostDirs.get(dir.name)!;
		const n = ++agentRuns;
		writeFileSync(join(host, `prompt-${n}${resume ? "-nudge" : ""}.md`), prompt);
		const name = `wf-${process.pid}-${n}`;
		const t0 = Date.now();
		const r = await docker(
			[
				"run", "--rm", "-i", "--name", name,
				...mounts(host),
				"-e", "HOME=/workspace/.home",
				"-e", "PI_SMALL_REMOTE=1",
				"-e", "PI_SMALL_HOST=host.docker.internal",
				"-e", `PI_SMALL_PORT=${port}`,
				"-e", `PI_SMALL_API_KEY=${apiKey}`,
				...(model ? ["-e", `PI_SMALL_MODEL=${model}`] : []),
				...(thinking ? ["-e", `PI_SMALL_THINKING=${thinking}`] : []),
				"-e", "PI_SMALL_WORKFLOW_STEP=/harness/step.json",
				"--add-host=host.docker.internal:host-gateway",
				image,
				"bash", "/opt/pi-small/bin/pi-small", "-p", ...(resume ? ["--continue"] : []),
			],
			{ input: prompt, timeoutMs, name, stdout: join(host, "pi.stdout.log"), stderr: join(host, "pi.stderr.log") },
		);
		collectSessions(host, t0);
		log(`  agent run ${resume ? "(nudge) " : ""}exited ${r.code}${r.timedOut ? " (TIMED OUT)" : ""} after ${(r.ms / 1000).toFixed(0)} s`);
		return { exitCode: r.code, timedOut: r.timedOut, durationMs: r.ms };
	},
	readOut(dir) {
		const p = join(hostDirs.get(dir.name)!, "out.json");
		if (!existsSync(p)) return null;
		try {
			return JSON.parse(readFileSync(p, "utf8"));
		} catch {
			return null;
		}
	},
	async runCheck(dir, spec: CheckSpec): Promise<CheckReport> {
		const host = hostDirs.get(dir.name)!;
		writeFileSync(join(host, "check.json"), JSON.stringify(spec, null, 2));
		const name = `wf-check-${process.pid}-${Date.now()}`;
		const r = await docker(
			["run", "--rm", "--network", "none", "--name", name, ...mounts(host), image, "python3", "/opt/pi-small/workflow/check.py", "/harness/check.json", "/workspace"],
			{ timeoutMs: (spec.testTimeoutSec + 120) * 1000, name },
		);
		let report: CheckReport;
		try {
			report = JSON.parse(r.out.trim().split("\n").pop() ?? "");
		} catch {
			report = { ok: false, problems: [`the check did not produce a report (exit ${r.code}${r.timedOut ? ", timed out" : ""})`] };
		}
		const n = readdirSync(host).filter((f) => f.startsWith("check-report")).length + 1;
		writeFileSync(join(host, `check-report-${n}.json`), JSON.stringify(report, null, 2));
		const t = report.tests;
		log(`  check: ${report.ok ? "PASS" : "FAIL"}${t ? ` (suite ${t.timedOut ? "timed out" : `exit ${t.rc}`}${t.count != null ? `, ${t.count} tests` : ""})` : ""}${report.ok ? "" : ` — ${report.problems[0]}`}`);
		return report;
	},
	saveState(s) {
		writeFileSync(join(runDir, "state.json"), JSON.stringify(s, null, 2));
		writeFileSync(join(runDir, "spec.md"), renderSpec(s));
	},
	event,
};

// --------------------------------------------------------------- run it --

const t0 = Date.now();
event({ type: "workflow_start", model, runDir, resume: !!args.resume });
const deadlineArg = args.deadline as string | undefined;
const deadline = deadlineArg ? (/^\d+$/.test(deadlineArg) ? Number(deadlineArg) : Date.parse(deadlineArg)) : undefined;
if (deadline !== undefined && !Number.isFinite(deadline)) throw new Error(`--deadline ${deadlineArg} is not a time`);
if (deadline !== undefined) log(`deadline ${new Date(deadline).toISOString()} (${((deadline - Date.now()) / 60_000).toFixed(0)} min from now)`);
const final = await runWorkflow(env, { config, task, profile: profileOf(def), preexistingCode: state ? state.preexistingCode : workspaceHasFiles(), state, deadline });
const minutes = ((Date.now() - t0) / 60_000).toFixed(1);
event({ type: "workflow_end", status: final.status, failure: final.failure, minutes: Number(minutes) });
log(`workflow ${final.status.toUpperCase()} after ${minutes} min${final.failure ? ` — ${final.failure.split("\n")[0]}` : ""}`);

if (def.grader && !args["no-grade"]) {
	const name = `wf-grade-${process.pid}`;
	const r = await docker(
		["run", "--rm", "--network", "none", "--name", name, "-v", `${ws}:/workspace`, "-v", `${taskDir}:/task:ro`, "-w", "/workspace", image, "bash", "-c", def.grader],
		{ timeoutMs: 600_000, name },
	);
	writeFileSync(join(runDir, "grade.json"), r.out);
	let summary = `exit ${r.code}${r.timedOut ? " (timed out)" : ""}`;
	try {
		const g = JSON.parse(r.out.trim().split("\n").pop() ?? "");
		if (typeof g.passed === "number") summary = `${g.passed}/${g.total} checks passed`;
	} catch {}
	event({ type: "grade", summary, exitCode: r.code });
	log(`grader: ${summary}`);
}
log(`run directory: ${runDir}`);
process.exit(final.status === "completed" ? 0 : 1);
