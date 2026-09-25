/**
 * review-script.mjs — plays the model for the review-only end-to-end test
 * (test/review-e2e.ts), loaded by stub-server.mjs via PI_SMALL_STUB_SCRIPT.
 *
 * Unlike test/fixtures/workflow-script.mjs there is no step kind or task id in
 * the header to key off — every review session's first user message starts
 * with the same "# Review" header (lib/review.ts buildReviewPrompt); the
 * variant is identified by which of REVIEW_VARIANTS' own lines the prompt
 * contains. Each variant gets ONE scripted call to submit_findings, on the
 * first turn — a review session never batches or retries the way scenarios
 * does, so there is nothing else to script here. The same answer plays for
 * every model: the stub's request payload does not reliably say which model
 * asked, and the review harness runs each model independently anyway.
 */
import { REVIEW_VARIANTS } from "../../lib/review.ts";

const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content ?? []).map((p) => p.text ?? "").join(""));
const tool = (name, args) => ({ kind: "tool", name, args });

const REVIEW_SEQ = {
	completeness: [
		tool("submit_findings", {
			findings: [{ priority: "high", title: "no DELETE endpoint", where: "app.py", detail: "the task asks for DELETE /books/{id}; app.py has no DELETE route" }],
		}),
	],
	// Exercises the "found nothing" path for real, not just in the unit tests.
	fidelity: [tool("submit_findings", { findings: [] })],
};

export function respond(payload) {
	const messages = payload.messages ?? [];
	const first = messages.find((m) => m.role === "user");
	const text = textOf(first);
	if (!/^# Review\b/.test(text)) return undefined; // not a review session (the plugin's probes): default stub behaviour
	const variant = Object.keys(REVIEW_VARIANTS).find((v) => v !== "all" && text.includes(REVIEW_VARIANTS[v]));
	const seq = variant && REVIEW_SEQ[variant];
	if (!seq) return { kind: "text", text: `review-script: no sequence for variant in: ${text.slice(0, 120)}` };
	const turn = messages.filter((x) => x.role === "assistant").length;
	return seq[turn] ?? { kind: "text", text: "Nothing more to do." };
}
