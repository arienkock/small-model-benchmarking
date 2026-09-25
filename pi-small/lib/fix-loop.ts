// fix-loop.ts — take an existing workspace and fix it until only low-priority
// findings remain: probe → (review) → fix, round after round. Used by
// `/workflow run` when the run spec carries `fix` (workflow/run.ts --fix).
//
// Each round:
//   1. PROBE: the harness's own checks — the task's test suite and checks, plus
//      `config.fixChecks` (e.g. workflow/checks/http_fuzz.py). A failing suite,
//      and every FAIL block of a failing check, is a high-priority finding. Machine
//      findings are concrete and reproducible, so they go first: a round that has
//      any skips the review.
//   2. REVIEW: only when the probe is clean — one reviewer session
//      (review.ts reviewSession: wrap-up nudge and continuations included), told
//      that the machine checks already pass, so it looks for where the code
//      departs from the task. The 2026-09-25 review experiment is why: the fuzzer
//      found every crash in 6 s; reviewers were needed for spec-level defects.
//   3. Nothing high or medium left: "clean". Otherwise FIX: the top
//      `config.fixBatch` findings go to a coding session (step kind "fix",
//      report_done). The host re-runs the GATE — the suite (no fewer tests than at
//      the start) and the task's own checks, NOT fixChecks — in a fresh check. A
//      failed attempt is reverted to the round's start and the next fixer in the
//      rotation tries again, handed the same findings plus what went wrong, up to
//      `config.fixAttempts`; after that the loop stops "stuck", since the next
//      round would only select the same findings again.
//
// Whether a fix actually removed its findings is decided by the NEXT round's
// probe and review, not by the fixer. After `config.fixRounds` fixes, one last
// probe and review report where things ended up.

import { type Finding, listFindings, PRIORITIES, reviewSession, type ReviewResult } from "./review.ts";
import type { AgentRun, SessionLimits, StepDir, WorkflowEnv } from "./workflow-runner.ts";
import { type CheckReport, type CheckSpec, describeCheck, STEP_TOOL, type StepFile, type TaskProfile, type WorkflowConfig } from "./workflow.ts";

export interface FixLoopOpts {
	config: WorkflowConfig;
	task: string;
	profile: TaskProfile;
	/** Reviewer rotation: the next one after every review that did not submit. */
	reviewers: string[];
	/** Fixer rotation: the next one after every failed fix attempt. */
	fixers: string[];
	/** The review prompt (review.ts REVIEW_VARIANTS). Default "all": it found the most in the 2026-09-25 scoring. */
	variant?: string;
	/** Epoch ms. No session starts after it. */
	deadline?: number;
	now?: () => number;
}

export interface FixAttempt {
	step: string;
	model?: string;
	ok: boolean;
	/** Did the session call report_done (and get it accepted)? */
	reported: boolean;
	detail?: string;
	run: AgentRun;
}

export interface FixRound {
	round: number;
	/** The machine checks at the start of the round. */
	probe: CheckReport;
	machineFindings: Finding[];
	/** Absent when machine findings made the review unnecessary. */
	review?: ReviewResult;
	/** What this round handed to the fixer (empty on the last, assess-only round). */
	selected: Finding[];
	fixes: FixAttempt[];
}

export type FixLoopStatus = "clean" | "rounds_exhausted" | "stuck" | "no_review" | "stopped";

export interface FixLoopResult {
	status: FixLoopStatus;
	rounds: FixRound[];
	/** What the last assessment still found, all priorities. */
	remaining: Finding[];
}

const rank = (f: Finding) => PRIORITIES.indexOf(f.priority);

/**
 * A probe's report as findings: the suite (or the test files, or the count)
 * as one, and each failing check as one per "FAIL" block of its output — the
 * fuzzer prints one per crash site — or as one with its whole output.
 */
export function machineFindings(report: CheckReport, testCommand: string): Finding[] {
	if (report.ok) return [];
	const out: Finding[] = [];
	const t = report.tests;
	const suiteProblems = report.problems.filter((p) => !/^the ".*" check failed/.test(p));
	if (suiteProblems.length) {
		const failing = (t?.failures ?? []).map((f) => `${f.test}: ${f.error || "(no error line)"}`);
		out.push({
			priority: "high",
			title: suiteProblems[0].replace(/\.$/, ""),
			where: testCommand,
			detail: [...suiteProblems.slice(1), ...failing.slice(0, 8), ...(failing.length ? [] : t?.tail ? [t.tail.split("\n").slice(-12).join("\n")] : [])].join("\n"),
		});
	}
	for (const c of report.checks ?? []) {
		if (c.ok) continue;
		const lines = (c.tail ?? "").split("\n");
		const blocks: string[][] = [];
		for (const line of lines) {
			if (/^FAIL\b/.test(line)) blocks.push([line]);
			else if (blocks.length && /^\s/.test(line)) blocks[blocks.length - 1].push(line);
		}
		if (blocks.length) {
			for (const b of blocks) {
				const head = b[0].replace(/^FAIL\s+/, "");
				const at = head.match(/\bat (\S+:\d+)/);
				out.push({ priority: "high", title: head, where: at?.[1] ?? "", detail: `Found by the "${c.name}" check:\n${b.slice(1).map((l) => l.trim()).join("\n")}` });
			}
		} else {
			out.push({ priority: "high", title: `the "${c.name}" check fails`, where: "", detail: (c.tail ?? "").trim() });
		}
	}
	return out;
}

