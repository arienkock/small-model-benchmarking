#!/usr/bin/env node
/**
 * run.ts — run one task through the staged workflow.
 *
 *   node workflow/run.ts --task workflow/tasks/books-api --model Granite-4.2-3B-Q8_0
 *   node workflow/run.ts --task … --models Granite-4.2-3B-Q8_0,LFM2.5-2.6B-Q8_0 --config workflow/configs/rotation-10turns.json
 *   node workflow/run.ts --task … --model … --local        # no docker: pi runs here (development)
 *   node workflow/run.ts --resume --run-dir workflow-runs/<dir>
 *   node workflow/run.ts --task … --models A,B --review completeness,correctness --seed-ws some/existing-code
 *   node workflow/run.ts --task … --models A,B --fix --seed-ws some/existing-code --config workflow/configs/fix-loop.json
 *   node workflow/run.ts --task … --model Qwen3.6-35B-A3B-Q4_K_M --freeform --cap-min 210
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
 *   --models A,B,C     a rotation (the staged workflow) or the reviewer roster (--review)
 *   --thinking on|off  thinking mode, for models that have one
 *   --run-dir DIR      where state, logs and the workspace go
 *                      (default workflow-runs/<timestamp>-<model>)
 *   --ws DIR           the workspace (default <run-dir>/ws)
 *   --seed-ws DIR      copy DIR's contents into the workspace before starting
 *                      (__pycache__ skipped), e.g. an existing implementation to review
 *   --config FILE      JSON overrides for DEFAULT_CONFIG, applied over the task's own
 *   --deadline TIME    ISO time (or epoch ms): no step starts after it; the run
 *                      ends "stopped" and is still graded
 *   --review v1,v2,…   run the review-only experiment (../lib/review.ts) instead of the
 *                      staged workflow: every model in --models reviews the workspace
 *                      once per listed variant (keys of REVIEW_VARIANTS — completeness,
 *                      correctness, fidelity, all). No --resume, no grader.
 *   --fix              run the fix loop (../lib/fix-loop.ts) on the workspace instead of the
 *                      staged workflow: probe (the task's checks + config.fixChecks) →
 *                      review → fix, until only low-priority findings remain. --models
 *                      is the fixer rotation. No --resume; graded like a workflow run.
 *   --reviewers A,B    --fix: the reviewer rotation (default: --models)
 *   --review-variant V --fix: the review prompt (default "all")
 *   --freeform         no workflow at all: ONE plain pi-small session gets the task's
 *                      prompt.md as its only message — no step tool, no checks, no
 *                      feedback — and runs until it stops by itself or --cap-min.
 *                      Graded; freeform.json records time to done, turns, tokens.
 *   --cap-min N        --freeform: wall-clock cap in minutes (default 210); at the
 *                      cap the session is aborted and the workspace graded as it is
 *   --no-grade         skip the task's grader (ignored with --review; it never grades)
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
 *   reviews.json               --review only: one ReviewResult per model/variant/repeat
 *   fix-loop.json              --fix only: every round's probe, review, selection and fixes
 *   freeform.json              --freeform only: how the session ended, minutes, turns, tokens
 *   events.jsonl, workflow.log    every step, session and check, with timings
 *   agent.events.jsonl / agent.stderr.log   the pi process's RPC events and stderr
 *   proxy.log                 the host proxy, when this script started it
 *   current-step.json         the step the plugin's next session reads
 *   steps/NN-<kind>[-Tk]-aN/  the prompt, step.json, check.json, out.json, check reports
 *                             (--review: NN-review-<variant>-<model>/)
 *   grade.json                the task grader's output, if the task has one (not --review)
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
import { countByPriority, type FixLoopResult } from "../lib/fix-loop.ts";
import { REVIEW_VARIANTS, type ReviewResult } from "../lib/review.ts";
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
		if (["no-serve", "no-build", "build", "resume", "help", "no-grade", "local", "fix", "freeform"].includes(key)) o[key] = true;
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

const reviewVariants = args.review ? (args.review as string).split(",").map((v) => v.trim()).filter(Boolean) : [];
const unknownVariants = reviewVariants.filter((v) => !(v in REVIEW_VARIANTS));
if (unknownVariants.length) throw new Error(`--review: unknown variant(s) ${unknownVariants.join(", ")} — one of ${Object.keys(REVIEW_VARIANTS).join(", ")}`);
const reviewMode = reviewVariants.length > 0;
const fixMode = !!args.fix;
const freeform = !!args.freeform;
const capMin = Number((args["cap-min"] as string) || "210");
if (freeform) {
	if (reviewMode || args.fix || args.resume) throw new Error("--freeform cannot be combined with --review, --fix or --resume");
	if (!model) throw new Error("--freeform needs --model");
	if (!(capMin > 0)) throw new Error(`--cap-min ${args["cap-min"]} is not a positive number of minutes`);
}
const reviewers = args.reviewers ? (args.reviewers as string).split(",").map((m) => m.trim()).filter(Boolean) : rotation;
const reviewVariant = (args["review-variant"] as string) || "all";
if (fixMode) {
	if (reviewMode || args.resume) throw new Error("--fix cannot be combined with --review or --resume");
	if (!rotation.length) throw new Error("--fix needs --models (the fixer rotation)");
	if (!(reviewVariant in REVIEW_VARIANTS)) throw new Error(`--review-variant: unknown variant ${reviewVariant} — one of ${Object.keys(REVIEW_VARIANTS).join(", ")}`);
}

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
const loadedConfig = mergeConfig(mergeConfig(DEFAULT_CONFIG, def.config ?? {}), args.config ? JSON.parse(readFileSync(args.config as string, "utf8")) : {});
// Check commands name the plugin by its container path; --local runs them here.
const config = local ? JSON.parse(JSON.stringify(loadedConfig).replaceAll("/opt/pi-small", PLUGIN_DIR)) : loadedConfig;

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
	if (args["seed-ws"]) {
		// __pycache__ is a build artifact of whatever last ran the seed directory's
		// own tests, not part of the code under review; copying it in is at best
		// clutter and at worst stale bytecode a model's session would run instead
		// of its own edits.
		cpSync(resolve(args["seed-ws"] as string), ws, { recursive: true, filter: (src) => !src.split(/[\\/]/).includes("__pycache__") });
	}
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
		// Free-form: plain pi-small, so no step file and no step tool.
		...(freeform ? {} : { PI_SMALL_WORKFLOW_STEP: stepFilePath }),
		...(model ? { PI_SMALL_MODEL: model } : {}),
		...(thinking ? { PI_SMALL_THINKING: thinking } : {}),
		// Passed through for free-form experiments: replaces the terse style text.
		...(process.env.PI_SMALL_STYLE !== undefined ? { PI_SMALL_STYLE: process.env.PI_SMALL_STYLE } : {}),
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
	review: reviewMode ? { variants: reviewVariants } : undefined,
	fix: fixMode ? { reviewers, fixers: rotation, variant: reviewVariant } : undefined,
};
writeFileSync(join(runDir, "run-spec.json"), JSON.stringify(runSpec, null, 2));

const agent = startAgent();
agent.start();
let freeformEnd: "settled" | "cap" | "exited" | undefined;
if (freeform) {
	freeformEnd = await runFreeform(agent);
} else {
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
}
await agent.close();

/**
 * --freeform: the task's prompt as the one message of one plain session. Done
 * when the agent has settled (idle, no retry after a compaction) and stays so
 * for 30 s; at --cap-min it is aborted. Whatever is in the workspace then is
 * what gets graded.
 */
