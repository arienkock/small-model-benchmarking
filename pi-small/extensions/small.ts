/**
 * pi-small — the plugin half of the small-model agent scaffold.
 *
 * The entry point (bin/pi-small) starts pi with nothing: no built-in tools, no
 * skills, no context files, no discovered extensions, and a system prompt that
 * is as close to empty as pi allows. Everything the session then has comes from
 * here, deliberately, so the surface a 3B model sees is ours to control.
 *
 * This plugin owns:
 *
 *   the model      — the roster in ../roster.json, one of which is served at a
 *                    time. The full roster is registered under the
 *                    "small-local" provider, so pi's own /model picker lists
 *                    every alias; picking one there (or via /sm-model) fires
 *                    the same restart. /model can't make that switch instant
 *                    the way it is for a real hosted provider — the first
 *                    message after a switch pays for the llama-server restart.
 *   the server     — llama-server is started, health-checked, probed and killed
 *                    by this process. It is NOT assumed to be running.
 *   the parameters — context size (server restart) and temperature (per
 *                    request, no restart). In a normal pi session these live in
 *                    the harness; here they live in the plugin.
 *   the tools      — which of pi's built-in tools (bash, read, write, edit,
 *                    grep, find, ls) the model gets, and how each is configured
 *                    — see ../lib/tools.ts. roster.json's defaults.tools /
 *                    defaults.toolOptions apply unless a model overrides them,
 *                    so a guard or variant added for one model never touches
 *                    any other.
 *   the system prompt — near-empty by default; a model's roster.json
 *                    `systemPrompt` (or defaults.systemPrompt) replaces it,
 *                    re-applied every turn so it follows /sm-model.
 *
 * PER-MODEL TOOL-CALL TEMPLATES. Every model packages its tool-call channel
 * differently and some GGUFs package it wrongly. `--jinja` (always on) makes
 * llama-server use the template embedded in the GGUF, which is the right answer
 * for the current roster. When it is not, the fix is a per-model flag in
 * roster.json — `chatTemplate` (resolved against ../templates) or raw
 * `serverArgs` such as `--chat-template-file` / `--reasoning-format` /
 * `--override-kv`. Because a broken template is indistinguishable from a stupid
 * model once you are three turns into a session, the server start also runs the
 * two probes the benchmark learned to run first: does generation stop at a turn
 * boundary, and does a tool call come back through the OpenAI `tool_calls`
 * field. Two more check the settings rather than the template: does the live
 * server's sampler (/props) match the roster, and — with thinking off — does
 * the model really return no reasoning. All four are reported at startup (to
 * stderr as well when there is no UI) and re-runnable with /sm-probe.
 *
 * THINKING. A model with a `thinking` mode gets the template's own switch on
 * the command line AND on every request, plus the sampler row for that mode;
 * see `thinkingArgs` / `resolveSampler` in ../lib/roster.ts for why the budget
 * alone is not a switch.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, openSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildTool } from "../lib/tools.ts";
import {
	buildServerArgs,
	compareProps,
	ctxUsabilityWarning,
	loadRoster,
	type ModelSpec,
	PLUGIN_DIR,
	quoteForCmdShell,
	resolveCtxLadder,
	resolveMaxTokens,
	resolveSampler,
	resolveSystemPrompt,
	resolveThinking,
	resolveToolOptions,
	resolveTools,
	type Roster,
	type RosterDefaults,
	type ThinkingMode,
	thinkingKwargs,
	thinkingOverrideWarning,
	weightsSource,
} from "../lib/roster.ts";

const PROVIDER = "small-local";

/**
 * The single-response cap is per model now — `maxTokens` in roster.json,
 * default 4096 (DEFAULT_MAX_TOKENS, lib/roster.ts). It is sized for REASONING +
 * answer combined, not just the answer: pi does not set
 * compat.thinkingTokenBudgetField for this provider, so nothing tells
 * llama-server to track thinking tokens separately from max_tokens, and an
 * unrestricted think can consume the whole cap and leave no answer (see the
 * message_end handler, which says so when it happens). It must stay below pi's
 * compaction.reserveTokens, which bin/pi-small derives from the roster's
 * largest maxTokens (requiredReserveTokens) for exactly that reason.
 */

/**
 * How long a probe may take. Fixed 120/180 s timeouts were too short for the
 * beyond-VRAM models: the tool-call probe was cancelled mid-generation on
 * Qwen3.6 (~3 minutes of GPU spent for a spurious FAIL) although that model's
 * tool calls work. Probes also run with thinking OFF on a moded model, which
 * keeps them short; this just stops a slow-but-working model from failing.
 */
const probeTimeoutMs = (): number => Number(process.env.PI_SMALL_PROBE_TIMEOUT ?? 600) * 1000;

/**
 * The thinking-mode override for this process: PI_SMALL_THINKING at start
 * (forwarded into the container by pi-small-docker.sh), or /sm-thinking later.
 * Ignored for a model with no thinking mode.
 */
let thinkingOverride: string | undefined = process.env.PI_SMALL_THINKING || undefined;

// ---------------------------------------------------------------- state ---

interface ProbeResult {
	ok: boolean;
	detail: string;
}

interface Probes {
	turnBoundary?: ProbeResult;
	toolCalls?: ProbeResult;
	/** Does the live server's own sampler (/props) match what this session intends? */
	sampler?: ProbeResult;
	/** With thinking off, does the model really return no reasoning? */
	thinking?: ProbeResult;
}

class ServerState {
	proc: ChildProcess | null = null;
	/** True when we attached to a server someone else started. */
	adopted = false;
	spec: ModelSpec;
	/** What we asked llama-server for. */
	requestedCtx: number;
	/** What llama-server says it actually serves (it caps at the training ctx). */
	servedCtx: number;
	/** The active thinking mode, or null for a model that has none. */
	thinking: ThinkingMode | null;
	temp: number;
	topP: number;
	topK: number;
	repeatPenalty: number;
	minP: number;
	presencePenalty: number;
	/**
	 * A temperature set deliberately with /sm-temp. It is the ONLY sampler value
	 * that survives a model switch. Carrying the whole sampler across (as this
	 * used to) served the previous model's card to the next one — Spark's temp
	 * 1.0 to LFM2.5, whose card asks for 0.1 — the same silent mismatch the
	 * explicit-sampler rule exists to prevent.
	 */
	tempOverride: number | null = null;
	logPath = "";
	probes: Probes = {};