/** Most important first; high and medium only; at most `n`. Stable within a priority. */
export function selectFindings(findings: Finding[], n: number): Finding[] {
	return findings
		.map((f, i) => ({ f, i }))
		.filter(({ f }) => f.priority !== "low")
		.sort((a, b) => rank(a.f) - rank(b.f) || a.i - b.i)
		.slice(0, Math.max(1, n))
		.map(({ f }) => f);
}

export const REVIEW_NOTE =
	"The harness has already run the test suite and its own automated checks against this code (among them, crash-testing every endpoint with malformed input), and they pass. " +
	"Look for where the code does not do what the task says: missing behaviour, wrong status codes or results, rules of the task that are not enforced.";

export function buildFixPrompt(task: string, profile: TaskProfile, findings: Finding[], previous?: string): string {
	const out = [
		"# Fix",
		"",
		"The code in /workspace was written for the task below. The findings listed here are problems in it, found by the harness's own checks or by a review. Fix them.",
		"",
		"- First confirm each finding: reproduce it (a request, a short script, or a test). If it is not real, leave the code alone for that one.",
		"- For each one you fix, add a test that fails without the fix.",
		"- Keep every existing test passing, and do not delete tests.",
		"- When you are done, call `report_done`. It runs the test suite and the task's checks, and refuses while they fail.",
		"",
		"## Findings to fix",
		"",
		listFindings(findings),
		"",
	];
	if (previous) out.push("## An earlier attempt at these fixes failed", "", previous.trim(), "", "The workspace has been put back to how it was before that attempt.", "");
	if (profile.testCommand) out.push("## Running the tests", "", `\`${profile.testCommand}\``, "");
	if (profile.conventions) out.push("## Conventions", "", profile.conventions.trim(), "");
	out.push("## The task", "", task.trim(), "");
	return out.join("\n");
}

