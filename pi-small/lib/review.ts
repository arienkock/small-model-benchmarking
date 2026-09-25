// review.ts — review-only sessions: a model reviews /workspace against the task
// and submits prioritised findings. No fixing. Used by `/workflow review`.
//
// Deliberately NOT the staged (scenarios → breakdown → … → integrate) workflow
// in workflow.ts / workflow-runner.ts: there is no state to accumulate and no
// pass/fail check to retry against, just N independent sessions (one per
// model × variant × repeat), each given the same starting workspace and asked
// to review it. It reuses that machinery's building blocks — a StepFile on
// disk, a WorkflowEnv, the plugin's one submit tool per step (see "review" in
// workflow-tool.ts) — rather than duplicating them.

import type { AgentRun, SessionLimits, StepDir, WorkflowEnv, WrapUp } from "./workflow-runner.ts";
import { type Result, type StepFile, unwrapArgs, type WorkflowConfig } from "./workflow.ts";

export const REVIEW_VARIANTS: Record<string, string> = {
	completeness: "Review the code for completeness: is everything the task asks for there?",
	correctness: "Review the code for correctness: does it work, and is it free of bugs?",
	fidelity: "Review the code for fidelity against the task: does what it does match what the task says, exactly?",
	all: [
		"Review the code for completeness: is everything the task asks for there?",
		"Review the code for correctness: does it work, and is it free of bugs?",
		"Review the code for fidelity against the task: does what it does match what the task says, exactly?",
	].join("\n"),
};

export const PRIORITIES = ["high", "medium", "low"] as const;

export interface Finding {
	priority: (typeof PRIORITIES)[number];
	title: string;
	where: string;
	detail: string;
}

/** A long tail past this is noise, not signal — the model should have prioritised instead. */
const MAX_FINDINGS = 20;

/** `note`: extra context from the caller (the fix loop says what its own checks already cover). */
export function buildReviewPrompt(task: string, variant: string, note?: string): string {
	return [
		"# Review",
		"",
		"The code in /workspace was written for the task below. Do not change any files.",
		"",
		REVIEW_VARIANTS[variant],
		"",
		...(note ? [note.trim(), ""] : []),
		"Prioritize your findings: high (the task is not met, or it is a bug), medium, low.",
		"Report all of them in one call to the tool `submit_findings`, most important first. If you find nothing, submit an empty list.",
		"",
		"## The task",
		"",
		task.trim(),
		"",
	].join("\n");
}

/**
 * A previous session on the same model and prompt was wrapped up (nudged at
 * its limit — see `runOneSession`) and submitted findings. This prompt hands
 * them back and asks for the complete list, so a session that ran out of
 * turns partway through does not lose what it already found.
 */
export function buildContinuationPrompt(task: string, variant: string, findingsSoFar: Finding[], note?: string): string {
	const listed = findingsSoFar.length ? listFindings(findingsSoFar) : "(none yet)";
	return [
		"# Review (continued)",
		"",
		"The code in /workspace was written for the task below. Do not change any files.",
		"",
		REVIEW_VARIANTS[variant],
		"",
		...(note ? [note.trim(), ""] : []),
		"A previous session ran out of turns before it finished this review. Below is what it found so far. Continue the review, then report all of it in one call to the tool `submit_findings` — most important first, and including whatever below still holds.",
		"",
		"## Findings so far",
		"",
		listed,
		"",
		"## The task",
		"",
		task.trim(),
		"",
	].join("\n");
}

/** Findings as a markdown list, one per line — how every prompt shows them to a model. */
export function listFindings(findings: Finding[]): string {
	return findings.map((f) => `- [${f.priority}] ${f.title}${f.where ? ` (${f.where})` : ""}${f.detail ? `: ${f.detail.replace(/\n/g, "\n  ")}` : ""}`).join("\n");
}

