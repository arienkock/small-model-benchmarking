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
 * does. The same answer plays for every model: the stub's request payload
 * does not reliably say which model asked, and the review harness runs each
 * model independently anyway.
 *
 * `correctness` is the odd one out: it plays lib/review.ts's wrap-up nudge and
 * continuation for real (unit-tested against a fake env in test/workflow-test.ts;
 * this is the one place they run against an actual session). Its first answer
 * is scripted slow (delayMs) so the harness's session time limit aborts it —
 * see review-e2e.ts's --config, which shortens stepTimeoutMin just for this
 * run. The wrap-up nudge and the continuation session's own first message are
 * matched on THEIR OWN TEXT, not on turn position: after an abort the aborted
 * turn never completes, so `messages.filter(assistant).length` does not
 * advance — replaying REVIEW_SEQ by turn index would just hit the same slow
 * entry again.
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
	// Slow on purpose: aborted at the (shortened) session time limit, so the
	// wrap-up nudge fires. See WRAP_UP_ANSWER/CONTINUATION_ANSWER below.
	correctness: [{ kind: "text", text: "Let me look at this in detail.", delayMs: 30_000 }],
};

/** What the wrap-up nudge ("you are out of turns…") gets, per variant. */
const WRAP_UP_ANSWER = {
	correctness: tool("submit_findings", {
		findings: [{ priority: "medium", title: "no input validation on POST", where: "app.py", detail: "the create endpoint does not validate the request body" }],
	}),
};

/** What a continuation session's own first turn gets, per variant. */
const CONTINUATION_ANSWER = {
	correctness: tool("submit_findings", {
		findings: [
			{ priority: "medium", title: "no input validation on POST", where: "app.py", detail: "the create endpoint does not validate the request body" },
			{ priority: "low", title: "no pagination on GET /books", where: "app.py", detail: "a large collection is returned unbounded" },
		],
	}),
};

export function respond(payload) {
	const messages = payload.messages ?? [];
	const first = messages.find((m) => m.role === "user");
	const text = textOf(first);
	if (!/^# Review\b/.test(text)) return undefined; // not a review session (the plugin's probes): default stub behaviour
	const variant = Object.keys(REVIEW_VARIANTS).find((v) => v !== "all" && text.includes(REVIEW_VARIANTS[v]));
	if (!variant) return { kind: "text", text: `review-script: no sequence for variant in: ${text.slice(0, 120)}` };

	// A continuation session (lib/review.ts buildContinuationPrompt): a fresh
	// session — its own turn 0 — answered straight away with the complete list.
	if (/^# Review \(continued\)/.test(text)) {
		return CONTINUATION_ANSWER[variant] ?? { kind: "text", text: `review-script: no continuation answer for ${variant}` };
	}

	// The wrap-up nudge (lib/review.ts WRAP_UP): same session as the slow first
	// turn, so it can arrive at any turn count once that turn is aborted.
	const last = messages[messages.length - 1];
	if (last?.role === "user" && /you are out of turns/i.test(textOf(last))) {
		return WRAP_UP_ANSWER[variant] ?? { kind: "text", text: `review-script: no wrap-up answer for ${variant}` };
	}

	const seq = REVIEW_SEQ[variant];
	if (!seq) return { kind: "text", text: `review-script: no sequence for variant in: ${text.slice(0, 120)}` };
	const turn = messages.filter((x) => x.role === "assistant").length;
	return seq[turn] ?? { kind: "text", text: "Nothing more to do." };
}