	constructor(spec: ModelSpec, d: RosterDefaults) {
		this.spec = spec;
		this.requestedCtx = spec.ctx ?? d.ctx;
		this.servedCtx = this.requestedCtx;
		this.thinking = resolveThinking(spec, thinkingOverride);
		const s = resolveSampler(spec, d, this.thinking);
		this.temp = s.temp;
		this.topP = s.topP;
		this.topK = s.topK;
		this.repeatPenalty = s.repeatPenalty;
		this.minP = s.minP;
		this.presencePenalty = s.presencePenalty;
	}

	/** Keep what the USER set this session (not what the last model's card said). */
	carrySessionOverrides(prev: ServerState): this {
		if (prev.tempOverride !== null) {
			this.tempOverride = prev.tempOverride;
			this.temp = prev.tempOverride;
		}
		return this;
	}
}

// ------------------------------------------------------------ http bits ---

function api(d: RosterDefaults, path: string): string {
	return `http://${d.host}:${d.port}${path}`;
}

function authHeaders(d: RosterDefaults): Record<string, string> {
	return { Authorization: `Bearer ${d.apiKey}`, "Content-Type": "application/json" };
}

async function fetchJson(url: string, d: RosterDefaults, init?: RequestInit, timeoutMs = 10_000): Promise<any | null> {
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), timeoutMs);
	try {
		const res = await fetch(url, { ...init, headers: authHeaders(d), signal: ac.signal });
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/** Is anything answering on the port, and if so what model is it serving? */
async function probeEndpoint(d: RosterDefaults): Promise<{ alive: boolean; alias?: string; ctx?: number }> {
	const models = await fetchJson(api(d, "/v1/models"), d, { method: "GET" }, 3000);
	if (!models) return { alive: false };
	const alias = models?.data?.[0]?.id as string | undefined;
	const props = await fetchJson(api(d, "/props"), d, { method: "GET" }, 3000);
	const ctx = Number(props?.default_generation_settings?.n_ctx) || undefined;
	return { alive: true, alias, ctx };
}

/**
 * Poll /health until it answers or `timeoutMs` elapses. `isAlive` reports
 * whether the process being waited on is still running; once it says no,
 * this returns false immediately instead of continuing to poll a dead
 * process for the rest of the timeout — a crash (GPU OOM, most often here)
 * usually happens in seconds, and there is nothing left to wait for.
 */
async function waitHealthy(d: RosterDefaults, timeoutMs: number, isAlive: () => boolean, onTick?: (secs: number) => void): Promise<boolean> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (!isAlive()) return false;
		try {
			const res = await fetch(api(d, "/health"), { headers: authHeaders(d) });
			if (res.status === 200) return true;
		} catch {
			// not up yet
		}
		onTick?.(Math.round((Date.now() - started) / 1000));
		await new Promise((r) => setTimeout(r, 2000));
	}
	return false;
}

// --------------------------------------------------------------- probes ---

const CONTROL_TOKENS = /<\|im_start\|>|<\|im_end\|>|<\|endoftext\|>|<start_of_turn>|<\|assistant\|>/;

/**
 * Probes run with thinking OFF on a model that has modes, whatever the session
 * uses: they test the template's turn boundary and tool-call channel, which do
 * not depend on the mode, and a thinking model reasoning about "Reply with
 * exactly: OK" turns a seconds-long check into minutes on this hardware.
 */
function probeKwargs(mode: ThinkingMode | null): { chat_template_kwargs?: { enable_thinking: boolean } } {
	return mode === null ? {} : { chat_template_kwargs: { enable_thinking: false } };
}

/**
 * Does the server's own sampler — /props, i.e. its command line — match what
 * this session intends? In remote mode the plugin injects the sampler per
 * request, so a mismatch there does not reach this session, but it does reach
 * every other client of the same server, and it means the host was started with
 * different settings than the container thinks.
 */
async function probeSampler(d: RosterDefaults, state: ServerState, remote: boolean): Promise<ProbeResult> {
	const props = await fetchJson(api(d, "/props"), d, { method: "GET" }, 5000);
	if (!props) return { ok: false, detail: "could not read /props" };
	const mismatches = compareProps(props, state, state.servedCtx);
	if (mismatches.length === 0) return { ok: true, detail: "server sampler matches the roster" };
	return {
		ok: false,
		detail:
			mismatches.join("; ") +
			(remote ? " — this session injects the roster sampler per request, so it is unaffected; the host's server defaults differ" : ""),
	};
}

/**
 * With thinking off, a request must come back with no reasoning at all. This is
 * the check that would have caught `--reasoning-budget 0` doing nothing on three
 * models. Sent with the same kwargs a session request carries.
 */
async function probeThinking(d: RosterDefaults, mode: ThinkingMode | null): Promise<ProbeResult | undefined> {
	if (mode !== "off") return undefined;
	const body = await fetchJson(
		api(d, "/v1/chat/completions"),
		d,
		{
			method: "POST",
			body: JSON.stringify({
				messages: [{ role: "user", content: "Reply with exactly: OK" }],
				max_tokens: 32,
				chat_template_kwargs: thinkingKwargs(mode),
			}),
		},
		probeTimeoutMs(),
	);
	if (!body) return { ok: false, detail: "no response from the server" };
	const reasoning = body?.choices?.[0]?.message?.reasoning_content;
	if (reasoning) {
		return {
			ok: false,
			detail: `thinking is OFF but the model returned ${String(reasoning).length} chars of reasoning_content — the template switch did not take, and every turn will spend its token budget thinking`,
		};
	}
	return { ok: true, detail: "no reasoning_content with thinking off" };
}

/**
 * Does generation stop at a turn boundary, and does the model keep chat control
 * tokens out of its visible text? Apertus failed exactly this in filter round 1
 * and burned three full runs role-playing both sides of the conversation.
 */
async function probeTurnBoundary(d: RosterDefaults, mode: ThinkingMode | null): Promise<ProbeResult> {
	const body = await fetchJson(
		api(d, "/v1/chat/completions"),
		d,
		{
			method: "POST",
			body: JSON.stringify({
				messages: [{ role: "user", content: "Reply with exactly: OK" }],
				max_tokens: 256,
				...probeKwargs(mode),
			}),
		},
		probeTimeoutMs(),
	);
	if (!body) return { ok: false, detail: "no response from the server" };
	const finish = body?.choices?.[0]?.finish_reason ?? "none";
	const content = String(body?.choices?.[0]?.message?.content ?? "");
	if (finish === "length") {
		return {
			ok: false,
			detail: "generation never reached a stop token (finish_reason=length on a 3-word reply); EOS is probably not in the model's EOG set — try --override-kv tokenizer.ggml.eos_token_id=int:<id>",
		};
	}
	if (CONTROL_TOKENS.test(content)) {
		return { ok: false, detail: `chat control tokens leaked into visible text: ${content.slice(0, 60).replace(/\n/g, " ")}` };
	}
	return { ok: true, detail: `finish_reason=${finish}` };
}

