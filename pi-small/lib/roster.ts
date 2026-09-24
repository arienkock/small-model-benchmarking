/**
 * roster.ts — the roster file and where its weights are, with NO dependency on
 * pi.
 *
 * This is deliberately separate from extensions/small.ts. The plugin half can
 * only run inside pi, which supplies `@earendil-works/pi-coding-agent` at load
 * time; this half has to run under plain `node` on the serving machine, where
 * pi-small's dev dependencies are not installed. check-roster.mjs is exactly
 * that case, and it must resolve paths through the same code a real session
 * uses or it is worthless as a check. lib/tools.ts, which DOES depend on pi,
 * stays on the other side of that line for the same reason — this file only
 * ever hands back tool KIND NAMES and OPTION BAGS, never a tool definition.
 *
 * It also must NOT live under extensions/: pi loads every .ts in that directory
 * as an extension, and a module with no default export would fail to load.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The pi-small package root, one level up from this file's directory. */
export const PLUGIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type ThinkingMode = "on" | "off";

/** The sampler fields a roster entry may state — flat, or per thinking mode. */
export interface SamplerFields {
	temp?: number;
	topP?: number;
	topK?: number;
	repeatPenalty?: number;
	minP?: number;
	presencePenalty?: number;
}

export interface ModelSpec {
	alias: string;
	/** Hugging Face repo id, or the literal "local" (then `file` is a path). */
	repo: string;
	file: string;
	/**
	 * A copy of the weights already on the serving machine. When it resolves to
	 * an existing file it is used with -m and nothing is downloaded; otherwise
	 * the model falls back to repo/file. May contain `*` in a path segment and
	 * may start with `~` — the cache puts the weights behind a snapshot hash
	 * that changes whenever the repo is re-fetched.
	 */
	localFile?: string;
	notes?: string;
	default?: boolean;
	/** Template filename under ../templates, or an absolute path. */
	chatTemplate?: string | null;
	/** Extra llama-server flags for this model only. */
	serverArgs?: string[];
	/**
	 * How many layers this model puts on the GPU (-ngl), overriding
	 * `defaults.ngl`. The default (999) means "all", which is right for the
	 * models that fit and for the MoE models that keep their experts on the CPU
	 * with --n-cpu-moe. A DENSE model too big for the card has no such lever:
	 * -ngl is the only split it has, the working value is a measured number
	 * (Granite 4.2 30B at 10, Qwen3.8-27B at 20 on this laptop), and one layer
	 * too many is a hard CUDA OOM at load. Putting it here rather than in
	 * serverArgs keeps it out of a second, later -ngl on the same command line,
	 * where only llama.cpp's last-one-wins parsing would decide which applies.
	 */
	ngl?: number;
	/**
	 * Thinking mode for a model that HAS one: "on" or "off", this model's
	 * default. Leave unset for a model with no thinking mode (Qwen3-Coder), and
	 * nothing thinking-related is emitted beyond the budget. When set, pi-small
	 * emits the template's own switch — `--chat-template-kwargs
	 * {"enable_thinking":…}` on the command line AND per request — because
	 * `--reasoning-budget 0` alone does NOT disable thinking on the Qwen3.6,
	 * Qwen3.8 or Granite 4.2 templates (measured 2026-09-22: a 120-token request
	 * came back as 120 tokens of thoughts with empty content). Overridable per
	 * run with PI_SMALL_THINKING=on|off, or `serve.mjs --thinking on|off`.
	 */
	thinking?: ThinkingMode;
	/**
	 * `reasoning_effort` for templates that read it, sent next to
	 * `enable_thinking` (command line and every request) while thinking is on.
	 * Granite-4.2's template knows one value: "low" appends "{reasoning effort:
	 * low}" to the last user message; anything else is its normal effort. Ignored
	 * with thinking off and for a model with no thinking mode.
	 */
	reasoningEffort?: string;
	/**
	 * One sampler per thinking mode, for a model whose card pairs different
	 * numbers with each mode (Qwen: temp 1.0 / top_p 0.95 thinking, 0.7 / 0.80
	 * instruct). The row for the ACTIVE mode is used; any field it omits falls
	 * back to this spec's flat fields, then to the roster defaults. Serving one
	 * mode's numbers in the other is the silent mismatch this exists to prevent,
	 * which is why the mode and the sampler are chosen together, never apart.
	 */
	samplers?: { thinking?: SamplerFields; instruct?: SamplerFields };
	/**
	 * Largest single response (thinking AND answer) pi asks for, overriding
	 * defaults.maxTokens. The vendors' own evals assume up to 32k for a thinking
	 * model; this harness defaults to 4096 because every token of it has to fit
	 * in the window beside the prompt. Raising it also raises the compaction
	 * reserve bin/pi-small seeds (see requiredReserveTokens).
	 */
	maxTokens?: number;
	/** Per-model overrides of the roster defaults. */
	ctx?: number;
	temp?: number;
	topP?: number;
	topK?: number;
	/** Repetition penalty (llama.cpp --repeat-penalty; 1.0 disables it). */
	repeatPenalty?: number;
	/** min-p sampling (llama.cpp --min-p; 0.0 disables it). */
	minP?: number;
	/**
	 * Presence penalty (llama.cpp --presence-penalty; 0.0 disables it). Qwen3.6
	 * and Qwen3.8 are the models on this roster whose cards ask for a non-zero
	 * one (1.5 in instruct/non-thinking mode); everything else wants 0, which is
	 * also llama.cpp's and transformers' default.
	 */
	presencePenalty?: number;
	reasoningBudget?: number;
	/**
	 * Context sizes to fall back to for THIS model if `ctx` (or whatever was
	 * asked for) does not fit in GPU memory, largest first. Overrides
	 * `defaults.ctxCandidates` entirely. See `resolveCtxLadder`.
	 */
	ctxCandidates?: number[];
	/**
	 * Tool kinds this model gets (see ../lib/tools.ts for the list). Overrides
	 * `defaults.tools` entirely — it is not merged with it.
	 */
	tools?: string[];
	/**
	 * Per-kind tool options for this model, keyed by kind name (e.g. `bash`).
	 * Merged field by field over `defaults.toolOptions` for that kind: a field
	 * set here wins, a field not set here keeps the default. (It used to replace
	 * the kind's defaults wholesale, which would have silently dropped a roster-wide
	 * setting such as bash `defaultTimeoutSec` for MiniCPM5, the one model with
	 * its own bash options.) This is where a guard or a tool variation for ONE
	 * model lives, e.g. `{ bash: { commandGuards: [...] } }` — see MiniCPM5.
	 */
	toolOptions?: Record<string, Record<string, unknown>>;
	/**
	 * Replaces the near-empty system prompt for this model only, re-applied on
	 * every turn so it follows /sm-model. Overrides `defaults.systemPrompt`.
	 * Leave unset to keep PI_SMALL_SYSTEM_PROMPT / pi's own default.
	 */
	systemPrompt?: string;
}

