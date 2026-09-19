/**
 * roster.ts — the roster file and where its weights are, with NO dependency on
 * pi.
 *
 * This is deliberately separate from extensions/small.ts. The plugin half can
 * only run inside pi, which supplies `@earendil-works/pi-coding-agent` at load
 * time; this half has to run under plain `node` on the serving machine, where
 * pi-small's dev dependencies are not installed. check-roster.mjs is exactly
 * that case, and it must resolve paths through the same code a real session
 * uses or it is worthless as a check.
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
	/** Per-model overrides of the roster defaults. */
	ctx?: number;
	temp?: number;
	topP?: number;
	topK?: number;
	reasoningBudget?: number;
}

export interface RosterDefaults {
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

export interface Sampler {
	temp: number;
	topP: number;
	topK: number;
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
		"--temp", String(sampler.temp),
		"--top-p", String(sampler.topP),
		"--top-k", String(sampler.topK),
	);
	const template = resolveTemplate(spec);
	if (template) args.push("--chat-template-file", template);
	args.push(...(d.serverArgs ?? []), ...(spec.serverArgs ?? []));
	args.push("--api-key", d.apiKey, "--host", hostOverride ?? d.host, "--port", String(d.port));
	return args;
}