export async function runFixLoop(env: WorkflowEnv, opts: FixLoopOpts): Promise<FixLoopResult> {
	const cfg = opts.config;
	const now = opts.now ?? Date.now;
	const deadline = opts.deadline ?? Infinity;
	const variant = opts.variant ?? "all";
	const maxRounds = Math.max(0, cfg.fixRounds ?? 4);
	const batch = Math.max(1, cfg.fixBatch ?? 3);
	const maxAttempts = Math.max(1, cfg.fixAttempts ?? 2);
	const testCommand = opts.profile.testCommand ?? "";
	if (!testCommand) throw new Error("the fix loop needs the task's testCommand (task.json): it has no plan to take one from");
	if (!opts.reviewers.length || !opts.fixers.length) throw new Error("the fix loop needs at least one reviewer and one fixer");
	const sessionMs = () => Math.max(0, Math.min(cfg.stepTimeoutMin * 60_000, deadline - now()));

	let counter = 0;
	const nextIndex = () => ++counter;
	let reviewerIdx = 0;
	let fixerIdx = 0;
	const rounds: FixRound[] = [];
	const end = (status: FixLoopStatus, remaining: Finding[]): FixLoopResult => {
		env.event({ type: "fix_end", status, rounds: rounds.length, remaining: remaining.length });
		return { status, rounds, remaining };
	};

	const spec = (minTests: number, extra: boolean): CheckSpec => ({
		testCommand,
		testTimeoutSec: cfg.testTimeoutSec,
		testFiles: opts.profile.testFiles,
		testCountPattern: opts.profile.testCountPattern,
		failurePattern: opts.profile.failurePattern,
		minTests,
		minTestsWhy: "no fewer tests than when the fix loop started",
		checks: [...(opts.profile.checks ?? []), ...(extra ? (cfg.fixChecks ?? []) : [])],
	});

	env.snapshotWorkspace?.("fix-start");
	let minTests = 0;
	/** The latest assessment's findings, for a run that stops before its next one. */
	let latest: Finding[] = [];

	for (let round = 1; ; round++) {
		const assessOnly = round > maxRounds;
		if (now() >= deadline) return end("stopped", latest);
		env.snapshotWorkspace?.(`fix-round-${round}`, true);

		// 1. probe
		const probeDir = env.prepareStep(`${String(nextIndex()).padStart(2, "0")}-probe-r${round}`);
		const probeSpec = spec(minTests, true);
		env.writeStepFile(probeDir, "check.json", probeSpec);
		const probe = await env.runCheck(probeDir, probeSpec);
		// The first probe sets the bar: a fix may add tests, never remove them.
		if (round === 1 && probe.tests?.count) minTests = probe.tests.count;
		const machine = machineFindings(probe, testCommand);
		const r: FixRound = { round, probe, machineFindings: machine, selected: [], fixes: [] };
		rounds.push(r);
		env.event({ type: "fix_probe", round, ok: probe.ok, findings: machine.length, problems: probe.problems });

		// 2. review, when there is nothing concrete to fix first
		let findings = machine;
		if (!machine.length) {
			for (let tries = 0; tries < opts.reviewers.length && !r.review?.ok; tries++) {
				if (now() >= deadline) return end("stopped", latest);
				const model = opts.reviewers[reviewerIdx % opts.reviewers.length];
				r.review = await reviewSession(env, {
					config: cfg,
					task: opts.task,
					model,
					variant,
					label: `review-r${round}-${model}`,
					nextIndex,
					restoreKey: `fix-round-${round}`,
					note: REVIEW_NOTE,
					deadline,
					now,
				});
				if (!r.review.ok) reviewerIdx++;
			}
			// A reviewer may have written files despite being told not to.
			env.restoreWorkspace?.(`fix-round-${round}`);
			if (!r.review?.ok) return end("no_review", latest);
			findings = r.review.findings;
		}
		latest = findings;

		// 3. done, or fix
		const todo = selectFindings(findings, batch);
		if (!todo.length) return end("clean", findings);
		if (assessOnly) return end("rounds_exhausted", findings);
		r.selected = todo;
		env.event({ type: "fix_selected", round, findings: todo.map((f) => `[${f.priority}] ${f.title}`), of: findings.length, source: machine.length ? "probe" : "review" });

		const gate = spec(minTests, false);
		let previous: string | undefined;
		let fixed = false;
		for (let attempt = 1; attempt <= maxAttempts && !fixed; attempt++) {
			if (now() >= deadline) return end("stopped", findings);
			if (attempt > 1) env.restoreWorkspace?.(`fix-round-${round}`);
			const model = opts.fixers[fixerIdx % opts.fixers.length];
			const dir: StepDir = env.prepareStep(`${String(nextIndex()).padStart(2, "0")}-fix-r${round}-a${attempt}`);
			const stepFile: StepFile = {
				kind: "fix",
				tool: STEP_TOOL.fix,
				toolset: "coding",
				toolKinds: cfg.codingTools,
				out: dir.out,
				config: cfg,
				systemPrompt: cfg.systemPrompt?.trim() || undefined,
				check: gate,
				checkScript: env.checkScript,
				checkSpecPath: dir.checkSpecPath,
			};
			env.writeStepFile(dir, "step.json", stepFile);
			env.writeStepFile(dir, "check.json", gate);
			const prompt = buildFixPrompt(opts.task, opts.profile, todo, previous);
			env.event({ type: "fix_start", step: dir.name, round, attempt, model, findings: todo.length, promptChars: prompt.length });
			const limits: SessionLimits = { timeoutMs: sessionMs(), maxTurns: cfg.maxTurns, model };
			const run = await env.runAgent(dir, prompt, limits);
			// The host's own check decides; report_done only says the model thinks it is finished.
			const check = await env.runCheck(dir, gate);
			const out = env.readOut(dir);
			const reported = !!out?.accepted;
			const timeout = run.turnLimited ? ` The session was stopped at the ${cfg.maxTurns}-turn limit.` : run.timedOut ? " The session was stopped at the time limit." : "";
			const detail = check.ok ? undefined : describeCheck(check, cfg.feedback) + timeout;
			r.fixes.push({ step: dir.name, model, ok: check.ok, reported, detail, run });
			env.event({ type: "fix_run", step: dir.name, round, attempt, model, ...run, ok: check.ok, reported, detail });
			if (check.ok) fixed = true;
			else {
				fixerIdx++;
				previous = detail;
			}
		}
		if (!fixed) {
			env.restoreWorkspace?.(`fix-round-${round}`);
			return end("stuck", findings);
		}
	}
}

/** For logs: "high 2, medium 1, low 0". */
export function countByPriority(findings: Finding[]): string {
	return PRIORITIES.map((p) => `${p} ${findings.filter((f) => f.priority === p).length}`).join(", ");
}