export interface RosterDefaults {
	port: number;
	apiKey: string;
	host: string;
	ctx: number;
	temp: number;
	topP: number;
	topK: number;
	/**
	 * These two exist because llama.cpp applies its OWN defaults when they are
	 * not passed — `--repeat-penalty 1.0` and `--min-p 0.05` — and a model card
	 * that asks for something else (Qwen3-Coder wants 1.05 and 0) then silently
	 * does not get it. Keeping them in the roster makes the full sampler
	 * explicit rather than half-specified.
	 */
	repeatPenalty: number;
	minP: number;
	presencePenalty: number;
	reasoningBudget: number;
	/** See ModelSpec.maxTokens. 4096 when unset. */
	maxTokens?: number;
	ngl: number;
	serverArgs: string[];
	/** Context sizes tried, largest first, when a model does not set its own `ctxCandidates`. */
	ctxCandidates: number[];
	/** Tool kinds served when a model does not set its own `tools`. */
	tools: string[];
	/** Per-kind tool options served when a model does not set its own for that kind. */
	toolOptions: Record<string, Record<string, unknown>>;
	/** Replaces the near-empty system prompt for every model that does not set its own. */
	systemPrompt?: string;
	/**
	 * Where llama.cpp keeps downloaded weights. MUST be a Windows path on the
	 * bench laptop — this is passed in the environment, and MSYS does not
	 * translate environment variables the way it translates arguments. Kept in
	 * step with ../llama-cache.env, which is the source of truth for the shell
	 * side; $LLAMA_CACHE in the environment still wins over both.
	 */
	llamaCache?: string;
}