async function runFreeform(a: PiRpc): Promise<"settled" | "cap" | "exited"> {
	const capMs = capMin * 60_000;
	log(`agent: pi-small in RPC mode${local ? " (local)" : " (container)"}; free-form session on ${model}, cap ${capMin} min`);
	let running = false;
	let settledAt = 0;
	let gone = false;
	const started = Date.now();
	// A predicate that never matches: a way to see every event as it arrives.
	a.waitFor((ev) => {
		if (ev.type === "agent_start") running = true;
		if (ev.type === "agent_settled" || ev.type === "agent_end") {
			running = false;
			settledAt = Date.now();
		}
		return false;
	}, capMs + 30 * 60_000).catch(() => (gone = true));
	appendFileSync(join(runDir, "events.jsonl"), JSON.stringify({ ts: new Date().toISOString(), type: "freeform_start", model, capMin }) + "\n");
	a.send({ type: "prompt", message: task }, capMs + 30 * 60_000).catch((e) => log(`agent: ${e.message}`));
	let end: "settled" | "cap" | "exited";
	for (;;) {
		await sleep(2000);
		if (gone) {
			end = "exited";
			break;
		}
		if (settledAt && !running && Date.now() - settledAt > 30_000) {
			end = "settled";
			break;
		}
		if (Date.now() - started > capMs) {
			end = "cap";
			log(`free-form: the ${capMin}-minute cap — aborting the session`);
			await a.send({ type: "abort" }, 60_000).catch((e) => log(`agent: abort: ${e.message}`));
			for (const t1 = Date.now(); running && Date.now() - t1 < 120_000; ) await sleep(1000);
			break;
		}
	}
	const minutes = Number(((end === "settled" ? settledAt : Date.now()) - started) / 60_000).toFixed(1);
	appendFileSync(join(runDir, "events.jsonl"), JSON.stringify({ ts: new Date().toISOString(), type: "freeform_end", end, minutes: Number(minutes) }) + "\n");
	log(`free-form session ended (${end}) after ${minutes} min`);
	return end;
}

