#!/usr/bin/env node
/**
 * run.ts — run one task through the staged workflow.
 *
 *   node workflow/run.ts --task workflow/tasks/books-api --model Granite-4.2-3B-Q8_0
 *   node workflow/run.ts --task … --models Granite-4.2-3B-Q8_0,LFM2.5-2.6B-Q8_0 --config workflow/configs/rotation-10turns.json
 *   node workflow/run.ts --task … --model … --local        # no docker: pi runs here (development)
 *   node workflow/run.ts --resume --run-dir workflow-runs/<dir>
 *
 * The harness is task-agnostic; everything about a particular task — its text,
 * how to run its tests, extra checks, a grader, starting code — comes from the
 * task directory's task.json (see tasks/README.md).
 *
 * The workflow itself runs INSIDE one pi-small process (../lib/workflow-command.ts):
 * every step, every fresh retry and every model switch in the rotation happens
 * there. This script is only the host side:
 *
 *   1. makes sure ../proxy.mjs serves the first model on --port (starting it if
 *      needed); the plugin switches models through it;
 *   2. starts the pi-small process — in the sandbox container, or directly with
 *      --local — in pi's RPC mode (./pi-rpc.ts);
 *   3. writes run-spec.json and sends ONE command, `/workflow run <spec>`, then
 *      waits for the workflow's end marker in events.jsonl;
 *   4. runs the task's grader, which the model never sees.
 *
 * Options:
 *   --task DIR         a task directory holding task.json (or the task.json itself);
 *                      required unless --resume
 *   --model ALIAS      the model (roster alias)
 *   --models A,B,C     a rotation instead: every failed session moves to the next model
 *   --thinking on|off  thinking mode, for models that have one
 *   --run-dir DIR      where state, logs and the workspace go
 *                      (default workflow-runs/<timestamp>-<model>)
 *   --ws DIR           the workspace (default <run-dir>/ws)
 *   --config FILE      JSON overrides for DEFAULT_CONFIG, applied over the task's own
 *   --deadline TIME    ISO time (or epoch ms): no step starts after it; the run
 *                      ends "stopped" and is still graded
 *   --no-grade         skip the task's grader
 *   --no-serve         do not start a proxy: one must already answer on --port
 *   --local            run pi (and the grader) here instead of in the container
 *   --build            rebuild the sandbox image first (default: only when it is missing)
 *   --no-build         never build it, even when missing
 *   --port N --api-key K --image NAME
 *   --resume           continue the run in --run-dir from its state.json
 *
 * The run directory:
 *   run.json, run-spec.json   what was asked for; what the plugin was given
 *   state.json, spec.md       the workflow state (--resume reads it); the enriched task
 *   events.jsonl, workflow.log    every step, session and check, with timings
 *   agent.events.jsonl / agent.stderr.log   the pi process's RPC events and stderr
 *   proxy.log                 the host proxy, when this script started it
 *   current-step.json         the step the plugin's next session reads
 *   steps/NN-<kind>[-Tk]-aN/  the prompt, step.json, check.json, out.json, check reports
 *   grade.json                the task grader's output, if the task has one
 *   home/                     the agent's HOME: pi's config and session files, pi-small's
 *                             session logs. Outside the workspace, so a model listing
 *                             /workspace does not find (and read) its own transcripts.
 *   ws/                       the workspace
 */

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { proxyStatus } from "../lib/proxy-client.ts";
import type { RunSpec } from "../lib/workflow-command.ts";
import { DEFAULT_CONFIG, mergeConfig, profileOf, type TaskDefinition, taskDefinitionErrors, type WorkflowState } from "../lib/workflow.ts";
import { PiRpc } from "./pi-rpc.ts";

const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ------------------------------------------------------------------ args --

