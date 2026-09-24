/**
 * workflow-runner.ts — the loop that walks a task through the staged workflow.
 *
 * Everything with a side effect (running pi in a container, running the checks,
 * writing files) goes through `WorkflowEnv`, so the control flow — attempts,
 * feedback, the deadline, when to stop — is tested with fakes (test/workflow-test.ts)
 * and driven for real by ../workflow/run.ts.
 *
 * Per step:
 *   1. a fresh session gets the step prompt (spec rendered from the state);
 *   2. the session ends; the host judges it itself — a planning step by
 *      re-validating the submission, a coding step by re-running check.py in a
 *      fresh container;
 *   3. not good enough: another FRESH session with the failure as feedback, up
 *      to `config.attempts.<kind>` times; then the workflow stops.
 *
 * Every retry starts from an empty context. Continuing the failed session
 * ("nudging") was tried first and dropped: in the 2026-09-24 roster runs long
 * sessions did not recover, while Granite fixed in 3 minutes, on a fresh
 * attempt given the failure, what two 40-minute sessions had not.
 */

import {
	applySubmission,
	buildPrompt,
	type CheckReport,
	type CheckSpec,
	checkSpecFor,
	describeCheck,
	finalCheckSpec,
	initialState,
	nextStep,
	type NextStep,
	STEP_TOOL,
	STEP_TOOLSET,
	type StepFile,
	type TaskProfile,
	taskFinished,
	validateSubmission,
	type WorkflowConfig,
	type WorkflowState,
} from "./workflow.ts";

export interface StepDir {
	/** Unique label, e.g. "03-task_plan-T1-a1". */
	name: string;
	/** Paths as the container sees them. */
	out: string;
	checkSpecPath: string;
}

export interface AgentRun {
	exitCode: number | null;
	timedOut: boolean;
	durationMs: number;
	/** The session was aborted at `config.maxTurns`. */
	turnLimited?: boolean;
	turns?: number;
}

/** What one session may use: its time, its turns, and (with a rotation) which model serves it. */
export interface SessionLimits {
	timeoutMs: number;
	maxTurns: number;
	model?: string;
}

export interface WorkflowEnv {
	/** Create the directory for one attempt of one step. */
	prepareStep(label: string): StepDir;
	/** Write a JSON file into the step directory (step.json, check.json). */
	writeStepFile(dir: StepDir, name: string, data: unknown): void;
	/** Run one fresh session with this prompt, within `limits` (and on `limits.model`, when set). */
	runAgent(dir: StepDir, prompt: string, limits: SessionLimits): Promise<AgentRun>;
	/** The submit tool's out file, parsed, or null. */
	readOut(dir: StepDir): any | null;
	/** Run check.py against the workspace in a fresh container. */
	runCheck(dir: StepDir, spec: CheckSpec): Promise<CheckReport>;
	saveState(state: WorkflowState): void;
	event(e: Record<string, unknown>): void;
	/** Container paths the step file needs. */
	checkScript: string;
}

export interface RunOptions {
	config: WorkflowConfig;
	task: string;
	/** What the task says about testing, layout and extra checks (its task.json). */
	profile?: TaskProfile;
	preexistingCode: boolean;
	/** Resume from this state instead of starting over. */
	state?: WorkflowState;
	/** Epoch ms. No step starts after it and a running session is cut off at it; the run ends "stopped". */
	deadline?: number;
	/**
	 * Model rotation: every session runs on the current model, and every FAILED
	 * session moves the rotation to the next one (wrapping around). Unset: one
	 * model, whatever the host serves.
	 */
	models?: string[];
	/** For tests. */
	now?: () => number;
}

interface Judgement {
	ok: boolean;
	value?: any;
	/** What went wrong, phrased for the model. */
	detail?: string;
	check?: CheckReport;
}

const stepLabel = (s: NextStep) => `${s.kind}${s.taskId ? `-${s.taskId}` : ""}`;

