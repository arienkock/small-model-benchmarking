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
 *                    time. /sm-model switches.
 *   the server     — llama-server is started, health-checked, probed and killed
 *                    by this process. It is NOT assumed to be running.
 *   the parameters — context size (server restart) and temperature (per
 *                    request, no restart). In a normal pi session these live in
 *                    the harness; here they live in the plugin.
 *   the tools      — exactly one, pi's own bash tool, registered by us.
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
 * field. Both are reported at startup and re-runnable with /sm-probe.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBashToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER = "small-local";
const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// --------------------------------------------------------------- roster ---

interface ModelSpec {
	alias: string;
	/** Hugging Face repo id, or the literal "local" (then `file` is a path). */
	repo: string;
	file: string;
	/**
	 * A copy of the weights already on the serving machine. When it resolves to
	 * an existing file it is used with -m and nothing is downloaded; otherwise
	 * the model falls back to repo/file. May contain `*` in a path segment and
	 * may start with `~` — the Hugging Face cache puts the weights behind a
	 * snapshot hash that changes whenever the repo is re-fetched.
	 */
	localFile?: string;
	notes?: string;
	default?: boolean;
	/** Template filename under ../templates, or an absolute path. */
	chatTemplate?: string | null;
	/** Extra llama-server flags for this model only. */
	serverArgs?: string[];
	/** Per-model overrides of the roster defaults. */
	ctx?: number;
	temp?: number;
	topP?: number;
	topK?: number;
	reasoningBudget?: number;
}

interface RosterDefaults {
	port: number;
	apiKey: string;
	host: string;
	ctx: number;
	temp: number;
	topP: number;
	topK: number;
	reasoningBudget: number;
	ngl: number;
	serverArgs: string[];
	/**
	 * Where llama.cpp keeps downloaded weights. MUST be a Windows path on the
	 * bench laptop — this is passed in the environment, and MSYS does not
	 * translate environment variables the way it translates arguments. Kept in
	 * step with ../../llama-cache.env, which is the source of truth for the
	 * shell side; $LLAMA_CACHE in the environment still wins over both.
	 */
	llamaCache?: string;
}

interface Roster {
	defaults: RosterDefaults;
	models: ModelSpec[];
}

function loadRoster(): Roster {
	const path = process.env.PI_SMALL_ROSTER ?? join(PLUGIN_DIR, "roster.json");
	const raw = JSON.parse(readFileSync(path, "utf8")) as Roster;
	if (!Array.isArray(raw.models) || raw.models.length === 0) {
		throw new Error(`roster ${path} has no models`);
	}
	return raw;
}

// ---------------------------------------------------------------- state ---

interface ProbeResult {
	ok: boolean;
	detail: string;
}

interface Probes {
	turnBoundary?: ProbeResult;
	toolCalls?: ProbeResult;
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
	temp: number;
	topP: number;
	topK: number;
	logPath = "";
	probes: Probes = {};