function parseArgs(argv: string[]) {
	const o: Record<string, string | boolean> = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`);
		const key = a.slice(2);
		if (["no-serve", "no-build", "build", "resume", "help", "no-grade", "local"].includes(key)) o[key] = true;
		else o[key] = argv[++i] ?? "";
	}
	return o;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
	console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("*/")[0]);
	process.exit(0);
}

const local = !!args.local;
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const rotation = args.models ? (args.models as string).split(",").map((m) => m.trim()).filter(Boolean) : [];
const model = rotation[0] ?? ((args.model as string) || "");
const runDir = resolve((args["run-dir"] as string) || join("workflow-runs", `${stamp}-${rotation.length ? "rotation" : model || "served"}`));
const ws = resolve((args.ws as string) || join(runDir, "ws"));
const image = (args.image as string) || "pi-small-agent:latest";
const port = Number((args.port as string) || process.env.PI_SMALL_PORT || "8123");
const apiKey = (args["api-key"] as string) || process.env.PI_SMALL_API_KEY || "sk-bench";
const thinking = (args.thinking as string) || "";

mkdirSync(join(runDir, "steps"), { recursive: true });
mkdirSync(ws, { recursive: true });
mkdirSync(join(runDir, "home"), { recursive: true });

const log = (msg: string) => console.error(`[run ${new Date().toISOString().slice(11, 19)}] ${msg}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------- the task --

let state: WorkflowState | undefined;
if (args.resume) state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
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
	if (state.status !== "running") {
		// A resumed run retries the step it stopped on.
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

const deadlineArg = args.deadline as string | undefined;
const deadline = deadlineArg ? (/^\d+$/.test(deadlineArg) ? Number(deadlineArg) : Date.parse(deadlineArg)) : undefined;
if (deadline !== undefined && !Number.isFinite(deadline)) throw new Error(`--deadline ${deadlineArg} is not a time`);

writeFileSync(join(runDir, "run.json"), JSON.stringify({ started: new Date().toISOString(), model, rotation, thinking, image, port, local, taskDir, deadline: deadline ?? null, config }, null, 2));

// ------------------------------------------------------------- the proxy --

const endpoint = { host: "127.0.0.1", port, apiKey };
let proxyProc: ChildProcess | null = null;

async function ensureProxy(): Promise<void> {
	const status = await proxyStatus(endpoint);
	if (status) {
		log(`proxy already on port ${port}, serving ${status.alias ?? "nothing"} (${status.state})`);
		return;
	}
	if (args["no-serve"]) throw new Error(`--no-serve, but no pi-small proxy answers on port ${port}`);
	// A bare llama-server from serve.mjs may hold the port: stop it (serve.mjs only
	// stops one it started itself) so the proxy can take the port over.
	spawnSync(process.execPath, [join(PLUGIN_DIR, "serve.mjs"), "--stop"], { env: { ...process.env, PI_SMALL_PORT: String(port) }, stdio: "ignore" });
	log(`starting the proxy on port ${port}${model ? `, first model ${model}` : ""} …`);
	const out = openSync(join(runDir, "proxy.log"), "a");
	proxyProc = spawn(
		process.execPath,
		[join(PLUGIN_DIR, "proxy.mjs"), ...(model ? ["--model", model] : []), ...(thinking ? ["--thinking", thinking] : []), ...(local ? ["--host", "127.0.0.1"] : [])],
		{ env: { ...process.env, PI_SMALL_PORT: String(port), PI_SMALL_API_KEY: apiKey }, stdio: ["ignore", out, out] },
	);
	for (const t0 = Date.now(); Date.now() - t0 < 20 * 60_000; await sleep(1000)) {
		const s = await proxyStatus(endpoint);
		if (s?.state === "ready" && (!model || s.alias === model)) {
			log(`proxy serving ${s.alias} (ctx ${s.ctx})`);
			return;
		}
		if (proxyProc.exitCode !== null) throw new Error(`the proxy exited ${proxyProc.exitCode}; see ${join(runDir, "proxy.log")}`);
	}
	throw new Error(`the proxy did not become ready; see ${join(runDir, "proxy.log")}`);
}

// ------------------------------------------------------------- the image --

if (!local) {
	const haveImage = spawnSync("docker", ["image", "inspect", image], { stdio: "ignore" }).status === 0;
	if (args.build || (!haveImage && !args["no-build"])) {
		log(`building ${image} …`);
		const b = spawnSync("docker", ["build", "-q", "-t", image, join(PLUGIN_DIR, "docker")], { stdio: ["ignore", "ignore", "inherit"] });
		if (b.status !== 0) throw new Error("docker build failed");
	}
}

// ------------------------------------------------------------- the agent --

// Paths as the pi process sees them: the container mounts the run directory at
// /wf and the plugin read-only at /opt/pi-small; --local uses the host paths.
const view = local ? { runDir, plugin: PLUGIN_DIR } : { runDir: "/wf", plugin: "/opt/pi-small" };
const stepFilePath = `${view.runDir}/current-step.json`;

function startAgent(): PiRpc {
	const env: Record<string, string> = {
		PI_SMALL_REMOTE: "1",
		PI_SMALL_PORT: String(port),
		PI_SMALL_API_KEY: apiKey,
		PI_SMALL_WORKFLOW_STEP: stepFilePath,
		...(model ? { PI_SMALL_MODEL: model } : {}),
		...(thinking ? { PI_SMALL_THINKING: thinking } : {}),
	};
	const events = join(runDir, "agent.events.jsonl");
	const stderr = join(runDir, "agent.stderr.log");
	if (local) {
		const piBin = join(PLUGIN_DIR, "node_modules", ".bin", "pi");
		return new PiRpc(
			"bash",
			[join(PLUGIN_DIR, "bin", "pi-small"), "--mode", "rpc"],
			{ cwd: ws, env: { ...process.env, ...env, PI_SMALL_HOST: "127.0.0.1", HOME: join(runDir, "home"), ...(existsSync(piBin) ? { PI_SMALL_PI_BIN: piBin } : {}) } },
			null,
			events,
			stderr,
		);
	}
	const name = `wf-${process.pid}-agent`;
	return new PiRpc(
		"docker",
		[
			"run", "--rm", "-i", "--name", name,
			"-v", `${ws}:/workspace`, "-v", `${PLUGIN_DIR}:/opt/pi-small:ro`, "-v", `${runDir}:/wf`,
			"-w", "/workspace",
			"-e", "HOME=/wf/home",
			"-e", "PI_SMALL_HOST=host.docker.internal",
			...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
			"--add-host=host.docker.internal:host-gateway",
			image,
			"bash", "/opt/pi-small/bin/pi-small", "--mode", "rpc",
		],
		{},
		name,
		events,
		stderr,
	);
}

/** Has the workflow written its end marker? */
function workflowEnded(): boolean {
	const p = join(runDir, "events.jsonl");
	return existsSync(p) && readFileSync(p, "utf8").includes('"type":"workflow_end"');
}

// --------------------------------------------------------------- run it --

const t0 = Date.now();
await ensureProxy();

const runSpec: RunSpec = {
	runDir: view.runDir,
	stepFilePath,
	checkScript: `${view.plugin}/workflow/check.py`,
	task,
	// A task's check commands name the plugin by its container path.
	profile: local ? JSON.parse(JSON.stringify(profileOf(def)).replaceAll("/opt/pi-small", PLUGIN_DIR)) : profileOf(def),
	config,
	preexistingCode: state ? state.preexistingCode : workspaceHasFiles(),
	models: rotation.length ? rotation : undefined,
	deadline,
	state,
};
writeFileSync(join(runDir, "run-spec.json"), JSON.stringify(runSpec, null, 2));

const agent = startAgent();
agent.start();
log(`agent: pi-small in RPC mode${local ? " (local)" : " (container)"}; sending /workflow run`);
const limitMs = (deadline ? Math.max(0, deadline - Date.now()) : 24 * 3600_000) + 20 * 60_000;
let agentGone = false;
agent.waitFor((ev) => ev.type === "__exit__", limitMs).then(
	() => (agentGone = true),
	() => {},
);
// The response may come when the command is accepted or when it finishes;
// events.jsonl's workflow_end is the end marker either way.
agent.send({ type: "prompt", message: `/workflow run ${view.runDir}/run-spec.json` }, limitMs).catch((e) => log(`agent: ${e.message}`));
for (const t1 = Date.now(); !workflowEnded() && !agentGone && Date.now() - t1 < limitMs; ) await sleep(2000);
if (!workflowEnded()) log(agentGone ? "agent: the pi process exited before the workflow ended — see agent.stderr.log" : "agent: gave up waiting for the workflow");
await agent.close();

const final: WorkflowState | null = existsSync(join(runDir, "state.json")) ? JSON.parse(readFileSync(join(runDir, "state.json"), "utf8")) : null;
log(`workflow ${final?.status?.toUpperCase() ?? "DID NOT START"} after ${((Date.now() - t0) / 60_000).toFixed(1)} min${final?.failure ? ` — ${final.failure.split("\n")[0]}` : ""}`);

// ------------------------------------------------------------- the grader --

if (def.grader && !args["no-grade"]) {
	const r = local
		? spawnSync("bash", ["-c", def.grader.replaceAll("/task", taskDir).replaceAll("/workspace", ws)], { cwd: ws, encoding: "utf8", timeout: 600_000 })
		: spawnSync("docker", ["run", "--rm", "--network", "none", "-v", `${ws}:/workspace`, "-v", `${taskDir}:/task:ro`, "-w", "/workspace", image, "bash", "-c", def.grader], {
				encoding: "utf8",
				timeout: 600_000,
			});
	const out = r.stdout ?? "";
	writeFileSync(join(runDir, "grade.json"), out);
	let summary = `exit ${r.status}`;
	try {
		const g = JSON.parse(out.trim().split("\n").pop() ?? "");
		summary = g.startup && !g.startup.ok ? "server did not start" : `${g.passed}/${g.total} checks passed`;
	} catch {}
	appendFileSync(join(runDir, "events.jsonl"), JSON.stringify({ ts: new Date().toISOString(), type: "grade", summary, exitCode: r.status }) + "\n");
	log(`grader: ${summary}`);
}

(proxyProc as ChildProcess | null)?.kill();
log(`run directory: ${runDir}`);
process.exit(final?.status === "completed" ? 0 : 1);