export interface Roster {
	defaults: RosterDefaults;
	models: ModelSpec[];
}

export function loadRoster(): Roster {
	const path = process.env.PI_SMALL_ROSTER ?? join(PLUGIN_DIR, "roster.json");
	const raw = JSON.parse(readFileSync(path, "utf8")) as Roster;
	if (!Array.isArray(raw.models) || raw.models.length === 0) {
		throw new Error(`roster ${path} has no models`);
	}
	return raw;
}

/**
 * Resolve a path that may start with `~` and may contain `*` in any segment.
 * Returns the matching file, or null if nothing matches. When several match,
 * the last in sort order wins, so the choice is at least deterministic.
 */
export function resolveLocalPath(pattern: string): string | null {
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

/** Where a model's weights will come from: a local file, or a download. */
export function weightsSource(spec: ModelSpec): { local: string | null; description: string } {
	const pattern = spec.localFile ?? (spec.repo === "local" ? spec.file : null);
	const local = pattern ? resolveLocalPath(pattern) : null;
	return {
		local,
		description: local ?? `${spec.repo}/${spec.file} (llama-server downloads it on first use)`,
	};
}

/** Absolute path of a model's chat template override, or null for the GGUF's own. */
export function resolveTemplate(spec: ModelSpec): string | null {
	if (!spec.chatTemplate) return null;
	if (isAbsolute(spec.chatTemplate)) return spec.chatTemplate;
	return join(PLUGIN_DIR, "templates", spec.chatTemplate);
}

/** Tool kinds this model gets: its own list, or the roster default. */
export function resolveTools(spec: ModelSpec, d: RosterDefaults): string[] {
	return spec.tools ?? d.tools;
}

/** This model's options for one tool kind: its own, else the roster default for that kind, else none. */
export function resolveToolOptions(spec: ModelSpec, d: RosterDefaults, kind: string): Record<string, unknown> {
	return { ...(d.toolOptions[kind] ?? {}), ...(spec.toolOptions?.[kind] ?? {}) };
}

/** This model's system-prompt override, if any: its own, else the roster default, else unset. */
export function resolveSystemPrompt(spec: ModelSpec, d: RosterDefaults): string | undefined {
	return spec.systemPrompt ?? d.systemPrompt;
}

/**
 * Context sizes to TRY for this model, in order: the exact size asked for
 * first (so an explicit request, e.g. from /sm-ctx, is always honored if it
 * fits), then progressively smaller entries from `ctxCandidates` (the
 * model's own, else the roster default) that are below it.
 *
 * Mirrors coding-bench/run-filter-bench.sh's per-model context probe: on a
 * shared GPU there is no reliable way to know ahead of time whether a model's
 * KV cache at a given context fits in whatever VRAM is free — llama-server
 * has to actually be started to find out. ServerManager.start() walks this
 * ladder and keeps the first size that comes up healthy.
 */
/**
 * pi subtracts a FIXED margin from a model's contextWindow before clamping the
 * max_tokens it asks for, in clampMaxTokensToContext:
 *
 *     CONTEXT_SAFETY_TOKENS = 4096, MIN_MAX_TOKENS = 1
 *     available = model.contextWindow - estimateContextTokens(context) - 4096
 *     return Math.min(maxTokens, Math.max(1, available))
 *
 * The margin does not scale with the window, so at contextWindow 4096 that
 * subtraction is already negative before the prompt is counted at all, and
 * every request is clamped to ONE token — which comes back as
 * `finish_reason: "length"` with a single character of content. The session
 * does not error; it just produces nothing, turn after turn.
 *
 * This is a property of pi, not of llama-server or of any model: a 4096 window
 * that llama-server serves perfectly happily (verified directly with curl) is
 * still unusable through pi. It is the reason the default ladder below stops
 * at 8192 rather than 4096.
 */
export const PI_CONTEXT_SAFETY_TOKENS = 4096;

/**
 * The smallest context worth serving through pi. Below `PI_CONTEXT_SAFETY_TOKENS`
 * of headroom there is no room for an answer; 8192 leaves roughly 3.5k tokens
 * after a typical agent prompt, which is the smallest window that behaves like
 * a working session rather than a broken one.
 */
export const MIN_USABLE_CTX = 2 * PI_CONTEXT_SAFETY_TOKENS;

/**
 * A warning about what pi will do with a context this size, or null when there
 * is nothing to say. Called wherever a served context is reported, because the
 * failure it describes is silent and looks like a stupid model.
 */
export function ctxUsabilityWarning(servedCtx: number): string | null {
	if (servedCtx <= PI_CONTEXT_SAFETY_TOKENS) {
		return (
			`context ${servedCtx} is at or below pi's fixed ${PI_CONTEXT_SAFETY_TOKENS}-token safety margin, ` +
			`so pi will clamp max_tokens to 1 and EVERY request will return a single token with ` +
			`finish_reason "length". The server is fine; the session will not be. Serve at least ${MIN_USABLE_CTX}.`
		);
	}
	if (servedCtx < MIN_USABLE_CTX) {
		return (
			`context ${servedCtx} leaves only ~${servedCtx - PI_CONTEXT_SAFETY_TOKENS} tokens after pi's fixed ` +
			`${PI_CONTEXT_SAFETY_TOKENS}-token safety margin, before the prompt itself is counted. ` +
			`Expect very short answers and early truncation.`
		);
	}
	return null;
}

export function resolveCtxLadder(spec: ModelSpec, d: RosterDefaults, requestedCtx: number): number[] {
	const configured = spec.ctxCandidates ?? d.ctxCandidates;
	const smaller = configured.filter((c) => c < requestedCtx).sort((a, b) => b - a);
	return [requestedCtx, ...smaller];
}

export interface Sampler {
	temp: number;
	topP: number;
	topK: number;
	repeatPenalty: number;
	minP: number;
	presencePenalty: number;
}

/**
 * The full llama-server command line for a model. Pure, and shared by the
 * plugin (which spawns it locally) and serve.mjs (which starts it on the host
 * for the containerised session), so the two can never drift apart.
 *
 * `hostOverride` exists for exactly that second case: a container reaches the
 * server through host.docker.internal, which means the server has to be bound
 * to 0.0.0.0 rather than the roster's loopback default.
 */
export function buildServerArgs(
	spec: ModelSpec,
	d: RosterDefaults,
	ctx: number,
	sampler: Sampler,
	hostOverride?: string,
	mode: ThinkingMode | null = resolveThinking(spec),
): string[] {
	const args: string[] = [];
	// Prefer weights already on this machine, so -hf never re-fetches something
	// the cache already holds.
	const local = weightsSource(spec).local;
	if (local) {
		args.push("-m", local);
	} else if (spec.repo === "local") {
		throw new Error(`${spec.alias}: repo is "local" but no file matched ${spec.file}`);
	} else {
		args.push("-hf", spec.repo, "-hff", spec.file);
	}
	args.push(
		"--alias", spec.alias,
		"--jinja",
		"-c", String(ctx),
		"-ngl", String(spec.ngl ?? d.ngl),
		"--parallel", "1",
		...thinkingArgs(spec, d, ctx, mode),
		"--temp", String(sampler.temp),
		"--top-p", String(sampler.topP),
		"--top-k", String(sampler.topK),
		"--repeat-penalty", String(sampler.repeatPenalty),
		"--min-p", String(sampler.minP),
		"--presence-penalty", String(sampler.presencePenalty),
	);
	const template = resolveTemplate(spec);
	if (template) args.push("--chat-template-file", template);
	args.push(...(d.serverArgs ?? []), ...(spec.serverArgs ?? []));
	args.push("--api-key", d.apiKey, "--host", hostOverride ?? d.host, "--port", String(d.port));
	return args;
}

/**
 * The mode a model actually runs in: an explicit override (PI_SMALL_THINKING,
 * `serve.mjs --thinking`) when the model has modes at all, else the roster's
 * own `thinking`. null for a model with no thinking mode — an override is then
 * meaningless and ignored (see thinkingOverrideWarning).
 */
export function resolveThinking(spec: ModelSpec, override: string | null | undefined = process.env.PI_SMALL_THINKING): ThinkingMode | null {
	if (!spec.thinking) return null;
	if (override === "on" || override === "off") return override;
	return spec.thinking;
}

/** Why an override was ignored or invalid, or null when there is nothing to say. */
export function thinkingOverrideWarning(spec: ModelSpec, override: string | null | undefined = process.env.PI_SMALL_THINKING): string | null {
	if (override === undefined || override === null || override === "") return null;
	if (override !== "on" && override !== "off") return `PI_SMALL_THINKING=${override} is not "on" or "off" — ignored`;
	if (!spec.thinking) return `${spec.alias} has no thinking mode in roster.json — thinking=${override} ignored`;
	return null;
}

/**
 * The full sampler for `mode`: the mode's own row, then the spec's flat
 * fields, then the roster defaults — field by field, never all-or-nothing.
 */
export function resolveSampler(spec: ModelSpec, d: RosterDefaults, mode: ThinkingMode | null = resolveThinking(spec)): Sampler {
	const row: SamplerFields | undefined = mode === "on" ? spec.samplers?.thinking : mode === "off" ? spec.samplers?.instruct : undefined;
	return {
		temp: row?.temp ?? spec.temp ?? d.temp,
		topP: row?.topP ?? spec.topP ?? d.topP,
		topK: row?.topK ?? spec.topK ?? d.topK,
		repeatPenalty: row?.repeatPenalty ?? spec.repeatPenalty ?? d.repeatPenalty,
		minP: row?.minP ?? spec.minP ?? d.minP,
		presencePenalty: row?.presencePenalty ?? spec.presencePenalty ?? d.presencePenalty,
	};
}

/**
 * The chat-template kwargs that put a moded model in `mode`, or null for a model
 * without modes. `reasoningEffort` rides along only while thinking is on.
 */
export function thinkingKwargs(mode: ThinkingMode | null, reasoningEffort?: string): { enable_thinking: boolean; reasoning_effort?: string } | null {
	if (mode === null) return null;
	return mode === "on" && reasoningEffort ? { enable_thinking: true, reasoning_effort: reasoningEffort } : { enable_thinking: mode === "on" };
}

/**
 * The thinking-related command-line flags.
 *
 *   off  --reasoning-budget 0 AND the template kwarg. The budget alone does not
 *        disable thinking on these templates; the kwarg is load-bearing.
 *   on   the roster budget (-1 = unrestricted, the vendor default) AND the
 *        kwarg, so a template whose default is off is switched on explicitly.
 *   null (no modes) the budget alone, as before.
 *
 * A positive budget is capped at a quarter of the context, as the bench does:
 * one larger than the window leaves no room for the prompt or the answer.
 */
export function thinkingArgs(spec: ModelSpec, d: RosterDefaults, ctx: number, mode: ThinkingMode | null): string[] {
	const wanted = spec.reasoningBudget ?? d.reasoningBudget;
	const budget = wanted > 0 ? Math.min(wanted, Math.floor(ctx / 4)) : wanted;
	if (mode === "off") return ["--reasoning-budget", "0", "--chat-template-kwargs", JSON.stringify(thinkingKwargs(mode))];
	if (mode === "on") return ["--reasoning-budget", String(budget), "--chat-template-kwargs", JSON.stringify(thinkingKwargs(mode, spec.reasoningEffort))];
	return ["--reasoning-budget", String(budget)];
}

/** Default single-response cap, thinking and answer combined. */
export const DEFAULT_MAX_TOKENS = 4096;

export function resolveMaxTokens(spec: ModelSpec, d: RosterDefaults): number {
	return spec.maxTokens ?? d.maxTokens ?? DEFAULT_MAX_TOKENS;
}

/**
 * The compaction.reserveTokens pi needs for this roster. pi compacts once the
 * context passes (window - reserve); if the reserve is smaller than the largest
 * response pi may ask for, a response can arrive with no room to land in and is
 * truncated instead of compaction running first. 2048 of headroom above the
 * largest maxTokens, and never below the 6144 bin/pi-small always used.
 */
export function requiredReserveTokens(roster: Roster): number {
	const largest = Math.max(...roster.models.map((m) => resolveMaxTokens(m, roster.defaults)));
	return Math.max(6144, largest + 2048);
}

/**
 * Compare what the live server says it will sample with against what was
 * intended. Every sampler bug this harness has had — top_p/top_k, then
 * repeat_penalty/min_p, then presence_penalty — looked right in the config and
 * was only caught by reading /props or the argv. Returns one line per
 * mismatch; an empty list means it matches. Floats come back as f32
 * (0.699999988…), hence the tolerance.
 */
export function compareProps(props: any, sampler: Sampler, ctx?: number): string[] {
	const p = props?.default_generation_settings?.params;
	if (!p) return ["/props has no default_generation_settings.params — cannot verify the sampler"];
	const out: string[] = [];
	const check = (name: string, live: unknown, want: number) => {
		const v = Number(live);
		if (live === undefined || live === null || !Number.isFinite(v)) out.push(`${name}: server does not report it (wanted ${want})`);
		else if (Math.abs(v - want) > 1e-4) out.push(`${name}: server ${Number(v.toFixed(4))}, roster ${want}`);
	};
	check("temperature", p.temperature, sampler.temp);
	check("top_p", p.top_p, sampler.topP);
	check("top_k", p.top_k, sampler.topK);
	check("min_p", p.min_p, sampler.minP);
	check("repeat_penalty", p.repeat_penalty, sampler.repeatPenalty);
	check("presence_penalty", p.presence_penalty, sampler.presencePenalty);
	const n = Number(props?.default_generation_settings?.n_ctx);
	if (ctx !== undefined && Number.isFinite(n) && n !== ctx) out.push(`n_ctx: server ${n}, expected ${ctx}`);
	return out;
}

/**
 * Configuration mistakes a roster entry can make that nothing else would catch.
 * Reported by check-roster.mjs and asserted empty by the tests.
 */
export function validateSpec(spec: ModelSpec): string[] {
	const out: string[] = [];
	const extra = spec.serverArgs ?? [];
	if (spec.thinking && extra.some((a) => a === "--chat-template-kwargs" || a === "--reasoning-budget")) {
		out.push(`${spec.alias}: sets "thinking" AND passes --chat-template-kwargs/--reasoning-budget in serverArgs — the two would fight; remove them from serverArgs`);
	}
	if (spec.thinking && spec.thinking !== "on" && spec.thinking !== "off") {
		out.push(`${spec.alias}: thinking must be "on" or "off", got ${JSON.stringify(spec.thinking)}`);
	}
	if (spec.reasoningEffort !== undefined && !spec.thinking) {
		out.push(`${spec.alias}: has "reasoningEffort" but no "thinking" mode, so it is never sent`);
	}
	if (spec.reasoningEffort !== undefined && (typeof spec.reasoningEffort !== "string" || !spec.reasoningEffort)) {
		out.push(`${spec.alias}: "reasoningEffort" must be a non-empty string`);
	}
	if (spec.samplers && !spec.thinking) {
		out.push(`${spec.alias}: has per-mode "samplers" but no "thinking" mode, so neither row is ever used`);
	}
	if (spec.thinking && spec.samplers) {
		const keys: (keyof SamplerFields)[] = ["temp", "topP", "topK", "repeatPenalty", "minP", "presencePenalty"];
		for (const mode of ["thinking", "instruct"] as const) {
			const row = spec.samplers[mode];
			if (!row) out.push(`${spec.alias}: samplers.${mode} missing — switching to that mode would silently use the flat/default sampler`);
			else {
				const missing = keys.filter((k) => row[k] === undefined && spec[k] === undefined);
				if (missing.length) out.push(`${spec.alias}: samplers.${mode} leaves ${missing.join(", ")} to the roster defaults`);
			}
		}
	}
	return out;
}

/**
 * One argument, quoted for a spawn() that goes through cmd.exe — i.e. when the
 * server binary is a .cmd/.bat wrapper and Node requires shell:true. Node then
 * joins the arguments with spaces and quotes nothing, and the wrapper's `%*`
 * hands them to a program that parses them by the MSVCRT rules, which STRIP
 * unescaped double quotes: `{"enable_thinking":false}` arrived as
 * `{enable_thinking:false}`, which is not JSON — so the thinking switch was
 * silently lost for anyone serving through a wrapper script (found by the test
 * suite, whose Windows stub is exactly such a wrapper).
 *
 * Quotes an argument only when it contains a double quote or whitespace, by
 * the MSVCRT rules: inner quotes become \", and backslashes are doubled only
 * where they precede a quote. cmd.exe metacharacters (& | < > ^ %) are not
 * handled; no argument pi-small builds contains them.
 *
 * NOT used on the normal path: llama-server.exe is spawned without a shell,
 * and Node quotes arguments correctly for CreateProcess itself.
 */
export function quoteForCmdShell(arg: string): string {
	if (!/[\s"]/.test(arg)) return arg;
	return '"' + arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1") + '"';
}