	constructor(spec: ModelSpec, d: RosterDefaults) {
		this.spec = spec;
		this.requestedCtx = spec.ctx ?? d.ctx;
		this.servedCtx = this.requestedCtx;
		this.temp = spec.temp ?? d.temp;
		this.topP = spec.topP ?? d.topP;
		this.topK = spec.topK ?? d.topK;
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

async function waitHealthy(d: RosterDefaults, timeoutMs: number, onTick?: (secs: number) => void): Promise<boolean> {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
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
 * Does generation stop at a turn boundary, and does the model keep chat control
 * tokens out of its visible text? Apertus failed exactly this in filter round 1
 * and burned three full runs role-playing both sides of the conversation.
 */
async function probeTurnBoundary(d: RosterDefaults): Promise<ProbeResult> {
	const body = await fetchJson(
		api(d, "/v1/chat/completions"),
		d,
		{
			method: "POST",
			body: JSON.stringify({
				messages: [{ role: "user", content: "Reply with exactly: OK" }],
				max_tokens: 256,
			}),
		},
		120_000,
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
async function probeToolCalls(d: RosterDefaults): Promise<ProbeResult> {
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
			}),
		},
		180_000,
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

/**
 * Resolve a path that may start with `~` and may contain `*` in any segment.
 * Returns the matching file, or null if nothing matches. When several match,
 * the last in sort order wins, so the choice is at least deterministic.
 */
function resolveLocalPath(pattern: string): string | null {
	let p = pattern.replace(/\\/g, "/");
	if (p === "~" || p.startsWith("~/")) p = join(homedir(), p.slice(1)).replace(/\\/g, "/");
	if (!p.includes("*")) return existsSync(p) ? p : null;

	const segments = p.split("/");
	// An absolute POSIX path starts with an empty segment; a Windows path starts
	// with the drive. Either way the first segment seeds the search.
	let candidates = [segments[0] === "" ? "/" : segments[0]];
	for (const segment of segments.slice(1)) {
		const next: string[] = [];
		if (segment.includes("*")) {
			const re = new RegExp(`^${segment.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
			for (const base of candidates) {
				let entries: string[];
				try {
					entries = readdirSync(base);
				} catch {
					continue;
				}
				for (const entry of entries) if (re.test(entry)) next.push(join(base, entry));
			}
		} else {
			for (const base of candidates) {
				const joined = join(base, segment);
				if (existsSync(joined)) next.push(joined);
			}
		}
		if (next.length === 0) return null;
		candidates = next;
	}
	candidates.sort();
	return candidates[candidates.length - 1] ?? null;
}

function resolveTemplate(spec: ModelSpec): string | null {
	if (!spec.chatTemplate) return null;
	if (isAbsolute(spec.chatTemplate)) return spec.chatTemplate;
	return join(PLUGIN_DIR, "templates", spec.chatTemplate);
}

function buildServerArgs(spec: ModelSpec, d: RosterDefaults, ctx: number, state: ServerState): string[] {
	const args: string[] = [];
	// Prefer weights already on this machine. llama-server keeps its own cache,
	// so -hf would re-download gigabytes that are sitting in the Hugging Face
	// cache from earlier benchmark rounds.
	const local = spec.localFile ? resolveLocalPath(spec.localFile) : spec.repo === "local" ? resolveLocalPath(spec.file) : null;
	if (local) {
		args.push("-m", local);
	} else if (spec.repo === "local") {
		throw new Error(`${spec.alias}: repo is "local" but no file matched ${spec.file}`);
	} else {
		args.push("-hf", spec.repo, "-hff", spec.file);
	}
	// A reasoning budget as large as the window leaves no room for the prompt or
	// the answer; the bench caps it at a quarter of the context and so do we.
	const wanted = spec.reasoningBudget ?? d.reasoningBudget;
	const think = Math.min(wanted, Math.floor(ctx / 4));
	args.push(
		"--alias", spec.alias,
		"--jinja",
		"-c", String(ctx),
		"-ngl", String(d.ngl),
		"--parallel", "1",
		"--reasoning-budget", String(think),
		"--temp", String(state.temp),
		"--top-p", String(state.topP),
		"--top-k", String(state.topK),
	);
	const template = resolveTemplate(spec);
	if (template) args.push("--chat-template-file", template);
	args.push(...(d.serverArgs ?? []), ...(spec.serverArgs ?? []));
	args.push("--api-key", d.apiKey, "--host", d.host, "--port", String(d.port));
	return args;
}

function logDir(): string {
	const dir = process.env.PI_SMALL_LOG_DIR ?? join(tmpdir(), "pi-small");
	mkdirSync(dir, { recursive: true });
	return dir;
}

class ServerManager {
	state: ServerState;
	private d: RosterDefaults;

	constructor(spec: ModelSpec, d: RosterDefaults) {
		this.d = d;
		this.state = new ServerState(spec, d);
	}

	get defaults(): RosterDefaults {
		return this.d;
	}

	/**
	 * Bring up `spec` at `ctx`. Returns a human-readable status line.
	 *
	 * Refuses to touch a server this plugin did not start unless it is already
	 * serving the model we want — the GPU on the bench machine is shared with
	 * 8-hour runs and killing one by accident is expensive.
	 */
	async start(spec: ModelSpec, ctx: number, notify: (msg: string) => void): Promise<void> {
		await this.stop();

		const existing = await probeEndpoint(this.d);
		if (existing.alive) {
			if (existing.alias === spec.alias) {
				this.state = new ServerState(spec, this.d);
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
		const state = new ServerState(spec, this.d);
		state.requestedCtx = ctx;
		// Carry the live sampler settings across a restart; they are session
		// state, not model state.
		state.temp = this.state.temp;
		state.topP = this.state.topP;
		state.topK = this.state.topK;

		const args = buildServerArgs(spec, this.d, ctx, state);
		const stamp = new Date().toISOString().replace(/[:.]/g, "-");
		state.logPath = join(logDir(), `llama-${spec.alias}-${stamp}.log`);
		const fd = openSync(state.logPath, "a");

		// Set the cache root explicitly rather than inheriting whatever the shell
		// happened to have. An unset LLAMA_CACHE sends llama.cpp to
		// ~/.cache/huggingface/hub on C:, and it re-downloads the whole roster
		// there without saying anything.
		const cacheRoot = this.d.llamaCache;
		notify(`starting llama-server: ${spec.alias} at ctx ${ctx} (log: ${state.logPath})`);
		const proc = spawn(bin, args, {
			cwd: dirname(resolve(bin)),
			stdio: ["ignore", fd, fd],
			windowsHide: true,
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

		// First use of a model downloads it, which is minutes, not seconds.
		const timeout = Number(process.env.PI_SMALL_START_TIMEOUT ?? 900) * 1000;
		const healthy = await waitHealthy(this.d, timeout);
		if (!healthy) {
			const why = exit.info ? `it exited (code ${exit.info.code}, signal ${exit.info.signal})` : "it never became healthy";
			await this.stop();
			throw new Error(`llama-server did not come up for ${spec.alias}: ${why}. See ${state.logPath}`);
		}

		// Believe the server, not the request: llama-server silently caps -c at
		// the model's training context, and a context window we only *think* we
		// have makes pi's compaction and maxTokens arithmetic wrong.
		const props = await fetchJson(api(this.d, "/props"), this.d, { method: "GET" }, 5000);
		const served = Number(props?.default_generation_settings?.n_ctx);
		state.servedCtx = Number.isFinite(served) && served > 0 ? served : ctx;
		if (state.servedCtx !== ctx) {
			notify(`NOTE: asked for ctx ${ctx}, server actually serves ${state.servedCtx} (capped to the model's training context)`);
		}
		await this.runProbes();
	}

	async runProbes(): Promise<void> {
		this.state.probes.turnBoundary = await probeTurnBoundary(this.d);
		this.state.probes.toolCalls = await probeToolCalls(this.d);
	}

	/** Kill the server, but only if we are the ones who started it. */
	async stop(): Promise<void> {
		const proc = this.state.proc;
		this.state.proc = null;
		this.state.adopted = false;
		if (!proc || proc.exitCode !== null) return;
		proc.kill("SIGTERM");
		const died = await Promise.race([
			new Promise<boolean>((r) => proc.once("exit", () => r(true))),
			new Promise<boolean>((r) => setTimeout(() => r(false), 10_000)),
		]);
		if (!died) proc.kill("SIGKILL");
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

	const mgr = new ServerManager(initial, d);

	// ---------------------------------------------------------- provider --
	// Registered during the factory so `--provider small-local --model
	// small-local/<alias>` resolves at startup; re-registered after the server
	// reports the context it actually serves.
	const registerProvider = (spec: ModelSpec, ctxWindow: number) => {
		pi.registerProvider(PROVIDER, {
			name: "Small Local (llama-server)",
			baseUrl: `http://${d.host}:${d.port}/v1`,
			apiKey: d.apiKey,
			authHeader: true,
			api: "openai-completions",
			models: [
				{
					id: spec.alias,
					name: `${spec.alias} (local)`,
					reasoning: true,
					input: ["text"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: ctxWindow,
					// Never let one response claim more than half the window, or
					// there is no room left for the prompt it is answering.
					maxTokens: Math.min(8192, Math.floor(ctxWindow / 2)),
					compat: {
						supportsDeveloperRole: false,
						supportsReasoningEffort: false,
						maxTokensField: "max_tokens",
						supportsUsageInStreaming: true,
					},
				},
			],
		});
	};
	registerProvider(initial, mgr.state.requestedCtx);

	// -------------------------------------------------------------- tools --
	// The entry point runs with --no-builtin-tools. This is pi's own bash tool,
	// handed back deliberately, so the tool list the model sees is a decision
	// rather than a default.
	pi.registerTool({
		...createBashToolDefinition(process.cwd()),
		promptSnippet: "Execute bash commands",
	});

	// ------------------------------------------------------------ sampling --
	// Temperature lives here, not in the harness and not only in the server
	// flags, so /sm-temp takes effect on the next request with no reload.
	pi.on("before_provider_request", (event: any) => {
		return {
			...event.payload,
			temperature: mgr.state.temp,
			top_p: mgr.state.topP,
			top_k: mgr.state.topK,
		};
	});

	// ------------------------------------------------------------- status --
	const weightsOf = (spec: ModelSpec): string => {
		const local = spec.localFile ? resolveLocalPath(spec.localFile) : spec.repo === "local" ? resolveLocalPath(spec.file) : null;
		return local ?? `${spec.repo}/${spec.file} (llama-server downloads it on first use)`;
	};

	const probeLine = (name: string, r?: ProbeResult) =>
		r === undefined ? `  ${name}: not run` : `  ${name}: ${r.ok ? "OK" : "FAIL"} — ${r.detail}`;

	const statusText = (): string => {
		const s = mgr.state;
		const where = s.adopted ? "adopted (not ours to kill)" : s.proc ? `pid ${s.proc.pid}` : "not running";
		const lines = [
			`model:   ${s.spec.alias}`,
			`server:  ${where} on ${d.host}:${d.port}`,
			`weights: ${weightsOf(s.spec)}`,
			`cache:   ${d.llamaCache ?? "LLAMA_CACHE unset — llama.cpp will use ~/.cache/huggingface/hub"}`,
			`context: ${s.servedCtx}${s.servedCtx !== s.requestedCtx ? ` (asked for ${s.requestedCtx})` : ""}`,
			`sampler: temp=${s.temp} top_p=${s.topP} top_k=${s.topK}`,
			`template: ${s.spec.chatTemplate ?? "embedded in the GGUF (--jinja)"}`,
			`extra flags: ${(s.spec.serverArgs ?? []).join(" ") || "(none)"}`,
			`log:     ${s.logPath || "(n/a)"}`,
			"probes:",
			probeLine("turn_boundary", s.probes.turnBoundary),
			probeLine("tool_calls", s.probes.toolCalls),
		];
		return lines.join("\n");
	};

	const reportProbes = (ctx: any) => {
		const { turnBoundary, toolCalls } = mgr.state.probes;
		if (turnBoundary && !turnBoundary.ok) ctx.ui.notify(`turn_boundary FAIL — ${turnBoundary.detail}`, "warn");
		if (toolCalls && !toolCalls.ok) ctx.ui.notify(`tool_calls FAIL — ${toolCalls.detail}`, "warn");
		if (turnBoundary?.ok && toolCalls?.ok) ctx.ui.notify("probes OK: stops at turn boundary, emits real tool_calls", "info");
	};

	/** Bring up a model and point the session at it. */
	const switchTo = async (spec: ModelSpec, ctxSize: number, ctx: any) => {
		ctx.ui.setStatus?.(`pi-small: loading ${spec.alias}…`);
		try {
			await mgr.start(spec, ctxSize, (msg) => ctx.ui.notify(`pi-small: ${msg}`, "info"));
		} catch (err: any) {
			ctx.ui.setStatus?.("");
			ctx.ui.notify(`pi-small: ${err.message}`, "error");
			return false;
		}
		registerProvider(spec, mgr.state.servedCtx);
		const model = ctx.modelRegistry.find(PROVIDER, spec.alias);
		if (model) await pi.setModel(model);
		// Belt and braces: whatever else got registered, the model sees bash.
		pi.setActiveTools(["bash"]);
		ctx.ui.setStatus?.("");
		ctx.ui.notify(`pi-small: ${spec.alias} ready at ctx ${mgr.state.servedCtx}, temp ${mgr.state.temp}`, "info");
		reportProbes(ctx);
		return true;
	};

	// ----------------------------------------------------------- lifecycle --
	pi.on("session_start", async (_event: any, ctx: any) => {
		pi.setActiveTools(["bash"]);
		await switchTo(mgr.state.spec, mgr.state.requestedCtx, ctx);
	});

	pi.on("session_shutdown", async () => {
		await mgr.stop();
	});

	// ------------------------------------------------------------ commands --
	pi.registerCommand("sm-status", {
		description: "Show the local model, server and sampler state",
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
			ctx.ui.notify(`pi-small: temperature ${t} (no restart needed)`, "info");
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
			await switchTo(mgr.state.spec, mgr.state.requestedCtx, ctx);
		},
	});
}
