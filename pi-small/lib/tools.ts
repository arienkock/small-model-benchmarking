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

/** bash's own options, plus the guard list this plugin adds on top. */
export interface BashToolConfig extends BashToolOptions {
	commandGuards?: CommandGuard[];
}

function shQuote(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Turn `commandGuards` into a spawnHook that refuses a matching command instead of running it. */
function withGuards(options: BashToolConfig): BashToolOptions {
	const { commandGuards, spawnHook, ...rest } = options;
	if (!commandGuards || commandGuards.length === 0) return options;
	const compiled = commandGuards.map((g) => ({ re: new RegExp(g.pattern, g.flags ?? "i"), message: g.message }));
	const hook = (context: BashSpawnContext): BashSpawnContext => {
		const hit = compiled.find((g) => g.re.test(context.command));
		if (hit) return { ...context, command: `echo ${shQuote(hit.message)} 1>&2; exit 1` };
		return spawnHook ? spawnHook(context) : context;
	};
	return { ...rest, spawnHook: hook };
}

type ToolBuilder = (cwd: string, options: any) => ToolDefinition<any, any, any>;

const TOOL_BUILDERS: Record<string, ToolBuilder> = {
	bash: (cwd, options) => createBashToolDefinition(cwd, withGuards(options as BashToolConfig)),
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
