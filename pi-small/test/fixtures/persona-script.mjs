/**
 * persona-script.mjs — plays the model for test/persona-e2e.ts, loaded by
 * stub-server.mjs via PI_SMALL_STUB_SCRIPT. Returning nothing falls through to
 * the stub's own behaviour (the probes, and a plain echo reply).
 *
 *   last message is a weather tool result  -> the answer, as a follow-up
 *   "...weather..."                         -> says it is looking, and calls weather
 *   "...quietly..."                         -> calls weather without a word first
 *   "...list..."                            -> a markdown list (the server must strip it)
 *   the memory instruction                  -> three tiers, slowly (PERSONA_TEST_COMPACT_DELAY_MS)
 */

const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content ?? []).map((p) => p.text ?? "").join(""));

export function respond(payload) {
	const messages = payload.messages ?? [];
	const last = messages[messages.length - 1];
	if (last?.role === "tool") {
		const out = textOf(last);
		const tomorrow = /Tomorrow \([^)]*\): ([^,]+)/.exec(out)?.[1] ?? "unknown";
		return { kind: "text", text: `Tomorrow looks like ${tomorrow}.` };
	}
	const said = textOf([...messages].reverse().find((m) => m.role === "user"));
	if (/Write your memory/.test(said)) {
		return {
			kind: "text",
			delayMs: Number(process.env.PERSONA_TEST_COMPACT_DELAY_MS ?? 0),
			text: "## Permanent\nSomeone here asked about the weather.\n\n## Ongoing\nNothing planned yet.\n\n## Recent\nTalked about the weather.",
		};
	}
	if (/quietly/i.test(said)) return { kind: "tool", name: "weather", args: {} };
	if (/weather/i.test(said)) return { kind: "tool", name: "weather", args: {}, text: "Let me check." };
	if (/list/i.test(said)) return { kind: "text", text: "**Three** things:\n- one\n- two\n- three" };
	return undefined;
}