/**
 * Does a tool call come back through the OpenAI `tool_calls` field? This is the
 * probe that catches a per-model template problem. The tool it offers is shaped
 * like the bash tool this scaffold actually serves, so a pass here means the
 * channel the session depends on works.
 */
async function probeToolCalls(d: RosterDefaults, mode: ThinkingMode | null): Promise<ProbeResult> {
	const body = await fetchJson(
		api(d, "/v1/chat/completions"),
		d,
		{
			method: "POST",
			body: JSON.stringify({
				messages: [{ role: "user", content: "List the files in the current directory. Use the bash tool." }],
				tools: [
					{
						type: "function",
						function: {
							name: "bash",
							description: "Execute a bash command and return its output",
							parameters: {
								type: "object",
								properties: { command: { type: "string", description: "The command to run" } },
								required: ["command"],
							},
						},
					},
				],
				tool_choice: "auto",
				max_tokens: 1024,
				...probeKwargs(mode),
			}),
		},
		probeTimeoutMs(),
	);
	if (!body) return { ok: false, detail: "no response from the server" };
	const calls = body?.choices?.[0]?.message?.tool_calls ?? [];
	if (Array.isArray(calls) && calls.length > 0) {
		return { ok: true, detail: `emitted ${calls.length} tool_call(s), first=${calls[0]?.function?.name ?? "?"}` };
	}
	const content = String(body?.choices?.[0]?.message?.content ?? "");
	// "Tried and could not be parsed" is a template problem worth fixing with
	// serverArgs; "did not try at all" is usually the model itself.
	if (/"?name"?\s*[:=]|<tool|<function|<script|```json/i.test(content)) {
		return {
			ok: false,
			detail: `the model tried to call a tool in an unparseable format (nothing in tool_calls). This is a TEMPLATE problem — set chatTemplate or serverArgs for this model in roster.json. Sample: ${content.slice(0, 120).replace(/\n/g, " ")}`,
		};
	}
	return {
		ok: false,
		detail: `the model returned prose and no tool_calls field at all. Sample: ${content.slice(0, 120).replace(/\n/g, " ")}`,
	};
}

// --------------------------------------------------- server process mgmt ---

function resolveServerBinary(): string {
	const explicit = process.env.PI_SMALL_LLAMA_BIN;
	if (explicit) return explicit;
	// The benchmark repo keeps llama-server next to the harness directories,
	// which is one level up from this plugin (same as run-filter-bench.sh's
	// $SCRIPT_DIR/../llama-server.exe).
	for (const candidate of ["llama-server.exe", "llama-server"]) {
		const p = join(PLUGIN_DIR, "..", candidate);
		if (existsSync(p)) return p;
	}
	return "llama-server";
}

function logDir(): string {
	const dir = process.env.PI_SMALL_LOG_DIR ?? join(tmpdir(), "pi-small");
	mkdirSync(dir, { recursive: true });
	return dir;
}

class ServerManager {
	state: ServerState;
	private d: RosterDefaults;
	/**
	 * True when llama-server is somewhere this process cannot reach as a
	 * process — the containerised session, where the server runs on the Windows
	 * host and we talk to it through host.docker.internal. In that mode the
	 * plugin owns the sampler and the session, but NOT the process: the host
	 * decides which model is loaded, and we follow it.
	 */
	readonly remote: boolean;

	constructor(spec: ModelSpec, d: RosterDefaults, remote: boolean) {
		this.d = d;
		this.remote = remote;
		this.state = new ServerState(spec, d);
	}

	get defaults(): RosterDefaults {
		return this.d;
	}

	/**
	 * Bring up `spec` at `ctx`, falling back through `resolveCtxLadder` when it
	 * does not fit — see that function and coding-bench/run-filter-bench.sh's
	 * per-model context probe, which this mirrors: there is no reliable way to
	 * know a context's KV cache fits in whatever VRAM happens to be free
	 * without actually starting the server at that size.
	 *
	 * Refuses to touch a server this plugin did not start unless it is already
	 * serving the model we want — the GPU on the bench machine is shared with
	 * 8-hour runs and killing one by accident is expensive.
	 */
	async start(spec: ModelSpec, ctx: number, notify: (msg: string) => void): Promise<void> {
		await this.stop();

		if (this.remote) return this.attachRemote(notify);

		const existing = await probeEndpoint(this.d);
		if (existing.alive) {
			if (existing.alias === spec.alias) {
				this.state = new ServerState(spec, this.d).carrySessionOverrides(this.state);
				this.state.adopted = true;
				this.state.requestedCtx = ctx;
				this.state.servedCtx = existing.ctx ?? ctx;
				notify(`adopted the llama-server already serving ${spec.alias} on port ${this.d.port} (ctx ${this.state.servedCtx})`);
				await this.runProbes();
				return;
			}
			throw new Error(
				`port ${this.d.port} is already serving "${existing.alias ?? "an unknown model"}" and pi-small did not start it. ` +
					`Refusing to kill it — a benchmark run may own it. Stop it yourself, or set PI_SMALL_PORT to a free port.`,
			);
		}

		const bin = resolveServerBinary();
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		const logPath = join(logDir(), `llama-${spec.alias}-${stamp}.log`);
		const fd = openSync(logPath, "a");
		// Set the cache root explicitly rather than inheriting whatever the shell
		// happened to have. An unset LLAMA_CACHE sends llama.cpp to
		// ~/.cache/huggingface/hub on C:, and it re-downloads the whole roster
		// there without saying anything.
		const cacheRoot = this.d.llamaCache;
		// The first candidate tried may include a multi-GB download, not just a
		// load, so every candidate gets the full timeout — matching
		// run-filter-bench.sh's SERVER_START_TIMEOUT, which does the same for
		// every entry in its own CTX_CANDIDATES probe.
		const timeoutMs = Number(process.env.PI_SMALL_START_TIMEOUT ?? 900) * 1000;

		const ladder = resolveCtxLadder(spec, this.d, ctx);
		for (let i = 0; i < ladder.length; i++) {
			const attemptCtx = ladder[i];
			const attempt = await this.attemptStart(spec, ctx, attemptCtx, bin, fd, logPath, cacheRoot, timeoutMs, notify);
			if (!attempt.ok) {
				await this.stop();
				if (i < ladder.length - 1) {
					notify(`context ${attemptCtx} failed to load for ${spec.alias} (${attempt.why}); trying ${ladder[i + 1]}…`);
					continue;
				}
				throw new Error(`llama-server did not come up for ${spec.alias} at any of [${ladder.join(", ")}]: ${attempt.why}. See ${logPath}`);
			}

			// llama-server silently caps -c at the model's training context. A
			// window we only *think* we have makes pi's compaction and maxTokens
			// arithmetic wrong, AND --reasoning-budget (derived from attemptCtx,
			// not the smaller real one) could hand the model a budget bigger than
			// its whole context — restart once at the real size so it matches.
			if (attempt.servedCtx < attemptCtx) {
				notify(`NOTE: asked for ctx ${attemptCtx}, server actually serves ${attempt.servedCtx} (capped to the model's training context)`);
				notify(`${spec.alias}: restarting at ${attempt.servedCtx} so the reasoning budget matches`);
				// The just-started server is still bound to the port — stop it
				// before spawning the refit, or the refit's own bind fails and
				// waitHealthy is fooled into "healthy" by the ORIGINAL process
				// still answering underneath it, leaking that process untracked.
				await this.stop();
				const refit = await this.attemptStart(spec, ctx, attempt.servedCtx, bin, fd, logPath, cacheRoot, timeoutMs, notify);
				if (!refit.ok) {
					throw new Error(
						`${spec.alias} loaded at ctx ${attemptCtx} (capped to ${attempt.servedCtx}) but failed to restart AT ${attempt.servedCtx}: ${refit.why}. See ${logPath}`,
					);
				}
			}
			if (attemptCtx !== ctx) {
				notify(`${spec.alias} did not fit at ctx ${ctx}; serving at ${this.state.servedCtx} instead (the largest of [${ladder.join(", ")}] that loaded)`);
			}
			await this.runProbes();
			return;
		}
	}

	/**
	 * One llama-server start attempt at exactly `attemptCtx`. Leaves
	 * `this.state` pointed at this attempt either way — the caller is
	 * responsible for `stop()` on failure before trying the next candidate.
	 */
	private async attemptStart(
		spec: ModelSpec,
		requestedCtx: number,
		attemptCtx: number,
		bin: string,
		fd: number,
		logPath: string,
		cacheRoot: string | undefined,
		timeoutMs: number,
		notify: (msg: string) => void,
	): Promise<{ ok: true; servedCtx: number } | { ok: false; why: string }> {
		// The NEW model's own sampler and mode, plus only what the user set this
		// session — never the previous model's card (see carrySessionOverrides).
		const state = new ServerState(spec, this.d).carrySessionOverrides(this.state);
		state.requestedCtx = requestedCtx;
		state.logPath = logPath;

		const args = buildServerArgs(spec, this.d, attemptCtx, state, undefined, state.thinking);
		notify(`starting llama-server: ${spec.alias} at ctx ${attemptCtx} (log: ${logPath})`);
		// A .cmd/.bat wrapper needs shell:true, and then cmd.exe strips the quotes
		// out of JSON arguments unless they are quoted for it — see
		// quoteForCmdShell. A native binary gets its arguments untouched.
		const viaShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(bin);
		const proc = spawn(bin, viaShell ? args.map(quoteForCmdShell) : args, {
			cwd: dirname(resolve(bin)),
			stdio: ["ignore", fd, fd],
			windowsHide: true,
			// Node refuses to spawn a .cmd/.bat directly (EINVAL) unless the caller
			// opts in with shell:true — a deliberate fix for an old cmd.exe
			// injection hole. bin is normally llama-server.exe, a native binary
			// this never touches; it only matters if PI_SMALL_LLAMA_BIN points at a
			// wrapper script (a real case: test/plugin-test.ts shims the stub
			// server this way on Windows, where a .mjs has no shebang support).
			shell: viaShell,
			env: cacheRoot ? { ...process.env, LLAMA_CACHE: cacheRoot } : process.env,
		});
		state.proc = proc;
		this.state = state;

		// Held in an object because the assignment happens in a callback: a bare
		// `let` would be narrowed to `null` for the rest of this function.
		const exit: { info: { code: number | null; signal: string | null } | null } = { info: null };
		proc.on("exit", (code, signal) => {
			exit.info = { code, signal };
			if (this.state.proc === proc) this.state.proc = null;
		});
		proc.on("error", (err) => {
			notify(`failed to spawn ${bin}: ${err.message}`);
		});

		// isAlive lets waitHealthy give up the moment the process actually
		// exits, instead of polling /health for the full timeout regardless.
		// Without it, a GPU-memory crash — which happens in seconds — looked
		// exactly like a hang: nothing failed for up to PI_SMALL_START_TIMEOUT
		// (900s default), and with a multi-candidate ladder that multiplies
		// across every candidate that also does not fit.
		const healthy = await waitHealthy(this.d, timeoutMs, () => exit.info === null);
		if (!healthy) {
			const why = exit.info
				? `it exited (code ${exit.info.code}, signal ${exit.info.signal}) — likely out of GPU memory at ctx ${attemptCtx}`
				: "it never became healthy";
			return { ok: false, why };
		}

		// Believe the server, not the request: llama-server silently caps -c at
		// the model's training context, and a context window we only *think* we
		// have makes pi's compaction and maxTokens arithmetic wrong.
		const props = await fetchJson(api(this.d, "/props"), this.d, { method: "GET" }, 5000);
		const served = Number(props?.default_generation_settings?.n_ctx);
		state.servedCtx = Number.isFinite(served) && served > 0 ? served : attemptCtx;
		return { ok: true, servedCtx: state.servedCtx };
	}

	/**
	 * Follow whatever the host is serving. The container cannot start, stop or
	 * switch the model, so the served alias is the truth and the roster entry is
	 * only used for its notes and per-model settings when one matches.
	 */
	private async attachRemote(notify: (msg: string) => void): Promise<void> {
		const existing = await probeEndpoint(this.d);
		if (!existing.alive) {
			throw new Error(
				`no llama-server answering on ${this.d.host}:${this.d.port}. ` +
					`This session cannot start one — it is running in a container and the server lives on the host. ` +
					`Start it there with: node serve.mjs <model>`,
			);
		}
		const alias = existing.alias ?? "unknown-model";
		const known = this.rosterSpec?.(alias);
		const spec: ModelSpec = known ?? { alias, repo: "unknown", file: "unknown" };
		this.state = new ServerState(spec, this.d).carrySessionOverrides(this.state);
		this.state.adopted = true;
		this.state.requestedCtx = existing.ctx ?? this.d.ctx;
		this.state.servedCtx = existing.ctx ?? this.d.ctx;
		notify(
			`attached to llama-server on ${this.d.host}:${this.d.port} serving ${alias} (ctx ${this.state.servedCtx})` +
				(known ? "" : " — not a roster model, so its notes and per-model flags are unknown"),
		);
		await this.runProbes();
	}

	/** Injected by the extension so attachRemote can name what it found. */
	rosterSpec?: (alias: string) => ModelSpec | undefined;

	async runProbes(): Promise<void> {
		const mode = this.state.thinking;
		this.state.probes.turnBoundary = await probeTurnBoundary(this.d, mode);
		this.state.probes.toolCalls = await probeToolCalls(this.d, mode);
		this.state.probes.sampler = await probeSampler(this.d, this.state, this.remote);
		this.state.probes.thinking = await probeThinking(this.d, mode);
	}

	/** Kill the server, but only if we are the ones who started it. */
	async stop(): Promise<void> {
		if (this.remote) return;
		const proc = this.state.proc;
		this.state.proc = null;
		this.state.adopted = false;
		if (!proc || proc.exitCode !== null) return;
		if (process.platform === "win32" && proc.pid) {
			// proc.kill() only reaches the process spawn() itself created. When bin
			// is a .cmd/.bat launched with shell:true above, that process is
			// cmd.exe wrapping the real work in a grandchild — TerminateProcess
			// (what kill() maps to on Windows) does not follow it, so the
			// grandchild survives and keeps the port. taskkill /T kills the whole
			// tree, which is what "stop the server we started" actually means.
			spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
		} else {
			proc.kill("SIGTERM");
			const died = await Promise.race([
				new Promise<boolean>((r) => proc.once("exit", () => r(true))),
				new Promise<boolean>((r) => setTimeout(() => r(false), 10_000)),
			]);
			if (!died) proc.kill("SIGKILL");
		}
		// Give the port a moment to be released before anything rebinds it.
		await new Promise((r) => setTimeout(r, 1000));
	}
}

