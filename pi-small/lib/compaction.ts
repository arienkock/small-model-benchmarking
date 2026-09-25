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
 * summary call itself and hands pi the result (see extensions/small.ts).
 */

export const COMPACTION_WORD_LIMIT = 400;

export interface CompactionPromptOpts {
	/** The conversation to summarize, already serialized as text. */
	conversation: string;
	/** The summary from the previous compaction, if there was one. */
	previousSummary?: string;
	/** A review step also keeps its findings so far (lib/review.ts). */
	review?: boolean;
}

export function buildCompactionPrompt(o: CompactionPromptOpts): string {
	const n = COMPACTION_WORD_LIMIT;
	const parts = [
		"The conversation below is being compacted: it will be replaced by what you write now, and you will continue the work from that alone. The task itself is kept, so do not restate it.",
		"",
		"Write two parts, and nothing else:",
		"",
		`## Lessons\nAt most ${n} words. Everything learned in this session that would be expensive to relearn: what failed and why, what turned out to be true about the code, the environment and the tools, commands that work, pitfalls to avoid. Exact file paths, names and error messages where they matter.`,
		"",
		`## Next steps\nAt most ${n} words. What to do next, in order, starting from where the work stands now.`,
	];
	if (o.review) {
		parts.push("", "## Findings so far\nOne line each: `priority | location | one-line evidence`. Every finding, however many words that takes.");
	}
	if (o.previousSummary?.trim()) {
		parts.push("", "An earlier compaction wrote the summary in <previous-summary>. Carry its lessons forward unless they no longer hold.", "", `<previous-summary>\n${o.previousSummary.trim()}\n</previous-summary>`);
	}
	parts.push("", `<conversation>\n${o.conversation}\n</conversation>`);
	return parts.join("\n");
}
