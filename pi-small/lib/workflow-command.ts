/**
 * workflow-command.ts — `/workflow run <spec.json>`: the staged workflow driven
 * from INSIDE the pi process.
 *
 * ../workflow/run.ts (on the host) writes a run spec and sends this one command
 * over pi's RPC mode; everything else happens here, in the one pi-small
 * process:
 *
 *   - every step and every retry is `newSession()`: an empty context. pi gives
 *     the new session a new plugin instance, which reads the step file at
 *     PI_SMALL_WORKFLOW_STEP and registers that step's submit tool;
 *   - a session is watched from here: turns are counted from its session
 *     entries, and it is aborted at `maxTurns` or its time limit;
 *   - a model rotation switches models through the host proxy (../proxy.mjs);
 *     PI_SMALL_MODEL is set in this process first, so the next session's plugin
 *     asks for the same model rather than switching back;
 *   - the harness's check (../workflow/check.py) runs here too, as a child
 *     process — the model cannot edit it (/opt/pi-small is read-only).
 *
 * The control flow itself is ./workflow-runner.ts, unchanged, with a
 * WorkflowEnv implemented on top of the pi session API instead of docker.
 */

import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type ProxyEndpoint, proxySwitch } from "./proxy-client.ts";
import { loadRoster, resolveThinking } from "./roster.ts";
import { type AgentRun, runWorkflow, type SessionLimits, type StepDir, type WorkflowEnv } from "./workflow-runner.ts";
import { type CheckReport, type CheckSpec, renderSpec, type TaskProfile, type WorkflowConfig, type WorkflowState } from "./workflow.ts";

