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

import type { AgentRun, SessionLimits, StepDir, WorkflowEnv } from "./workflow-runner.ts";
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

export function buildReviewPrompt(task: string, variant: string): string {
	return [
		"# Review",
		"",
		"The code in /workspace was written for the task below. Do not change any files.",
		"",
		REVIEW_VARIANTS[variant],
		"",
		"Prioritize your findings: high (the task is not met, or it is a bug), medium, low.",
		"Report all of them in one call to the tool `submit_findings`, most important first. If you find nothing, submit an empty list.",
		"",
		"## The task",
		"",
		task.trim(),
		"",
	].join("\n");
}

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

/**
 * Run every (model, variant, repeat) combination, each a fresh session
 * against the SAME starting workspace: snapshotted once up front, then
 * restored before every session, so one reviewer's edits — the default tool
 * set (`bash`, `read`) can run the tests and the app, and bash could write —
 * never leak into the next one; the prompt tells the model not to change
 * anything, but the restore is what actually guarantees it. Order is model
 * (outer) then variant then repeat, so a deadline cutoff drops the tail of
 * one model's variants rather than one variant across every model.
 */
export async function runReviews(env: WorkflowEnv, opts: ReviewOpts): Promise<ReviewResult[]> {
	const cfg = opts.config;
	const now = opts.now ?? Date.now;
	const deadline = opts.deadline ?? Infinity;
	const repeats = Math.max(1, opts.repeats ?? 1);
	const sessionMs = () => Math.max(0, Math.min(cfg.stepTimeoutMin * 60_000, deadline - now()));

	env.snapshotWorkspace?.("review-start");
	const results: ReviewResult[] = [];
	let counter = 0;

	for (const model of opts.models) {
		for (const variant of opts.variants) {
			for (let repeat = 1; repeat <= repeats; repeat++) {
				const label = `review-${variant}-${model}`;
				if (now() >= deadline) {
					env.event({ type: "review_stopped", where: `before ${label} repeat ${repeat}` });
					return results;
				}
				env.restoreWorkspace?.("review-start");
				counter++;
				const dir: StepDir = env.prepareStep(`${String(counter).padStart(2, "0")}-${label}`);
				const stepFile: StepFile = {
					kind: "review",
					tool: "submit_findings",
					// Same significance as everywhere else in the staged workflow — see
					// STEP_TOOLSET — but nothing here actually reads it back; the plugin
					// (extensions/small.ts) builds the session's tool set from toolKinds
					// alone, whatever toolset says.
					toolset: "planning",
					toolKinds: cfg.reviewTools ?? ["bash", "read"],
					out: dir.out,
					config: cfg,
					systemPrompt: cfg.systemPrompt?.trim() || undefined,
				};
				env.writeStepFile(dir, "step.json", stepFile);

				const prompt = buildReviewPrompt(opts.task, variant);
				env.event({ type: "review_start", step: dir.name, model, variant, repeat, promptChars: prompt.length });
				const limits: SessionLimits = { timeoutMs: sessionMs(), maxTurns: cfg.maxTurns, model };
				const run = await env.runAgent(dir, prompt, limits);
				const out = env.readOut(dir);

				let ok = false;
				let findings: Finding[] = [];
				let detail: string | undefined;
				if (!out) {
					const timeout = run.turnLimited ? ` The session was stopped at the ${cfg.maxTurns}-turn limit.` : run.timedOut ? " The session was stopped at the time limit." : "";
					detail = `The session ended without a successful call to \`submit_findings\`.${timeout}`;
				} else {
					// Never trust the session: re-validate whatever the tool wrote, the
					// same way the staged workflow's runner re-validates every submission.
					const v = validateFindings(out.args);
					if (v.ok) {
						ok = true;
						findings = v.value;
					} else {
						detail = `The submission to \`submit_findings\` was not valid:\n- ${v.errors.join("\n- ")}`;
					}
				}
				env.event({ type: "review_run", step: dir.name, model, variant, repeat, ...run, ok, findingCount: findings.length, detail });
				results.push({ model, variant, repeat, step: dir.name, ok, findings, detail, run });
			}
		}
	}
	return results;
}
