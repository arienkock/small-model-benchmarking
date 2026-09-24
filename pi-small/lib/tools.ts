/**
 * tools.ts — the tool kinds pi-small can serve, and how a model's roster entry
 * picks and configures them.
 *
 * A "kind" names one of pi's built-in tool factories: bash, read, write, edit,
 * grep, find, ls. `defaults.tools` / a model's `tools` in roster.json list
 * which kinds that model gets; `defaults.toolOptions` / a model's
 * `toolOptions` carry that kind's config, keyed by kind name. A model that
 * sets neither falls through to the roster defaults, so most entries in
 * roster.json need not mention tools at all.
 *
 * This is where a per-model VARIATION of a tool lives — a guard, a different
 * error message, a narrower option — without touching any other model's
 * config or the shared roster.json defaults. bash gets one extension beyond
 * pi's own BashToolOptions: `commandGuards`, a list of {pattern, message}
 * checked against the command line before it runs. A match replaces the
 * command with one that prints `message` to stderr and exits 1, so the model
 * sees exactly why the call was refused instead of pi-small silently doing
 * something else. See roster.json's MiniCPM5 entry for a real one.
 */

import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type BashSpawnContext,
	type BashToolOptions,
	type ToolDefinition,
} from "@earendil-works/pi-coding-agent";

/** One command-line guard: a match refuses the call with `message` instead of running it. */
export interface CommandGuard {
	/** Regex source tested against the full command line. */
	pattern: string;
	/** Regex flags; defaults to case-insensitive. */
	flags?: string;
	/** Shown to the model, on stderr, in place of running the command. */
	message: string;
}

/** bash's own options, plus what this plugin adds on top: guards and a default timeout. */
export interface BashToolConfig extends BashToolOptions {
	commandGuards?: CommandGuard[];
	/**
	 * Seconds a command may run when the model does not pass its own `timeout`.
	 * pi's bash has none by default, so one command that never returns blocks the
	 * session until its limit: Granite-4.2-3B lost 36 of a session's 40 minutes on
	 * 2026-09-24 to a `curl` (no -m) against its own server, which accepted the
	 * connection and never answered. Short on purpose (20 s in roster.json): the
	 * error tells the model to pass a `timeout` when a command really needs longer.
	 */
	defaultTimeoutSec?: number;
}

function shQuote(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Turn `commandGuards` into a spawnHook that refuses a matching command instead of running it. */
function withGuards(options: BashToolConfig): BashToolOptions {
	const { commandGuards, spawnHook, defaultTimeoutSec: _timeout, ...rest } = options;
	if (!commandGuards || commandGuards.length === 0) return options;
	const compiled = commandGuards.map((g) => ({ re: new RegExp(g.pattern, g.flags ?? "i"), message: g.message }));
	const hook = (context: BashSpawnContext): BashSpawnContext => {
		const hit = compiled.find((g) => g.re.test(context.command));
		if (hit) return { ...context, command: `echo ${shQuote(hit.message)} 1>&2; exit 1` };
		return spawnHook ? spawnHook(context) : context;
	};
	return { ...rest, spawnHook: hook };
}

/**
 * Give every bash call a timeout unless the model chose one itself. When the
 * DEFAULT is what stopped a command, the error says so and tells the model how to
 * ask for more, so a legitimately long command (a test suite, a build) is one
 * retry away rather than a dead end.
 */
function withDefaultTimeout(def: ToolDefinition<any, any, any>, seconds: number | undefined): ToolDefinition<any, any, any> {
	if (!seconds) return def;
	return {
		...def,
		execute: async (id: string, params: any, ...rest: any[]) => {
			const defaulted = params && params.timeout === undefined;
			try {
				return await (def.execute as any)(id, defaulted ? { ...params, timeout: seconds } : params, ...rest);
			} catch (e: any) {
				if (defaulted && /Command timed out after/.test(String(e?.message))) {
					throw new Error(
						`${e.message}\n[pi-small] ${seconds} s is the default limit for a command. If this command needs longer (a test suite, a build), ` +
							`run it again with the bash tool's "timeout" argument set, in seconds. If it should have finished, it is probably waiting ` +
							`on something (a server that never answers, input it will not get).`,
					);
				}
				throw e;
			}
		},
	};
}

type ToolBuilder = (cwd: string, options: any) => ToolDefinition<any, any, any>;

const TOOL_BUILDERS: Record<string, ToolBuilder> = {
	bash: (cwd, options) => withDefaultTimeout(createBashToolDefinition(cwd, withGuards(options as BashToolConfig)), (options as BashToolConfig).defaultTimeoutSec),
	read: (cwd, options) => createReadToolDefinition(cwd, options),
	write: (cwd, options) => createWriteToolDefinition(cwd, options),
	edit: (cwd, options) => createEditToolDefinition(cwd, options),
	grep: (cwd, options) => createGrepToolDefinition(cwd, options),
	find: (cwd, options) => createFindToolDefinition(cwd, options),
	ls: (cwd, options) => createLsToolDefinition(cwd, options),
};

/** The tool kinds pi-small knows how to build — the valid values for roster.json `tools`. */
export const TOOL_KINDS = Object.keys(TOOL_BUILDERS);

/** Build the tool definition for one kind, with this model's options applied. */
export function buildTool(kind: string, cwd: string, options: Record<string, unknown>): ToolDefinition<any, any, any> {
	const builder = TOOL_BUILDERS[kind];
	if (!builder) throw new Error(`unknown tool kind "${kind}" — one of ${TOOL_KINDS.join(", ")}`);
	return builder(cwd, options);
}