/** What the host writes for one run. Paths are as THIS process sees them. */
export interface RunSpec {
	runDir: string;
	/** The fixed path the plugin reads a step file from (PI_SMALL_WORKFLOW_STEP). */
	stepFilePath: string;
	checkScript: string;
	task: string;
	profile: TaskProfile;
	config: WorkflowConfig;
	preexistingCode: boolean;
	models?: string[];
	deadline?: number;
	state?: WorkflowState;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Assistant messages in a session so far — one per turn. */
function assistantTurns(sm: any): number {
	try {
		return (sm.getEntries() as any[]).filter((e) => e?.type === "message" && e?.message?.role === "assistant").length;
	} catch {
		return 0;
	}
}

function runProcess(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ code: number | null; out: string; timedOut: boolean }> {
	return new Promise((resolve) => {
		const p = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		let timedOut = false;
		p.stdout.on("data", (d) => (out += d));
		p.stderr.on("data", () => {});
		const t = setTimeout(() => {
			timedOut = true;
			p.kill("SIGKILL");
		}, timeoutMs);
		p.on("close", (code) => {
			clearTimeout(t);
			resolve({ code, out, timedOut });
		});
	});
}

/**
 * Run one session to its end, a turn limit or its time limit. Called inside
 * `withSession`, with the replacement session's context.
 */
async function runSession(c: any, prompt: string, limits: SessionLimits): Promise<AgentRun> {
	const t0 = Date.now();
	let error: string | undefined;
	let sent = false;
	c.sendUserMessage(prompt).then(
		() => (sent = true),
		(e: any) => (error = String(e?.message ?? e)),
	);
	let started = false;
	let turns = 0;
	let timedOut = false;
	let turnLimited = false;
	for (;;) {
		await sleep(500);
		turns = assistantTurns(c.sessionManager);
		const idle = c.isIdle();
		if (!idle || turns > 0) started = true;
		if (error) break;
		if (started && idle && sent) break;
		if (!started && Date.now() - t0 > 60_000) {
			error = "the session never started";
			break;
		}
		const overTurns = limits.maxTurns > 0 && turns >= limits.maxTurns;
		const overTime = Date.now() - t0 >= limits.timeoutMs;
		if ((overTurns || overTime) && !idle) {
			turnLimited = overTurns;
			timedOut = !overTurns;
			c.abort();
			await Promise.race([c.waitForIdle(), sleep(60_000)]);
			break;
		}
	}
	return { exitCode: error ? 1 : 0, timedOut, turnLimited, turns, durationMs: Date.now() - t0 };
}

export function registerWorkflowCommand(pi: any, proxy: ProxyEndpoint, say: (ctx: any, msg: string) => void): void {
	pi.registerCommand("workflow", {
		description: "Run the staged workflow: /workflow run <run-spec.json> (written by workflow/run.ts)",
		handler: async (args: string, ctx: any) => {
			const path = args.trim().replace(/^run\s+/, "");
			if (!path || !existsSync(path)) {
				ctx.ui.notify(`workflow: no run spec at ${JSON.stringify(path)}`, "error");
				return;
			}
			const spec: RunSpec = JSON.parse(readFileSync(path, "utf8"));
			await runInProcess(spec, ctx, proxy, say);
		},
	});
}

async function runInProcess(spec: RunSpec, startCtx: any, proxy: ProxyEndpoint, say: (ctx: any, msg: string) => void): Promise<void> {
	const { runDir } = spec;
	mkdirSync(join(runDir, "steps"), { recursive: true });
	const roster = loadRoster();
	const stepDirs = new Map<string, string>();
	let cur = startCtx;
	const log = (msg: string) => {
		const line = `[workflow ${new Date().toISOString().slice(11, 19)}] ${msg}`;
		appendFileSync(join(runDir, "workflow.log"), line + "\n");
		console.error(line);
	};

	const env: WorkflowEnv = {
		checkScript: spec.checkScript,
		prepareStep(label) {
			let name = label;
			for (let n = 2; existsSync(join(runDir, "steps", name)); n++) name = `${label}~${n}`;
			const dir = join(runDir, "steps", name);
			mkdirSync(dir, { recursive: true });
			stepDirs.set(name, dir);
			log(`step ${name}`);
			return { name, out: join(dir, "out.json"), checkSpecPath: join(dir, "check.json") };
		},
		writeStepFile(dir: StepDir, name: string, data: unknown) {
			const text = JSON.stringify(data, null, 2);
			writeFileSync(join(stepDirs.get(dir.name)!, name), text);
			// The next session's plugin instance reads its step from the fixed path.
			if (name === "step.json") writeFileSync(spec.stepFilePath, text);
		},
		async runAgent(dir: StepDir, prompt: string, limits: SessionLimits): Promise<AgentRun> {
			const stepDir = stepDirs.get(dir.name)!;
			writeFileSync(join(stepDir, "prompt.md"), prompt);
			const t0 = Date.now();
			if (limits.model) {
				// The next plugin instance requests PI_SMALL_MODEL at session start; set it
				// first so it asks for the model we are switching to, not back.
				process.env.PI_SMALL_MODEL = limits.model;
				const m = roster.models.find((x) => x.alias === limits.model);
				try {
					await proxySwitch(proxy, limits.model, m ? resolveThinking(m) : null);
				} catch (e: any) {
					log(`  model switch failed: ${e.message}`);
					return { exitCode: 1, timedOut: false, durationMs: Date.now() - t0 };
				}
			}
			let result: AgentRun = { exitCode: 1, timedOut: false, durationMs: 0 };
			const budget: SessionLimits = { ...limits, timeoutMs: Math.max(0, limits.timeoutMs - (Date.now() - t0)) };
			try {
				const r = await cur.newSession({
					withSession: async (c: any) => {
						cur = c;
						result = await runSession(c, prompt, budget);
					},
				});
				if (r?.cancelled) log("  the new session was cancelled by an extension");
			} catch (e: any) {
				log(`  session error: ${e?.message ?? e}`);
			}
			result.durationMs = Date.now() - t0;
			log(
				`  session ended after ${(result.durationMs / 1000).toFixed(0)} s, ${result.turns ?? 0} turn(s)${limits.model ? ` on ${limits.model}` : ""}` +
					`${result.turnLimited ? " (TURN LIMIT)" : ""}${result.timedOut ? " (TIMED OUT)" : ""}${result.exitCode ? " (error)" : ""}`,
			);
			return result;
		},
		readOut(dir: StepDir) {
			const p = join(stepDirs.get(dir.name)!, "out.json");
			if (!existsSync(p)) return null;
			try {
				return JSON.parse(readFileSync(p, "utf8"));
			} catch {
				return null;
			}
		},
		async runCheck(dir: StepDir, checkSpec: CheckSpec): Promise<CheckReport> {
			const stepDir = stepDirs.get(dir.name)!;
			const specPath = join(stepDir, "check.json");
			writeFileSync(specPath, JSON.stringify(checkSpec, null, 2));
			const r = await runProcess("python3", [spec.checkScript, specPath, process.cwd()], process.cwd(), (checkSpec.testTimeoutSec + 180) * 1000);
			let report: CheckReport;
			try {
				report = JSON.parse(r.out.trim().split("\n").pop() ?? "");
			} catch {
				report = { ok: false, problems: [`the check did not produce a report (exit ${r.code}${r.timedOut ? ", timed out" : ""})`] };
			}
			const n = readdirSync(stepDir).filter((f) => f.startsWith("check-report")).length + 1;
			writeFileSync(join(stepDir, `check-report-${n}.json`), JSON.stringify(report, null, 2));
			const t = report.tests;
			log(`  check: ${report.ok ? "PASS" : "FAIL"}${t ? ` (suite ${t.timedOut ? "timed out" : `exit ${t.rc}`}${t.count != null ? `, ${t.count} tests` : ""})` : ""}${report.ok ? "" : ` — ${report.problems[0]}`}`);
			return report;
		},
		saveState(s: WorkflowState) {
			writeFileSync(join(runDir, "state.json"), JSON.stringify(s, null, 2));
			writeFileSync(join(runDir, "spec.md"), renderSpec(s));
		},
		event(e: Record<string, unknown>) {
			appendFileSync(join(runDir, "events.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...e }) + "\n");
		},
	};

	const t0 = Date.now();
	if (spec.models?.length) log(`model rotation: ${spec.models.join(" → ")} (next model after every failed session)`);
	if (spec.deadline) log(`deadline ${new Date(spec.deadline).toISOString()}`);
	env.event({ type: "workflow_start", models: spec.models, inProcess: true });
	const final = await runWorkflow(env, {
		config: spec.config,
		task: spec.task,
		profile: spec.profile,
		preexistingCode: spec.preexistingCode,
		state: spec.state,
		deadline: spec.deadline,
		models: spec.models,
	});
	const minutes = Number(((Date.now() - t0) / 60_000).toFixed(1));
	env.event({ type: "workflow_end", status: final.status, failure: final.failure, minutes });
	log(`workflow ${final.status.toUpperCase()} after ${minutes} min${final.failure ? ` — ${final.failure.split("\n")[0]}` : ""}`);
	try {
		say(cur, `workflow ${final.status} after ${minutes} min`);
	} catch {}
}