// ------------------------------------------------------------ extension ---

export default function (pi: ExtensionAPI) {
	const roster = loadRoster();
	const d: RosterDefaults = {
		...roster.defaults,
		port: Number(process.env.PI_SMALL_PORT ?? roster.defaults.port),
		host: process.env.PI_SMALL_HOST ?? roster.defaults.host,
		apiKey: process.env.PI_SMALL_API_KEY ?? roster.defaults.apiKey,
		// An inherited LLAMA_CACHE wins: whoever set it meant it.
		llamaCache: process.env.LLAMA_CACHE ?? roster.defaults.llamaCache,
	};

	const byAlias = (alias: string) => roster.models.find((m) => m.alias === alias);
	const requested = process.env.PI_SMALL_MODEL;
	const initial = (requested ? byAlias(requested) : undefined) ?? roster.models.find((m) => m.default) ?? roster.models[0];

	// Remote mode: the server is not a process this pi can manage. Explicit via
	// PI_SMALL_REMOTE, and inferred whenever the host is not loopback, which is
	// the containerised case (host.docker.internal).
	const remote =
		process.env.PI_SMALL_REMOTE === "1" ||
		!["127.0.0.1", "localhost", "::1"].includes(d.host);

	const mgr = new ServerManager(initial, d, remote);
	mgr.rosterSpec = byAlias;

	/**
	 * notify(), and ALSO stderr when there is no interactive UI. In `-p`
	 * one-shot mode — every scripted and containerised run — pi's notifications
	 * go nowhere, which is how a probe FAIL on every session of the 2026-09-22
	 * round went unseen. stderr lands in the run log.
	 */
	const say = (ctx: any, msg: string, level: "info" | "warn" | "error" = "info") => {
		ctx?.ui?.notify?.(msg, level);
		if (ctx?.hasUI === false || !process.stdout.isTTY) console.error(msg);
	};

	/**
	 * One JSONL file per pi process: the settings a session actually ran with,
	 * its effective system prompt (length + hash), and every response's stop
	 * reason, token usage and wall time. Lives next to pi's own session record in
	 * the container (the plugin directory is read-only there), in the log
	 * directory otherwise. PI_SMALL_SESSION_LOG_DIR overrides both.
	 */
	const sessionLog = (() => {
		const dir =
			process.env.PI_SMALL_SESSION_LOG_DIR ?? (remote ? join(homedir(), ".pi-small") : join(process.env.PI_SMALL_LOG_DIR ?? join(tmpdir(), "pi-small")));
		const path = join(dir, `session-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
		return {
			path,
			write(rec: Record<string, unknown>) {
				try {
					mkdirSync(dir, { recursive: true });
					appendFileSync(path, JSON.stringify({ ts: new Date().toISOString(), ...rec }) + "\n");
				} catch {
					// Logging must never break a session.
				}
			},
		};
	})();
	let lastPromptHash = "";

	// ---------------------------------------------------------- provider --
	// Registered during the factory so `--provider small-local --model
	// small-local/<alias>` resolves at startup, and so `/model` lists the
	// WHOLE roster, not just whatever is currently being served — a real
	// provider's models are all reachable at once, so pi's own picker expects
	// the same. registerProvider() replaces a provider's whole model list, so
	// this re-registers everyone on every switch, not just the one that
	// changed. The currently active model gets the context size the server
	// actually reported; every other model gets its roster-configured guess,
	// corrected the same way once IT becomes active — llama-server cannot be
	// asked "what would you serve for X" without starting X.
	const registerAllModels = (activeSpec: ModelSpec, activeCtxWindow: number) => {
		const modelEntry = (spec: ModelSpec) => {
			const ctxWindow = spec.alias === activeSpec.alias ? activeCtxWindow : (spec.ctx ?? d.ctx);
			return {
				id: spec.alias,
				name: `${spec.alias} (local)`,
				reasoning: true,
				input: ["text"] as ("text" | "image")[],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: ctxWindow,
				// This model's own cap (roster maxTokens, default 4096), NOT scaled
				// with ctxWindow. A per-window formula (half the window, say)
				// breaks the moment the real served context doesn't match what the
				// formula assumed, which the ctx ladder makes routine: the same
				// roster entry can end up at 16384 or 8192 depending on what
				// actually fit. The half-window floor only matters for a window
				// too small for the cap.
				maxTokens: Math.min(resolveMaxTokens(spec, d), Math.floor(ctxWindow / 2)),
				compat: {
					supportsDeveloperRole: false,
					supportsReasoningEffort: false,
					maxTokensField: "max_tokens",
					supportsUsageInStreaming: true,
				},
			};
		};
		pi.registerProvider(PROVIDER, {
			name: "Small Local (llama-server)",
			baseUrl: `http://${d.host}:${d.port}/v1`,
			apiKey: d.apiKey,
			authHeader: true,
			api: "openai-completions",
			models: roster.models.map(modelEntry),
		});
	};
	registerAllModels(initial, mgr.state.requestedCtx);

	// -------------------------------------------------------------- tools --
	// The entry point runs with --no-builtin-tools; every tool the model can
	// see is registered here, deliberately. WHICH tools and what options they
	// carry come from roster.json — defaults.tools/toolOptions unless a model
	// overrides them, so a guard or variant added for one model (see
	// MiniCPM5's bash guard) never touches any other model's config. Done per
	// model in switchTo(), not once here, so the tool set follows /sm-model.
	const registerToolsFor = (spec: ModelSpec): string[] => {
		const kinds = resolveTools(spec, d);
		for (const kind of kinds) pi.registerTool(buildTool(kind, process.cwd(), resolveToolOptions(spec, d, kind)));
		return kinds;
	};

	// ------------------------------------------------------------ sampling --
	// Temperature lives here, not in the harness and not only in the server
	// flags, so /sm-temp takes effect on the next request with no reload.
	pi.on("before_provider_request", (event: any) => {
		return {
			...event.payload,
			temperature: mgr.state.temp,
			top_p: mgr.state.topP,
			top_k: mgr.state.topK,
			// Carried here too, not just on the command line: in remote mode the
			// container never started the server, so request-level params are the
			// only ones the plugin controls. Leaving these out let llama.cpp's
			// defaults (repeat_penalty 1.0, min_p 0.05) stand in for a model card
			// asking for 1.05 and 0.
			repeat_penalty: mgr.state.repeatPenalty,
			min_p: mgr.state.minP,
			presence_penalty: mgr.state.presencePenalty,
			// The thinking switch rides on every request too, for the same
			// reason as the sampler: in remote mode this is the only lever the
			// session has, and the server's own default may be the other mode.
			...(mgr.state.thinking === null
				? {}
				: { chat_template_kwargs: { ...(event.payload?.chat_template_kwargs ?? {}), ...thinkingKwargs(mgr.state.thinking) } }),
		};
	});

	// -------------------------------------------------------- system prompt --
	// Replaces pi's system prompt for the model currently being served — the
	// same full substitution PI_SMALL_SYSTEM_PROMPT does at the CLI, but per
	// model and re-evaluated on every turn so it follows /sm-model. A model
	// with no systemPrompt of its own (and no roster default) leaves
	// event.systemPrompt untouched, so PI_SMALL_SYSTEM_PROMPT / the CLI's
	// near-empty default still apply.
	pi.on("before_agent_start", (event: any, ctx: any) => {
		const override = resolveSystemPrompt(mgr.state.spec, d);
		// pi does not persist the system prompt in its session record, so the
		// only proof of what a session was actually given is what we log here.
		const effective = String(override ?? event?.systemPrompt ?? "");
		const hash = createHash("sha256").update(effective).digest("hex").slice(0, 12);
		if (hash !== lastPromptHash) {
			lastPromptHash = hash;
			const source = override !== undefined ? "roster systemPrompt" : "PI_SMALL_SYSTEM_PROMPT / pi default";
			sessionLog.write({ type: "system_prompt", model: mgr.state.spec.alias, source, chars: effective.length, sha256: hash });
			if (ctx) say(ctx, `pi-small: system prompt — ${source}, ${effective.length} chars, sha256 ${hash}`, "info");
		}
		return override === undefined ? {} : { systemPrompt: override };
	});

	// ----------------------------------------------------------- responses --
	// Every assistant response, recorded with what it cost, and a loud warning
	// when one stops at max_tokens — above all when it stops with NOTHING to
	// show, which is what an unrestricted think running into the cap looks like
	// and is otherwise indistinguishable from a model that gave up.
	let responseStartedAt = 0;
	pi.on("message_start", (event: any) => {
		if (event?.message?.role === "assistant") responseStartedAt = Date.now();
	});
	pi.on("message_end", (event: any, ctx: any) => {
		const m = event?.message;
		if (m?.role !== "assistant") return;
		const content: any[] = Array.isArray(m.content) ? m.content : [];
		const answered = content.some((c) => (c.type === "text" && String(c.text ?? "").trim()) || c.type === "toolCall");
		const thoughtChars = content.filter((c) => c.type === "thinking").reduce((n, c) => n + String(c.thinking ?? "").length, 0);
		sessionLog.write({
			type: "response",
			model: mgr.state.spec.alias,
			thinking: mgr.state.thinking,
			stopReason: m.stopReason,
			usage: m.usage,
			thoughtChars,
			answered,
			wallMs: responseStartedAt ? Date.now() - responseStartedAt : null,
		});
		if (m.stopReason === "length" && ctx) {
			const cap = resolveMaxTokens(mgr.state.spec, d);
			say(
				ctx,
				answered
					? `pi-small: response truncated at max_tokens (${cap}) — raise maxTokens for ${mgr.state.spec.alias} in roster.json if this recurs`
					: `pi-small: response hit max_tokens (${cap}) with NO answer — ${thoughtChars ? `${thoughtChars} chars of thinking used the whole budget` : "nothing but truncated output"}. ` +
							`Raise maxTokens for ${mgr.state.spec.alias}, or cap reasoningBudget.`,
				"warn",
			);
		}
	});

	// ------------------------------------------------------------- status --
	const hostControlHint = (cmd: string): string =>
		`This session runs in a container; llama-server is a process on the host and pi cannot touch it. ` +
		`Run this on the host, in /d/llama.cpp/pi-small, then reconnect:\n    ${cmd}\n` +
		`(/sm-temp and /sm-probe still work from here — they are request-level, not process-level.)`;

	const weightsOf = (spec: ModelSpec): string => weightsSource(spec).description;

	const probeLine = (name: string, r?: ProbeResult) =>
		r === undefined ? `  ${name}: not run` : `  ${name}: ${r.ok ? "OK" : "FAIL"} — ${r.detail}`;

	const statusText = (): string => {
		const s = mgr.state;
		const where = mgr.remote
			? "on the host — this session cannot start, stop or switch it"
			: s.adopted
				? "adopted (not ours to kill)"
				: s.proc
					? `pid ${s.proc.pid}`
					: "not running";
		const promptOverride = resolveSystemPrompt(s.spec, d);
		const lines = [
			`model:   ${s.spec.alias}`,
			`server:  ${where} on ${d.host}:${d.port}`,
			`weights: ${mgr.remote ? "managed on the host" : weightsOf(s.spec)}`,
			`cache:   ${d.llamaCache ?? "LLAMA_CACHE unset — llama.cpp will use ~/.cache/huggingface/hub"}`,
			`context: ${s.servedCtx}${s.servedCtx !== s.requestedCtx ? ` (asked for ${s.requestedCtx})` : ""}`,
			`thinking: ${s.thinking ?? "n/a (no thinking mode)"}`,
			`sampler: temp=${s.temp}${s.tempOverride !== null ? " (/sm-temp)" : ""} top_p=${s.topP} top_k=${s.topK} repeat_penalty=${s.repeatPenalty} min_p=${s.minP} presence_penalty=${s.presencePenalty}`,
			`max_tokens: ${resolveMaxTokens(s.spec, d)} per response (thinking + answer)`,
			`template: ${s.spec.chatTemplate ?? "embedded in the GGUF (--jinja)"}`,
			`extra flags: ${(s.spec.serverArgs ?? []).join(" ") || "(none)"}`,
			`tools:   ${resolveTools(s.spec, d).join(", ")}`,
			`prompt:  ${promptOverride === undefined ? "default (PI_SMALL_SYSTEM_PROMPT / pi's near-empty prompt)" : `roster override (${promptOverride.length} chars)`}`,
			`log:     ${s.logPath || "(n/a)"}`,
			"probes:",
			probeLine("turn_boundary", s.probes.turnBoundary),
			probeLine("tool_calls", s.probes.toolCalls),
			probeLine("sampler", s.probes.sampler),
			probeLine("thinking", s.probes.thinking),
		];
		return lines.join("\n");
	};

	const reportProbes = (ctx: any) => {
		const { turnBoundary, toolCalls, sampler, thinking } = mgr.state.probes;
		if (turnBoundary && !turnBoundary.ok) say(ctx, `pi-small: turn_boundary FAIL — ${turnBoundary.detail}`, "warn");
		if (toolCalls && !toolCalls.ok) say(ctx, `pi-small: tool_calls FAIL — ${toolCalls.detail}`, "warn");
		if (sampler && !sampler.ok) say(ctx, `pi-small: sampler MISMATCH — ${sampler.detail}`, "warn");
		if (thinking && !thinking.ok) say(ctx, `pi-small: thinking FAIL — ${thinking.detail}`, "error");
		const all = [turnBoundary, toolCalls, sampler, thinking].filter(Boolean) as ProbeResult[];
		if (all.length > 0 && all.every((p) => p.ok)) {
			say(
				ctx,
				`pi-small: probes OK — stops at turn boundary, emits real tool_calls, server sampler matches` +
					(thinking ? ", no reasoning with thinking off" : ""),
				"info",
			);
		}
	};

	/** Bring up a model and point the session at it. */
	const switchToNow = async (spec: ModelSpec, ctxSize: number, ctx: any) => {
		ctx.ui.setStatus?.(`pi-small: loading ${spec.alias}…`);
		try {
			await mgr.start(spec, ctxSize, (msg) => ctx.ui.notify(`pi-small: ${msg}`, "info"));
		} catch (err: any) {
			ctx.ui.setStatus?.("");
			ctx.ui.notify(`pi-small: ${err.message}`, "error");
			return false;
		}
		registerAllModels(spec, mgr.state.servedCtx);
		const model = ctx.modelRegistry.find(PROVIDER, spec.alias);
		// setModel() fires pi's own model_select — by now mgr.state.spec is
		// already this spec and the server is up, so the model_select handler
		// below sees "already serving it" and does not re-enter.
		if (model) await pi.setModel(model);
		// This model's own tool set, registered fresh and made exclusively
		// active — a switch away from a model drops the tools (and guards) that
		// were only ever its own.
		const kinds = registerToolsFor(spec);
		pi.setActiveTools(kinds);
		ctx.ui.setStatus?.("");
		const st = mgr.state;
		say(
			ctx,
			`pi-small: ${spec.alias} ready at ctx ${st.servedCtx}, thinking ${st.thinking ?? "n/a"}, ` +
				`temp ${st.temp} top_p ${st.topP} top_k ${st.topK} min_p ${st.minP} repeat ${st.repeatPenalty} presence ${st.presencePenalty}, ` +
				`max_tokens ${resolveMaxTokens(spec, d)}, tools [${kinds.join(", ")}]`,
			"info",
		);
		const overrideWarning = thinkingOverrideWarning(spec, thinkingOverride);
		if (overrideWarning) say(ctx, `pi-small: ${overrideWarning}`, "warn");
		sessionLog.write({
			type: "session",
			model: spec.alias,
			remote: mgr.remote,
			servedCtx: st.servedCtx,
			thinking: st.thinking,
			sampler: { temp: st.temp, topP: st.topP, topK: st.topK, minP: st.minP, repeatPenalty: st.repeatPenalty, presencePenalty: st.presencePenalty },
			tempOverride: st.tempOverride,
			maxTokens: resolveMaxTokens(spec, d),
			probes: st.probes,
			piSession: ctx.sessionManager?.getSessionFile?.() ?? null,
		});
		// Reported at every start, including the remote-mode attach, because the
		// failure it warns about is invisible from inside a session: pi clamps
		// max_tokens rather than erroring, so a too-small window looks like a
		// model that answers with one token and nothing looks broken.
		const ctxWarning = ctxUsabilityWarning(mgr.state.servedCtx);
		if (ctxWarning) say(ctx, `pi-small: ${ctxWarning}`, "warn");
		reportProbes(ctx);
		return true;
	};

	// Serializes switches so two picked-in-quick-succession models (/model
	// cycling, or a command fired while a switch is still in flight) restart
	// llama-server one at a time instead of racing each other's spawn/stop.
	let switchQueue: Promise<boolean> = Promise.resolve(true);
	const switchTo = (spec: ModelSpec, ctxSize: number, ctx: any): Promise<boolean> => {
		switchQueue = switchQueue.then(
			() => switchToNow(spec, ctxSize, ctx),
			() => switchToNow(spec, ctxSize, ctx),
		);
		return switchQueue;
	};

	// ----------------------------------------------------------- lifecycle --
	pi.on("session_start", async (_event: any, ctx: any) => {
		await switchTo(mgr.state.spec, mgr.state.requestedCtx, ctx);
	});

	pi.on("session_shutdown", async () => {
		await mgr.stop();
	});

	// pi's own /model (and Ctrl+P cycling) fires this whenever the selected
	// model changes — including our own switchTo()'s pi.setModel() call, which
	// is why "already serving it" has to be checked with live server state
	// (proc/adopted), not just the alias: after a FAILED switch, mgr.state.spec
	// is already the attempted spec but nothing is actually running, and a
	// retry from /model must still go through.
	pi.on("model_select", async (event: any, ctx: any) => {
		if (event.model?.provider !== PROVIDER) return;
		const spec = byAlias(event.model.id);
		if (!spec) return;
		const alreadyServing = mgr.state.spec.alias === spec.alias && (mgr.state.proc !== null || mgr.state.adopted);
		if (alreadyServing) return;
		if (mgr.remote) {
			ctx.ui.notify(hostControlHint(`node serve.mjs ${spec.alias}`), "warn");
			return;
		}
		await switchTo(spec, spec.ctx ?? d.ctx, ctx);
	});

	// ------------------------------------------------------------ commands --
	pi.registerCommand("sm-status", {
		description: "Show the local model, server, sampler, tools and prompt state",
		handler: async (_args: string, ctx: any) => {
			ctx.ui.notify(statusText(), "info");
		},
	});

	pi.registerCommand("sm-model", {
		description: "Switch the served model (restarts llama-server)",
		getArgumentCompletions: (prefix: string) => {
			const items = roster.models
				.map((m) => ({ value: m.alias, label: m.alias }))
				.filter((i) => i.value.toLowerCase().startsWith(prefix.toLowerCase()));
			return items.length > 0 ? items : null;
		},
		handler: async (args: string, ctx: any) => {
			const alias = args.trim();
			if (!alias) {
				ctx.ui.notify(`roster: ${roster.models.map((m) => m.alias).join(", ")}`, "info");
				return;
			}
			const spec = byAlias(alias);
			if (!spec) {
				ctx.ui.notify(`unknown model "${alias}". Roster: ${roster.models.map((m) => m.alias).join(", ")}`, "error");
				return;
			}
			if (mgr.remote) {
				ctx.ui.notify(hostControlHint(`node serve.mjs ${alias}`), "warn");
				return;
			}
			await switchTo(spec, spec.ctx ?? d.ctx, ctx);
		},
	});

	pi.registerCommand("sm-ctx", {
		description: "Set the context size (restarts llama-server)",
		handler: async (args: string, ctx: any) => {
			const n = Number(args.trim());
			if (!Number.isFinite(n) || n < 1024) {
				ctx.ui.notify(`usage: /sm-ctx <tokens>  (current: ${mgr.state.servedCtx})`, "error");
				return;
			}
			if (mgr.remote) {
				ctx.ui.notify(hostControlHint(`node serve.mjs ${mgr.state.spec.alias} --ctx ${Math.floor(n)}`), "warn");
				return;
			}
			await switchTo(mgr.state.spec, Math.floor(n), ctx);
		},
	});

	pi.registerCommand("sm-temp", {
		description: "Set the sampling temperature (takes effect on the next request)",
		handler: async (args: string, ctx: any) => {
			const t = Number(args.trim());
			if (!Number.isFinite(t) || t < 0 || t > 2) {
				ctx.ui.notify(`usage: /sm-temp <0..2>  (current: ${mgr.state.temp})`, "error");
				return;
			}
			mgr.state.temp = t;
			mgr.state.tempOverride = t;
			ctx.ui.notify(`pi-small: temperature ${t} (no restart needed; kept across /sm-model until the session ends)`, "info");
		},
	});

	pi.registerCommand("sm-thinking", {
		description: "Switch the served model's thinking mode: on | off (restarts llama-server; the sampler moves with it)",
		getArgumentCompletions: () => [
			{ value: "on", label: "on" },
			{ value: "off", label: "off" },
		],
		handler: async (args: string, ctx: any) => {
			const want = args.trim();
			const spec = mgr.state.spec;
			if (want !== "on" && want !== "off") {
				ctx.ui.notify(`usage: /sm-thinking on|off  (current: ${mgr.state.thinking ?? "n/a"})`, "error");
				return;
			}
			if (!spec.thinking) {
				ctx.ui.notify(`${spec.alias} has no thinking mode in roster.json`, "error");
				return;
			}
			if (mgr.remote) {
				ctx.ui.notify(
					hostControlHint(`node serve.mjs ${spec.alias} --thinking ${want}`) +
						`\nthen restart this container with PI_SMALL_THINKING=${want}, so the per-request switch and sampler agree with the server.`,
					"warn",
				);
				return;
			}
			thinkingOverride = want;
			await switchTo(spec, mgr.state.requestedCtx, ctx);
		},
	});

	pi.registerCommand("sm-probe", {
		description: "Re-run the turn-boundary and tool-call probes against the live server",
		handler: async (_args: string, ctx: any) => {
			ctx.ui.setStatus?.("pi-small: probing…");
			await mgr.runProbes();
			ctx.ui.setStatus?.("");
			reportProbes(ctx);
			ctx.ui.notify(statusText(), "info");
		},
	});

	pi.registerCommand("sm-restart", {
		description: "Restart llama-server with the current model and settings",
		handler: async (_args: string, ctx: any) => {
			if (mgr.remote) {
				ctx.ui.notify(hostControlHint(`node serve.mjs ${mgr.state.spec.alias} --restart`), "warn");
				return;
			}
			await switchTo(mgr.state.spec, mgr.state.requestedCtx, ctx);
		},
	});
}