/** Turns, tokens and compactions of the free-form session, from the agent's own event log. */
function freeformStats() {
	const stats = { turns: 0, assistantMessages: 0, toolCalls: 0, compactions: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, maxTurnOutputTokens: 0 };
	const p = join(runDir, "agent.events.jsonl");
	if (!existsSync(p)) return stats;
	for (const line of readFileSync(p, "utf8").split("\n")) {
		let e: any;
		try {
			e = JSON.parse(line);
		} catch {
			continue;
		}
		if (e.type === "turn_end") stats.turns++;
		if (e.type === "tool_execution_start") stats.toolCalls++;
		if (e.type === "compaction_end" && !e.aborted) stats.compactions++;
		const m = e.type === "message_end" ? e.message : undefined;
		if (m?.role === "assistant" && m.usage) {
			stats.assistantMessages++;
			stats.inputTokens += m.usage.input ?? 0;
			stats.outputTokens += m.usage.output ?? 0;
			stats.cacheReadTokens += m.usage.cacheRead ?? 0;
			stats.maxTurnOutputTokens = Math.max(stats.maxTurnOutputTokens, m.usage.output ?? 0);
		}
	}
	return stats;
}

let exitCode: number;

if (reviewMode) {
	// No WorkflowState (no state.json) for a review run — reviews.json is its
	// record instead: one ReviewResult per model/variant/repeat.
	const reviewsPath = join(runDir, "reviews.json");
	const reviews: ReviewResult[] = existsSync(reviewsPath) ? JSON.parse(readFileSync(reviewsPath, "utf8")) : [];
	log(`review ${reviews.length ? "COMPLETED" : "DID NOT START"} after ${((Date.now() - t0) / 60_000).toFixed(1)} min, ${reviews.length} session(s)`);
	for (const r of reviews) {
		const counts = { high: 0, medium: 0, low: 0 };
		for (const f of r.findings) counts[f.priority]++;
		const secs = (r.run.durationMs / 1000).toFixed(0);
		log(`  ${r.model} / ${r.variant}: ${r.ok ? "submitted" : "NOT submitted"} — high ${counts.high}, medium ${counts.medium}, low ${counts.low}; ${r.run.turns ?? 0} turn(s), ${secs}s`);
	}
	// --review never grades: there is nothing for a grader to check against — a
	// review changes no files. (--no-grade is a no-op here, not an error.)
	exitCode = reviews.length > 0 ? 0 : 1;
} else {
	let ok: boolean;
	if (fixMode) {
		const p = join(runDir, "fix-loop.json");
		const result: FixLoopResult | null = existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null;
		log(`fix loop ${result?.status?.toUpperCase() ?? "DID NOT START"} after ${((Date.now() - t0) / 60_000).toFixed(1)} min${result ? `, ${result.rounds.length} round(s)` : ""}`);
		for (const r of result?.rounds ?? []) {
			const source = r.machineFindings.length ? `probe: ${r.machineFindings.length} finding(s)` : r.review ? `review (${r.review.model}): ${r.review.ok ? countByPriority(r.review.findings) : "no submission"}` : "no review";
			const fixes = r.fixes.map((f) => `${f.model ?? "?"} ${f.ok ? "ok" : "FAILED"}`).join(", ");
			log(`  round ${r.round}: ${source}${r.selected.length ? `; fixing ${r.selected.length}: ${fixes || "not attempted"}` : ""}`);
		}
		if (result) log(`  remaining: ${countByPriority(result.remaining)}`);
		ok = result?.status === "clean";
	} else if (freeform) {
		const minutesToEnd = readFileSync(join(runDir, "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.type === "freeform_end")?.minutes ?? null;
		const record = { model, thinking: thinking || null, capMin, end: freeformEnd, minutes: minutesToEnd, ...freeformStats() };
		writeFileSync(join(runDir, "freeform.json"), JSON.stringify(record, null, 2));
		log(`free-form: ${record.end} after ${record.minutes} min; ${record.turns} turn(s), ${record.toolCalls} tool call(s), ${record.compactions} compaction(s); tokens in ${record.inputTokens} (+${record.cacheReadTokens} cached), out ${record.outputTokens}`);
		ok = freeformEnd === "settled";
	} else {
		const final: WorkflowState | null = existsSync(join(runDir, "state.json")) ? JSON.parse(readFileSync(join(runDir, "state.json"), "utf8")) : null;
		log(`workflow ${final?.status?.toUpperCase() ?? "DID NOT START"} after ${((Date.now() - t0) / 60_000).toFixed(1)} min${final?.failure ? ` — ${final.failure.split("\n")[0]}` : ""}`);
		ok = final?.status === "completed";
	}

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
			summary = g.startup && !g.startup.ok ? "server did not start" : `${g.passed}/${g.total} checks passed${g.skipped ? ` (${g.skipped} skipped: a check they depend on failed)` : ""}`;
		} catch {}
		appendFileSync(join(runDir, "events.jsonl"), JSON.stringify({ ts: new Date().toISOString(), type: "grade", summary, exitCode: r.status }) + "\n");
		log(`grader: ${summary}`);
	}
	exitCode = ok ? 0 : 1;
}

if (proxyProc) {
	(proxyProc as ChildProcess).kill();
	spawnSync(process.execPath, [join(PLUGIN_DIR, "serve.mjs"), "--stop"], { env: { ...process.env, PI_SMALL_PORT: process.env.PI_SMALL_BACKEND_PORT ?? "8125" }, stdio: "ignore" });
}
log(`run directory: ${runDir}`);
process.exit(exitCode);