/** Sent in the same session when it hits its limit or never calls `submit_findings` at all. */
const WRAP_UP: WrapUp = {
	message: "You are out of turns. Call `submit_findings` now with what you have found so far.",
	maxExtraTurns: 2,
	extraTimeoutMs: 3 * 60_000,
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Findings a review session submits. `{findings: [...]}`, tolerant of a
 * stringified list or a bare array the way the staged workflow's own
 * validators are (unwrapArgs). An empty list is a valid submission — nothing
 * found is a real answer, not a missing one.
 */
export function validateFindings(args: any): Result<Finding[]> {
	const a = unwrapArgs(args, "findings");
	const raw = a?.findings;
	if (!Array.isArray(raw)) return { ok: false, errors: ["`findings` must be a list of finding objects — an empty list if you found nothing."] };
	if (raw.length > MAX_FINDINGS) return { ok: false, errors: [`at most ${MAX_FINDINGS} findings, got ${raw.length} — keep the most important ones.`] };
	const errors: string[] = [];
	const out: Finding[] = [];
	raw.forEach((item: any, i) => {
		const n = i + 1;
		if (!item || typeof item !== "object") {
			errors.push(`finding ${n}: must be an object with priority, title, where, detail.`);
			return;
		}
		const priority = str(item.priority).toLowerCase();
		const title = str(item.title);
		if (!(PRIORITIES as readonly string[]).includes(priority)) errors.push(`finding ${n}: "priority" must be high, medium or low (got ${JSON.stringify(item.priority ?? null)}).`);
		if (!title) errors.push(`finding ${n}: "title" is required.`);
		if ((PRIORITIES as readonly string[]).includes(priority) && title) {
			out.push({ priority: priority as (typeof PRIORITIES)[number], title, where: str(item.where), detail: str(item.detail) });
		}
	});
	return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

// -------------------------------------------------------------- running --

export interface ReviewOpts {
	config: WorkflowConfig;
	task: string;
	variants: string[];
	models: string[];
	/** Independent sessions per (model, variant); default 1. */
	repeats?: number;
	/** Epoch ms. No session starts after it. */
	deadline?: number;
	now?: () => number;
}

/** One review session's outcome. */
export interface ReviewResult {
	model: string;
	variant: string;
	repeat: number;
	step: string;
	ok: boolean;
	findings: Finding[];
	/** Why the session did not produce an accepted submission, when `ok` is false. */
	detail?: string;
	run: AgentRun;
}

interface SessionOutcome {
	run: AgentRun;
	ok: boolean;
	findings: Finding[];
	detail?: string;
}

function reviewStepFile(cfg: WorkflowConfig, out: string): StepFile {
	return {
		kind: "review",
		tool: "submit_findings",
		// Same significance as everywhere else in the staged workflow — see
		// STEP_TOOLSET — but nothing here actually reads it back; the plugin
		// (extensions/small.ts) builds the session's tool set from toolKinds
		// alone, whatever toolset says.
		toolset: "planning",
		toolKinds: cfg.reviewTools ?? ["bash", "read"],
		out,
		config: cfg,
		systemPrompt: cfg.systemPrompt?.trim() || undefined,
	};
}

/**
 * One review session, with the wrap-up nudge (see `WrapUp`/`workflow-runner.ts`)
 * on by default: a session that hits `limits` or never calls `submit_findings`
 * gets one more message in the SAME session asking for whatever it has so far.
 * The submission — from the first pass or the nudge — is re-validated here,
 * the same way the staged workflow's runner re-validates every submission;
 * never trust the session.
 */
async function runOneSession(env: WorkflowEnv, dir: StepDir, prompt: string, limits: SessionLimits, cfg: WorkflowConfig): Promise<SessionOutcome> {
	const run = await env.runAgent(dir, prompt, limits, WRAP_UP);
	const out = env.readOut(dir);
	if (!out) {
		const timeout = run.turnLimited ? ` The session was stopped at the ${cfg.maxTurns}-turn limit.` : run.timedOut ? " The session was stopped at the time limit." : "";
		return { run, ok: false, findings: [], detail: `The session ended without a successful call to \`submit_findings\`.${timeout}` };
	}
	const v = validateFindings(out.args);
	if (v.ok) return { run, ok: true, findings: v.value };
	return { run, ok: false, findings: [], detail: `The submission to \`submit_findings\` was not valid:\n- ${v.errors.join("\n- ")}` };
}

/**
 * Run every (model, variant, repeat) combination, each a fresh session
 * against the SAME starting workspace: snapshotted once up front, then
 * restored before every session, so one reviewer's edits — the default tool
 * set (`bash`, `read`) can run the tests and the app, and bash could write —
 * never leak into the next one; the prompt tells the model not to change
 * anything, but the restore is what actually guarantees it. Order is model
 * (outer) then variant then repeat, so a deadline cutoff drops the tail of
 * one model's variants rather than one variant across every model.
 *
 * A session that only submitted because of the wrap-up nudge (`run.wrappedUp`)
 * likely ran out of turns before finishing: up to `config.reviewContinuations`
 * (default 1) fresh sessions follow, same model and prompt, each handed the
 * findings so far and asked to finish the review. The final result is the
 * last VALID submission — an invalid or empty-handed continuation does not
 * erase what an earlier session already found.
 */
/** Where a review session runs from and how its steps are named. */
export interface ReviewSessionOpts {
	config: WorkflowConfig;
	task: string;
	model: string;
	variant: string;
	repeat?: number;
	/** Step label, e.g. "review-all-Granite"; numbered by `nextIndex`. */
	label: string;
	/** Numbers the next step directory (shared with the caller's own steps). */
	nextIndex: () => number;
	/** Restored before every session (the initial one and each continuation), so no reviewer's edits survive it. */
	restoreKey?: string;
	/** See buildReviewPrompt. */
	note?: string;
	deadline: number;
	now: () => number;
}

/**
 * One review — a session, and when that session only submitted because of
 * the wrap-up nudge (`run.wrappedUp`), up to `config.reviewContinuations`
 * (default 1) continuation sessions. A wrapped-up session likely ran out of
 * turns before finishing, so each continuation is a fresh session on the same
 * model and prompt, handed the findings so far and asked to finish. The
 * result is the last VALID submission — an invalid or empty-handed
 * continuation does not erase what an earlier session already found.
 */
export async function reviewSession(env: WorkflowEnv, o: ReviewSessionOpts): Promise<ReviewResult> {
	const cfg = o.config;
	const repeat = o.repeat ?? 1;
	const sessionMs = () => Math.max(0, Math.min(cfg.stepTimeoutMin * 60_000, o.deadline - o.now()));
	const maxContinuations = Math.max(0, cfg.reviewContinuations ?? 1);
	const { model, variant } = o;

	if (o.restoreKey) env.restoreWorkspace?.(o.restoreKey);
	const dir: StepDir = env.prepareStep(`${String(o.nextIndex()).padStart(2, "0")}-${o.label}`);
	env.writeStepFile(dir, "step.json", reviewStepFile(cfg, dir.out));

	const prompt = buildReviewPrompt(o.task, variant, o.note);
	env.event({ type: "review_start", step: dir.name, model, variant, repeat, promptChars: prompt.length });
	const limits: SessionLimits = { timeoutMs: sessionMs(), maxTurns: cfg.maxTurns, model };
	let current = await runOneSession(env, dir, prompt, limits, cfg);
	let step = dir.name;
	env.event({ type: "review_run", step, model, variant, repeat, phase: "initial", ...current.run, ok: current.ok, findingCount: current.findings.length, detail: current.detail });

	// The nudge got a submission out of it — it almost certainly ran out of
	// turns first. `config.reviewContinuations` fresh sessions follow, each
	// picking up from the last VALID findings; an invalid or empty-handed
	// continuation along the way is logged but does not stop the rest —
	// only the last valid submission is kept.
	if (current.run.wrappedUp && current.ok) {
		for (let c = 1; c <= maxContinuations && o.now() < o.deadline; c++) {
			if (o.restoreKey) env.restoreWorkspace?.(o.restoreKey);
			const contDir: StepDir = env.prepareStep(`${String(o.nextIndex()).padStart(2, "0")}-${o.label}-continue${c}`);
			env.writeStepFile(contDir, "step.json", reviewStepFile(cfg, contDir.out));

			const contPrompt = buildContinuationPrompt(o.task, variant, current.findings, o.note);
			env.event({ type: "review_start", step: contDir.name, model, variant, repeat, continuation: c, promptChars: contPrompt.length });
			const contLimits: SessionLimits = { timeoutMs: sessionMs(), maxTurns: cfg.maxTurns, model };
			const next = await runOneSession(env, contDir, contPrompt, contLimits, cfg);
			env.event({ type: "review_run", step: contDir.name, model, variant, repeat, phase: "continuation", continuation: c, ...next.run, ok: next.ok, findingCount: next.findings.length, detail: next.detail });
			if (next.ok) {
				current = next;
				step = contDir.name;
			}
		}
	}
	return { model, variant, repeat, step, ok: current.ok, findings: current.findings, detail: current.detail, run: current.run };
}

/**
 * Run every (model, variant, repeat) combination — each one `reviewSession`,
 * so with its continuations — against the SAME starting workspace:
 * snapshotted once up front, then restored before every session, so one
 * reviewer's edits — the default tool set (`bash`, `read`) can run the tests
 * and the app, and bash could write — never leak into the next one; the
 * prompt tells the model not to change anything, but the restore is what
 * actually guarantees it. Order is model (outer) then variant then repeat, so
 * a deadline cutoff drops the tail of one model's variants rather than one
 * variant across every model.
 */
export async function runReviews(env: WorkflowEnv, opts: ReviewOpts): Promise<ReviewResult[]> {
	const now = opts.now ?? Date.now;
	const deadline = opts.deadline ?? Infinity;
	const repeats = Math.max(1, opts.repeats ?? 1);

	env.snapshotWorkspace?.("review-start");
	const results: ReviewResult[] = [];
	let counter = 0;
	const nextIndex = () => ++counter;

	for (const model of opts.models) {
		for (const variant of opts.variants) {
			for (let repeat = 1; repeat <= repeats; repeat++) {
				const label = `review-${variant}-${model}`;
				if (now() >= deadline) {
					env.event({ type: "review_stopped", where: `before ${label} repeat ${repeat}` });
					return results;
				}
				results.push(
					await reviewSession(env, { config: opts.config, task: opts.task, model, variant, repeat, label, nextIndex, restoreKey: "review-start", deadline, now }),
				);
			}
		}
	}
	return results;
}