export async function runWorkflow(env: WorkflowEnv, opts: RunOptions): Promise<WorkflowState> {
	const cfg = opts.config;
	const now = opts.now ?? Date.now;
	const deadline = opts.deadline ?? Infinity;
	/** A session's limit: the step limit, or what is left of the run's budget. */
	const sessionMs = () => Math.max(0, Math.min(cfg.stepTimeoutMin * 60_000, deadline - now()));
	const stopped = (s: WorkflowState, where: string): WorkflowState => {
		const out = structuredClone(s);
		out.status = "stopped";
		out.failure = `time budget ran out ${where}`;
		env.event({ type: "workflow_stopped", where });
		env.saveState(out);
		return out;
	};
	let state = opts.state ?? initialState(opts.task, opts.preexistingCode, opts.profile);
	env.saveState(state);
	let counter = 0;
	const models = opts.models?.length ? opts.models : undefined;
	let modelIdx = 0;

	for (let step = nextStep(state); step; step = nextStep(state)) {
		const toolset = STEP_TOOLSET[step.kind];
		const maxAttempts = toolset === "planning" ? cfg.attempts.planning : cfg.attempts[step.kind as "implement" | "integrate"];
		const checkSpec: CheckSpec | undefined = toolset === "coding" ? checkSpecFor(state, step.kind as "implement" | "integrate", step.taskId!, cfg) : undefined;
		let feedback: string | undefined;
		let accepted: Judgement | undefined;

		for (let attempt = 1; attempt <= maxAttempts && !accepted; attempt++) {
			if (now() >= deadline) return stopped(state, `before ${stepLabel(step)} attempt ${attempt}`);
			counter++;
			const dir = env.prepareStep(`${String(counter).padStart(2, "0")}-${stepLabel(step)}-a${attempt}`);
			const stepFile: StepFile = {
				kind: step.kind,
				taskId: step.taskId,
				tool: STEP_TOOL[step.kind],
				toolset,
				toolKinds: toolset === "planning" ? (state.preexistingCode ? ["read", "ls"] : []) : undefined,
				out: dir.out,
				config: cfg,
				systemPrompt: cfg.systemPrompt?.trim() || undefined,
				scenarioIds: step.kind === "breakdown" ? state.scenarios.map((s) => s.id) : undefined,
				needsTestCommand: step.kind === "breakdown" && !state.testCommand ? true : undefined,
				check: checkSpec,
				checkScript: checkSpec ? env.checkScript : undefined,
				checkSpecPath: checkSpec ? dir.checkSpecPath : undefined,
			};
			env.writeStepFile(dir, "step.json", stepFile);
			if (checkSpec) env.writeStepFile(dir, "check.json", checkSpec);

			const prompt = buildPrompt(state, step, cfg, feedback);
			const model = models?.[modelIdx % models.length];
			env.event({ type: "step_start", step: dir.name, kind: step.kind, taskId: step.taskId, attempt, model, promptChars: prompt.length });
			const run = await env.runAgent(dir, prompt, { timeoutMs: sessionMs(), maxTurns: cfg.maxTurns, model });
			const judged = await judge(env, dir, step, stepFile, checkSpec, run, cfg);
			env.event({ type: "step_run", step: dir.name, model, ...run, ok: judged.ok, detail: judged.ok ? undefined : judged.detail });
			// A failed session hands the next attempt to the next model in the rotation.
			if (!judged.ok && models) modelIdx++;

			if (judged.ok) accepted = judged;
			else if (now() >= deadline) return stopped(state, `during ${stepLabel(step)} attempt ${attempt}`);
			else {
				feedback =
					(judged.detail ?? "The step did not produce an accepted result.") +
					(toolset === "coding" ? "\n\nThe files from that attempt are still in /workspace; continue from them or replace them." : "");
			}
		}

		if (!accepted) {
			state = structuredClone(state);
			state.status = "failed";
			state.failure = `${stepLabel(step)} not accepted after ${maxAttempts} attempt(s): ${feedback ?? "no detail"}`;
			const t = step.taskId ? state.tasks.find((x) => x.id === step.taskId) : undefined;
			if (t) t.status = "failed";
			env.event({ type: "workflow_failed", step: stepLabel(step), failure: state.failure });
			env.saveState(state);
			return state;
		}
		state = applySubmission(state, step.kind, step.taskId, accepted.value);
		env.event({ type: "step_accepted", step: stepLabel(step) });
		env.saveState(state);
	}

	// Every task finished: one last run of the whole suite against every scenario.
	if (state.status === "running" && state.tasks.length > 0 && state.tasks.every((t) => taskFinished(state, t))) {
		const dir = env.prepareStep(`${String(counter + 1).padStart(2, "0")}-final-check`);
		const spec = finalCheckSpec(state, cfg);
		env.writeStepFile(dir, "check.json", spec);
		const report = await env.runCheck(dir, spec);
		state = structuredClone(state);
		state.status = report.ok ? "completed" : "failed";
		if (!report.ok) state.failure = `final check: ${report.problems.join("; ")}`;
		env.event({ type: "final_check", ok: report.ok, problems: report.problems, tests: report.tests });
		env.saveState(state);
	}
	return state;
}

async function judge(
	env: WorkflowEnv,
	dir: StepDir,
	step: NextStep,
	stepFile: StepFile,
	checkSpec: CheckSpec | undefined,
	run: AgentRun,
	cfg: WorkflowConfig,
): Promise<Judgement> {
	const tool = STEP_TOOL[step.kind];
	const out = env.readOut(dir);
	const timeout = run.turnLimited
		? ` The session was stopped at the ${cfg.maxTurns}-turn limit.`
		: run.timedOut
			? " The session was stopped at the time limit."
			: "";

	if (!checkSpec) {
		// Planning: the submission is the product. Re-validated here, whatever the tool said.
		if (!out) return { ok: false, detail: `The session ended without a successful call to \`${tool}\`.${timeout}` };
		const v = validateSubmission(stepFile, out.args);
		if (!v.ok) return { ok: false, detail: `The submission to \`${tool}\` was not valid:\n- ${v.errors.join("\n- ")}` };
		return { ok: true, value: v.value };
	}

	// Coding: the workspace is the product. The harness's own check decides, in a
	// fresh container; report_done only says the model thinks it is finished.
	const check = await env.runCheck(dir, checkSpec);
	if (check.ok) return { ok: true, value: { summary: out?.value?.summary ?? out?.args?.summary ?? null, reported: !!out }, check };
	return { ok: false, detail: describeCheck(check) + timeout, check };
}
