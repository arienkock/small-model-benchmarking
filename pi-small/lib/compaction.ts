/**
 * pi-small's compaction prompt, used for every session in place of pi's own.
 *
 * pi's default asks for a seven-section checkpoint (goal, constraints, done /
 * in progress / blocked, decisions, next steps, critical context). On a model
 * generating 10-14 tokens/s that output is the expensive part, and most of it
 * restates the task, which pi keeps anyway. This asks for two short parts:
 * what would be expensive to relearn, and what to do next.
 *
 * pi's `customInstructions` cannot replace its prompt: it is appended to it as
 * "Additional focus". So the plugin's session_before_compact hook makes the
 * summary call itself and hands pi the result (see extensions/small.ts): first
 * in context (buildCompactionInstruction), which reuses the server's prompt
 * cache, then, if that fails, from a serialized copy (buildCompactionPrompt).
 */

export interface CompactionPromptOpts {
	/** The conversation to summarize, already serialized as text. */
	conversation: string;
	/** The summary from the previous compaction, if there was one. */
	previousSummary?: string;
	/** A review step also keeps its findings so far (lib/review.ts). */
	review?: boolean;
	/** Word limit for each of the two parts (roster `compactionWords`). */
	words: number;
}

/** The two parts (three for a review step) the summary must have. */
function summaryParts(o: { review?: boolean; words: number }): string[] {
	const n = o.words;
	const parts = [
		`## Lessons\nAt most ${n} words. Everything learned in this session that would be expensive to relearn: what failed and why, what turned out to be true about the code, the environment and the tools, commands that work, pitfalls to avoid. Exact file paths, names and error messages where they matter.`,
		"",
		`## Next steps\nAt most ${n} words. What to do next, in order, starting from where the work stands now.`,
	];
	if (o.review) parts.push("", "## Findings so far\nOne line each: `priority | location | one-line evidence`. Every finding, however many words that takes.");
	return parts;
}

/**
 * The instruction for an IN-CONTEXT summary: sent as the result of a synthetic
 * tool call appended to the session's own messages, so the request shares its
 * whole prefix with the previous turn and llama-server reuses its prompt cache.
 * Summarizing a serialized copy of the conversation instead (buildCompactionPrompt)
 * makes the server read the entire history again: ~25 minutes per compaction at
 * 16k context on the laptop (free-form run 2, 2026-09-25).
 *
 * A tool result rather than a user message: Qwen-style templates keep the
 * thinking of assistant turns only after the LAST user message, so a new user
 * message would re-render every earlier turn and miss the cache anyway.
 */
export function buildCompactionInstruction(o: { review?: boolean; words: number }): string {
	return [
		"Stop work on the task now. Your context is being compacted: everything above, except the task itself, will be replaced by what you write in reply to this, and you will continue from that alone. Do not call any tools. Do not restate the task.",
		"",
		"Reply with these parts, and nothing else:",
		"",
		...summaryParts(o),
		"",
		"Include the lessons of any earlier summary above that still hold.",
	].join("\n");
}

/** Fallback: summarize a serialized copy of the conversation in a fresh request. */
export function buildCompactionPrompt(o: CompactionPromptOpts): string {
	const parts = [
		"The conversation below is being compacted: it will be replaced by what you write now, and you will continue the work from that alone. The task itself is kept, so do not restate it.",
		"",
		"Write these parts, and nothing else:",
		"",
		...summaryParts(o),
	];
	if (o.previousSummary?.trim()) {
		parts.push("", "An earlier compaction wrote the summary in <previous-summary>. Carry its lessons forward unless they no longer hold.", "", `<previous-summary>\n${o.previousSummary.trim()}\n</previous-summary>`);
	}
	parts.push("", `<conversation>\n${o.conversation}\n</conversation>`);
	return parts.join("\n");
}
