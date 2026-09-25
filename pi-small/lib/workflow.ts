/**
 * workflow.ts — the deterministic half of the staged workflow: what each step
 * asks for, what counts as a valid answer, and how the answers accumulate into
 * the spec the next step is given. No dependency on pi, docker or the network,
 * so the host orchestrator (../workflow/run.ts) and the in-container submit
 * tool (./workflow-tool.ts) share exactly one definition of "valid".
 *
 * The workflow, one fresh pi session per step:
 *
 *   scenarios        whole-task verification scenarios, happy and unhappy
 *   breakdown        ordered implementation tasks, each covering scenarios
 *   task_plan  (Tk)  per task: its own scenarios plus implementation logic
 *   implement  (Tk)  code + a unit test per scenario, verified by the harness
 *   integrate  (Tk)  when earlier work exists: integration tests, verified
 *
 * Every model answer goes through a submit tool whose arguments are validated
 * here; a rejected submission comes back to the model as a tool error listing
 * what to fix. Implementation steps end with report_done, which the tool only
 * accepts after the harness's own checks pass (../workflow/check.py).
 */

// ------------------------------------------------------------------ types --

export type ScenarioKind = "happy" | "unhappy";

export interface Scenario {
	/** "S3" for a whole-task scenario, "T2.S1" for a task's own. Assigned by the harness. */
	id: string;
	kind: ScenarioKind;
	title: string;
	given: string;
	when: string;
	then: string;
}

export type TaskStatus = "pending" | "planned" | "implemented" | "integrated" | "failed";

export interface WfTask {
	/** "T1", "T2", … in execution order. Assigned by the harness. */
	id: string;
	title: string;
	goal: string;
	files: string[];
	/** Whole-task scenario ids this task must provide tests for. */
	covers: string[];
	scenarios: Scenario[];
	logic: string[];
	status: TaskStatus;
}

export type StepKind = "scenarios" | "breakdown" | "task_plan" | "implement" | "integrate";

export const STEP_TOOL: Record<StepKind, string> = {
	scenarios: "submit_scenarios",
	breakdown: "submit_breakdown",
	task_plan: "submit_task_plan",
	implement: "report_done",
	integrate: "report_done",
};

/** Which tools a step's session gets besides its submit tool. */
export const STEP_TOOLSET: Record<StepKind, "planning" | "coding"> = {
	scenarios: "planning",
	breakdown: "planning",
	task_plan: "planning",
	implement: "coding",
	integrate: "coding",
};

export interface WorkflowConfig {
	scenarios: { minHappy: number; minUnhappy: number; max: number };
	tasks: { min: number; max: number };
	taskScenarios: { minHappy: number; minUnhappy: number; max: number };
	logic: { min: number; max: number };
	/** Fresh-context attempts per step before the workflow stops. */
	attempts: { planning: number; implement: number; integrate: number };
	/**
	 * Turns a session may take (one model response plus its tool results is a
	 * turn) before the harness aborts it; 0 = no limit. A session stopped here
	 * counts as a failed attempt like any other.
	 */
	maxTurns: number;
	/** report_done refusals inside one session before the tool gives up and ends it. */
	doneRefusals: number;
	/**
	 * Wall-clock limit per session, minutes. 15, down from 40: in the 2026-09-24
	 * runs sessions that reached 40 minutes had not recovered, and a fresh attempt
	 * did better.
	 */
	stepTimeoutMin: number;
	/**
	 * Limit for one run of the test suite, seconds. 60, down from 300: a suite
	 * that hangs (a server a test never stops) cost MiniCPM5 five minutes per
	 * check on 2026-09-24.
	 */
	testTimeoutSec: number;
	/**
	 * Appended to the model's system prompt in every workflow session ("" = none).
	 * Default: a terse response style. Output tokens are the cost: on this laptop
	 * a 3B model generates ~14 t/s, and Granite-4.2-3B's first run spent 78 of its
	 * 85 minutes generating (2026-09-24).
	 */
	systemPrompt: string;
	/**
	 * How much of a failed check the model is told, in a retry prompt and when
	 * report_done refuses:
	 *   minimal   what failed and the command to see why ("the test suite failed
	 *             (`cmd` exited 1)"); nothing from the output. The model has to run
	 *             the tests itself rather than guess from a fragment of an error.
	 *   focus     minimal, plus the name of ONE failing test to start with (the
	 *             task's failurePattern) — a pointer, not an explanation: the
	 *             model still has to run it to see why it fails
	 *   failures  minimal, plus one line per failing test with its error
	 *   output    minimal, plus the last lines of the output
	 */
	feedback: "minimal" | "focus" | "failures" | "output";
	/** A model rotation (roster aliases): every failed session moves to the next. --models overrides it. */
	models?: string[];
	/**
	 * Tool kinds for coding steps (lib/tools.ts), instead of each model's roster
	 * tools. ["bash", "edit"] gives a targeted edit: with bash alone every model in
	 * the 2026-09-24 overnight run rewrote whole files with heredocs to change a
	 * line, and each rewrite brought a new error.
	 */
	codingTools?: string[];
	/**
	 * What a retried coding step starts from:
	 *   keep   the previous attempt's files, and its failure as feedback
	 *   reset  the workspace as it was when the step started, and no feedback: the
	 *          retry is the first attempt again, on the next model. In the
	 *          2026-09-24 overnight runs every model that inherited a broken
	 *          attempt spent its turns reading and patching someone else's design
	 *          (a test file whose port scheme used an attribute it never set) and
	 *          none repaired it.
	 *   best   the workspace of the attempt with the most passing tests so far, and
	 *          that attempt's verdict as feedback; "reset" until an attempt has a
	 *          passing test. Needs the task's failurePattern to count them.
	 */
	retryWorkspace: "keep" | "reset" | "best";
}

export const TERSE_STYLE =
	"Response style: terse. Use as few words as possible — in your reasoning, in your messages, and in the fields you submit. " +
	"No preamble, no restating the task, no summary of what you did or are about to do. " +
	"Code, commands and tool arguments are as long as they need to be; everything else is short.";

export const DEFAULT_CONFIG: WorkflowConfig = {
	scenarios: { minHappy: 3, minUnhappy: 3, max: 16 },
	tasks: { min: 2, max: 6 },
	taskScenarios: { minHappy: 1, minUnhappy: 1, max: 10 },
	logic: { min: 1, max: 12 },
	attempts: { planning: 3, implement: 3, integrate: 3 },
	maxTurns: 0,
	doneRefusals: 4,
	stepTimeoutMin: 15,
	testTimeoutSec: 60,
	systemPrompt: TERSE_STYLE,
	feedback: "minimal",
	retryWorkspace: "keep",
};

export function mergeConfig(base: WorkflowConfig, over: any): WorkflowConfig {
	const out: any = structuredClone(base);
	for (const [k, v] of Object.entries(over ?? {})) {
		out[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...out[k], ...v } : v;
	}
	return out;
}

/**
 * Everything the harness knows about a particular task beyond its text, from the
 * task's task.json (../workflow/tasks/README.md). The harness itself assumes no
 * language, test framework, file layout or dependency policy: those are either
 * given here or planned by the model.
 */
export interface TaskProfile {
	/**
	 * The command that runs the whole test suite from /workspace; exit 0 = pass.
	 * Unset: the breakdown step must propose one (`test_command`), and that is used.
	 */
	testCommand?: string;
	/**
	 * Globs (relative to /workspace) of the files that hold tests; at least one
	 * must exist. Unset: any file whose path contains "test" or "spec".
	 */
	testFiles?: string[];
	/**
	 * Optional regex over the test output whose first group is the number of
	 * tests that ran ("^Ran (\\d+) tests?" for unittest). When set, a run that
	 * matches 0 — or does not match at all — fails: an empty suite is not a pass.
	 * It is also how "a test per scenario" is checked: the count must reach the
	 * number of scenarios so far. Tests may be named anything.
	 */
	testCountPattern?: string;
	/**
	 * Optional regex over the test output matching one line per failing test.
	 * Group 1 is the test's name; an optional group 2 is its error on the same
	 * line. Without group 2 the error is the last line of the block under the
	 * match. Examples:
	 *   unittest  "^(?:FAIL|ERROR): (\\S+)"
	 *   pytest -rf  "^FAILED (\\S+) - (.*)"
	 * A framework that prints errors above the test's name (go test) or ends
	 * each block with a stack trace (jest) is better left without a pattern.
	 * Retry feedback then lists each failing test with its error instead of
	 * the tail of the output; when nothing matches it falls back to the tail.
	 */
	failurePattern?: string;
	/** Task-specific rules shown to the model in every coding step (layout, framework, constraints). */
	conventions?: string;
	/** Task-specific checks: shell commands run from /workspace after the suite; exit 0 = pass. */
	checks?: Array<{ name: string; command: string }>;
}

/**
 * A task directory's task.json (../workflow/tasks/README.md): the profile plus
 * what only the orchestrator needs. Paths are relative to the task directory.
 */
export interface TaskDefinition extends TaskProfile {
	/** The task text given to the model, verbatim (markdown file). */
	prompt: string;
	/** Shell command run after the workflow, in a no-network container, from /workspace, with the task directory at /task. Its last output line may be JSON {passed, total}. */
	grader?: string;
	/** Directory copied into the workspace before the first step: existing code to work on. */
	seed?: string;
	/** Overrides for DEFAULT_CONFIG that suit this task (e.g. how many scenarios). */
	config?: Record<string, unknown>;
}

/** Problems with a task.json, so a bad definition fails before any model runs. */
export function taskDefinitionErrors(def: any): string[] {
	const errors: string[] = [];
	if (!def || typeof def !== "object") return ["task.json must be a JSON object"];
	if (typeof def.prompt !== "string" || !def.prompt) errors.push('"prompt" (the task text file) is required');
	for (const k of ["testCommand", "testCountPattern", "failurePattern", "conventions", "grader", "seed"]) {
		if (def[k] !== undefined && typeof def[k] !== "string") errors.push(`"${k}" must be a string`);
	}
	if (def.testFiles !== undefined && !(Array.isArray(def.testFiles) && def.testFiles.every((g: unknown) => typeof g === "string"))) {
		errors.push('"testFiles" must be a list of globs');
	}
	if (typeof def.testCountPattern === "string") {
		try {
			if (!/\((?!\?)/.test(def.testCountPattern)) errors.push('"testCountPattern" needs a capture group for the count');
			new RegExp(def.testCountPattern);
		} catch (e: any) {
			errors.push(`"testCountPattern" is not a valid regex: ${e.message}`);
		}
	}
	if (typeof def.failurePattern === "string") {
		try {
			if (!/\((?!\?)/.test(def.failurePattern)) errors.push('"failurePattern" needs a capture group for the test name');
			new RegExp(def.failurePattern);
		} catch (e: any) {
			errors.push(`"failurePattern" is not a valid regex: ${e.message}`);
		}
	}
	if (def.checks !== undefined && !(Array.isArray(def.checks) && def.checks.every((c: any) => c && typeof c.name === "string" && typeof c.command === "string"))) {
		errors.push('"checks" must be a list of {"name", "command"}');
	}
	return errors;
}

export function profileOf(def: TaskDefinition): TaskProfile {
	const { testCommand, testFiles, testCountPattern, failurePattern, conventions, checks } = def;
	return { testCommand, testFiles, testCountPattern, failurePattern, conventions, checks };
}

export interface WorkflowState {
	version: 1;
	/** stopped = the run's time budget (--deadline) ran out; the work so far is still graded. */
	status: "running" | "completed" | "failed" | "stopped";
	failure?: string;
	/** The task as given, verbatim. */
	task: string;
	profile: TaskProfile;
	/** The test command in force: the profile's, else the one the breakdown proposed. */
	testCommand?: string;
	/** Did the workspace contain files before the first step? Triggers integration for T1. */
	preexistingCode: boolean;
	scenarios: Scenario[];
	tasks: WfTask[];
	/** The feedback for the next attempt at `step`, kept so --resume retries with it (and, for retryWorkspace "best", the best attempt's score). */
	retry?: { step: string; feedback: string; score?: number; check?: CheckReport };
}

export function initialState(task: string, preexistingCode: boolean, profile: TaskProfile = {}): WorkflowState {
	return {
		version: 1,
		status: "running",
		task: task.trim(),
		profile,
		testCommand: profile.testCommand,
		preexistingCode,
		scenarios: [],
		tasks: [],
	};
}

/** What the harness verifies after an implement/integrate step (../workflow/check.py). */
export interface CheckSpec {
	testCommand: string;
	testTimeoutSec: number;
	testFiles?: string[];
	testCountPattern?: string;
	failurePattern?: string;
	/** Scenarios so far: the suite must run at least this many tests. */
	minTests: number;
	/** Why minTests is what it is, for the message when too few tests ran. */
	minTestsWhy?: string;
	checks: Array<{ name: string; command: string }>;
}

/** What the plugin reads (PI_SMALL_WORKFLOW_STEP) to build the step's tool. */
export interface StepFile {
	kind: StepKind;
	taskId?: string;
	tool: string;
	toolset: "planning" | "coding";
	/**
	 * The built-in tool kinds this step gets besides its submit tool, replacing
	 * the model's roster tools. Unset = the roster's. Planning steps get [] (or
	 * read/ls when there is existing code to look at), so a model cannot start
	 * coding when it is meant to be planning.
	 */
	toolKinds?: string[];
	/** Where the accepted submission is written, as the container sees it. */
	out: string;
	config: WorkflowConfig;
	/** breakdown: the scenario ids that must be covered. */
	scenarioIds?: string[];
	/** breakdown: the task has no test command, so the model must propose one. */
	needsTestCommand?: boolean;
	/** implement/integrate: what report_done checks before it accepts. */
	check?: CheckSpec;
	/** Appended to the model's system prompt for this session (WorkflowConfig.systemPrompt). */
	systemPrompt?: string;
	/** implement/integrate: path of check.py and of the CheckSpec file, as the container sees them. */
	checkScript?: string;
	checkSpecPath?: string;
}

// ------------------------------------------------------------ validation --

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Small models sometimes pass an array or object as a JSON string, or wrap the
 * whole payload in one extra key. Undo both before validating, so the errors a
 * model sees are about content, not about quoting.
 */
export function unwrapArgs(args: any, key: string): any {
	let a = args;
	if (typeof a === "string") {
		try {
			a = JSON.parse(a);
		} catch {
			return args;
		}
	}
	if (a && typeof a === "object" && typeof a[key] === "string") {
		try {
			a = { ...a, [key]: JSON.parse(a[key]) };
		} catch {}
	}
	if (Array.isArray(a)) a = { [key]: a };
	return a;
}

const normKind = (v: unknown): ScenarioKind | null => {
	const s = str(v).toLowerCase();
	if (["happy", "happy path", "happy-path", "positive", "success"].includes(s)) return "happy";
	if (["unhappy", "unhappy path", "unhappy-path", "negative", "error", "failure", "sad"].includes(s)) return "unhappy";
	return null;
};

/** Scenario lists: shared by the whole-task step and the per-task plan. Ids are assigned here. */
export function validateScenarioList(
	raw: unknown,
	limits: { minHappy: number; minUnhappy: number; max: number },
	idPrefix: string,
): Result<Scenario[]> {
	const errors: string[] = [];
	if (!Array.isArray(raw)) return { ok: false, errors: ["`scenarios` must be a list of scenario objects."] };
	const out: Scenario[] = [];
	const seen = new Set<string>();
	raw.forEach((item: any, i) => {
		const n = i + 1;
		if (!item || typeof item !== "object") {
			errors.push(`scenario ${n}: must be an object with kind, title, given, when, then.`);
			return;
		}
		const kind = normKind(item.kind);
		if (!kind) errors.push(`scenario ${n}: kind must be "happy" or "unhappy" (got ${JSON.stringify(item.kind ?? null)}).`);
		for (const f of ["title", "given", "when", "then"]) {
			if (str(item[f]).length < 3) errors.push(`scenario ${n}: "${f}" is missing or too short.`);
		}
		const title = str(item.title);
		if (title && seen.has(title.toLowerCase())) errors.push(`scenario ${n}: duplicate title "${title}".`);
		seen.add(title.toLowerCase());
		if (kind) out.push({ id: `${idPrefix}${out.length + 1}`, kind, title, given: str(item.given), when: str(item.when), then: str(item.then) });
	});
	const happy = out.filter((s) => s.kind === "happy").length;
	const unhappy = out.filter((s) => s.kind === "unhappy").length;
	if (happy < limits.minHappy) errors.push(`need at least ${limits.minHappy} happy-path scenarios, got ${happy}.`);
	if (unhappy < limits.minUnhappy) errors.push(`need at least ${limits.minUnhappy} unhappy-path scenarios, got ${unhappy}.`);
	if (raw.length > limits.max) errors.push(`at most ${limits.max} scenarios, got ${raw.length} — merge or drop the least important.`);
	return errors.length ? { ok: false, errors } : { ok: true, value: out };
}

export function validateScenarios(args: any, cfg: WorkflowConfig): Result<Scenario[]> {
	return validateScenarioList(unwrapArgs(args, "scenarios")?.scenarios, cfg.scenarios, "S");
}

const cleanPath = (p: string): string => p.replace(/^\.\/+/, "").replace(/^\/workspace\/+/, "");

export interface Breakdown {
	tasks: WfTask[];
	testCommand?: string;
}

export function validateBreakdown(args: any, cfg: WorkflowConfig, scenarioIds: string[], needsTestCommand = false): Result<Breakdown> {
	const a = unwrapArgs(args, "tasks");
	const raw = a?.tasks;
	const errors: string[] = [];
	const testCommand = str(a?.test_command ?? a?.testCommand);
	if (needsTestCommand && testCommand.length < 4) {
		errors.push('"test_command" is required: the one shell command, run from /workspace, that runs the whole test suite and exits non-zero when any test fails.');
	}
	if (!Array.isArray(raw)) return { ok: false, errors: [...errors, "`tasks` must be a list of task objects."] };
	if (raw.length < cfg.tasks.min || raw.length > cfg.tasks.max) {
		errors.push(`need between ${cfg.tasks.min} and ${cfg.tasks.max} tasks, got ${raw.length}.`);
	}
	const known = new Set(scenarioIds);
	const covered = new Set<string>();
	const out: WfTask[] = [];
	const titles = new Set<string>();
	raw.forEach((item: any, i) => {
		const n = i + 1;
		if (!item || typeof item !== "object") {
			errors.push(`task ${n}: must be an object with title, goal, files, covers.`);
			return;
		}
		const title = str(item.title);
		const goal = str(item.goal);
		if (title.length < 3) errors.push(`task ${n}: "title" is missing.`);
		if (goal.length < 10) errors.push(`task ${n}: "goal" is missing or too short — say what exists when this task is done.`);
		if (title && titles.has(title.toLowerCase())) errors.push(`task ${n}: duplicate title "${title}".`);
		titles.add(title.toLowerCase());
		const files: string[] = Array.isArray(item.files) ? item.files.map((f: unknown) => cleanPath(str(f))).filter(Boolean) : [];
		if (files.length === 0) errors.push(`task ${n}: "files" must list at least one file the task creates or changes.`);
		for (const f of files) {
			if (f.startsWith("/") || f.split("/").includes("..")) errors.push(`task ${n}: file "${f}" must be a relative path inside the workspace.`);
		}
		const covers: string[] = Array.isArray(item.covers) ? item.covers.map((c: unknown) => str(c).toUpperCase()).filter(Boolean) : [];
		for (const c of covers) {
			if (!known.has(c)) errors.push(`task ${n}: covers unknown scenario "${c}" — valid ids are ${scenarioIds.join(", ")}.`);
			else covered.add(c);
		}
		out.push({ id: `T${out.length + 1}`, title, goal, files, covers: [...new Set(covers.filter((c: string) => known.has(c)))], scenarios: [], logic: [], status: "pending" });
	});
	const missing = scenarioIds.filter((id) => !covered.has(id));
	if (missing.length) errors.push(`every scenario must be covered by some task; not covered: ${missing.join(", ")}.`);
	return errors.length ? { ok: false, errors } : { ok: true, value: { tasks: out, ...(needsTestCommand ? { testCommand } : {}) } };
}

export function validateTaskPlan(args: any, cfg: WorkflowConfig, taskId: string): Result<{ scenarios: Scenario[]; logic: string[] }> {
	let a = unwrapArgs(args, "scenarios");
	a = unwrapArgs(a, "logic");
	const errors: string[] = [];
	const sc = validateScenarioList(a?.scenarios, cfg.taskScenarios, `${taskId}.S`);
	if (!sc.ok) errors.push(...sc.errors);
	let logic: string[] = [];
	if (typeof a?.logic === "string") logic = a.logic.split(/\n+/).map((l: string) => l.replace(/^\s*[-*\d.)]+\s*/, "").trim());
	else if (Array.isArray(a?.logic)) logic = a.logic.map(str);
	logic = logic.filter((l) => l.length > 0);
	if (logic.length < cfg.logic.min) errors.push(`"logic" needs at least ${cfg.logic.min} step(s): how the code will work — data structures, functions, error handling.`);
	if (logic.length > cfg.logic.max) errors.push(`"logic" has ${logic.length} items; keep it to ${cfg.logic.max} or fewer.`);
	return errors.length ? { ok: false, errors } : { ok: true, value: { scenarios: sc.ok ? sc.value : [], logic } };
}

export function validateDone(args: any): Result<{ summary: string }> {
	const a = unwrapArgs(args, "summary");
	const summary = str(a?.summary);
	return summary.length >= 3 ? { ok: true, value: { summary } } : { ok: false, errors: ['"summary" is required: one or two sentences on what you did.'] };
}

/** Validate a submission for its step; `scenarioIds`/`needsTestCommand` only matter for the breakdown. */
export function validateSubmission(step: Pick<StepFile, "kind" | "taskId" | "config" | "scenarioIds" | "needsTestCommand">, args: any): Result<any> {
	switch (step.kind) {
		case "scenarios":
			return validateScenarios(args, step.config);
		case "breakdown":
			return validateBreakdown(args, step.config, step.scenarioIds ?? [], !!step.needsTestCommand);
		case "task_plan":
			return validateTaskPlan(args, step.config, step.taskId ?? "T?");
		case "implement":
		case "integrate":
			return validateDone(args);
	}
}

// ------------------------------------------------------ state transitions --

export function applySubmission(state: WorkflowState, kind: StepKind, taskId: string | undefined, value: any): WorkflowState {
	const s: WorkflowState = structuredClone(state);
	const task = taskId ? s.tasks.find((t) => t.id === taskId) : undefined;
	switch (kind) {
		case "scenarios":
			s.scenarios = value;
			break;
		case "breakdown":
			s.tasks = value.tasks;
			if (value.testCommand) s.testCommand = value.testCommand;
			break;
		case "task_plan":
			if (!task) throw new Error(`unknown task ${taskId}`);
			task.scenarios = value.scenarios;
			task.logic = value.logic;
			task.status = "planned";
			break;
		case "implement":
			if (!task) throw new Error(`unknown task ${taskId}`);
			task.status = "implemented";
			break;
		case "integrate":
			if (!task) throw new Error(`unknown task ${taskId}`);
			task.status = "integrated";
			break;
	}
	return s;
}

/** Does task `taskId` need an integration step once it is implemented? */
export function needsIntegration(state: WorkflowState, taskId: string): boolean {
	const idx = state.tasks.findIndex((t) => t.id === taskId);
	return idx > 0 || state.preexistingCode;
}

export interface NextStep {
	kind: StepKind;
	taskId?: string;
}

/** The next step, derived from the state alone, so a stopped run can resume. */
export function nextStep(state: WorkflowState): NextStep | null {
	if (state.status !== "running") return null;
	if (state.scenarios.length === 0) return { kind: "scenarios" };
	if (state.tasks.length === 0) return { kind: "breakdown" };
	// Every task is planned before any code is written: the plan for T3 must not
	// be shaped by whatever T1's implementation happened to do.
	const unplanned = state.tasks.find((t) => t.status === "pending");
	if (unplanned) return { kind: "task_plan", taskId: unplanned.id };
	for (const t of state.tasks) {
		if (t.status === "planned") return { kind: "implement", taskId: t.id };
		if (t.status === "implemented") {
			if (needsIntegration(state, t.id)) return { kind: "integrate", taskId: t.id };
			// No earlier work to integrate with: implemented is final for this task.
			continue;
		}
		if (t.status === "failed") return null;
	}
	return null;
}

/** A task whose implementation needs no integration step counts as finished once implemented. */
export function taskFinished(state: WorkflowState, t: WfTask): boolean {
	return t.status === "integrated" || (t.status === "implemented" && !needsIntegration(state, t.id));
}

// ------------------------------------------------- what the tests must cover --

/**
 * "S3" -> "S3", "T2.S1" -> "T2_S1". Tests are no longer required to carry these
 * in their names: that rule tripped every model in the 2026-09-24 rotation run
 * (tests named test_T1_S1 for whole-task scenario S1, never renamed in four
 * retries). The ids now only count the tests the suite must run.
 */
export const testToken = (id: string): string => id.replace(/\./g, "_");

/** The token for task Tk's integration tests: "I2". */
export const integrationToken = (taskId: string): string => `I${taskId.replace(/^T/, "")}`;

/**
 * Every scenario (plus one per integration step) that needs a test once task
 * `taskId`'s `kind` step is done. Cumulative — earlier tasks' included — so
 * deleting earlier tests fails the check. CheckSpec.minTests is its length.
 */
export function requiredTokensThrough(state: WorkflowState, taskId: string, kind: "implement" | "integrate" = "implement"): string[] {
	const tokens: string[] = [];
	for (const t of state.tasks) {
		tokens.push(...taskScenarios(state, t).map((s) => testToken(s.id)));
		const current = t.id === taskId;
		if (needsIntegration(state, t.id) && (!current || kind === "integrate")) tokens.push(integrationToken(t.id));
		if (current) break;
	}
	return [...new Set(tokens)];
}

export function checkSpecFor(state: WorkflowState, kind: "implement" | "integrate", taskId: string, cfg: WorkflowConfig): CheckSpec {
	return {
		testCommand: state.testCommand ?? "",
		testTimeoutSec: cfg.testTimeoutSec,
		testFiles: state.profile.testFiles,
		testCountPattern: state.profile.testCountPattern,
		failurePattern: state.profile.failurePattern,
		// One test per scenario, cumulative. Integration steps add no count of their own:
		// "+1 per integration step" left integrate-T2 stuck at 9 of 10 with a
		// passing suite for nine attempts (2026-09-25).
		minTests: requiredTokensThrough(state, taskId, kind).filter((t) => !/^I\d+$/.test(t)).length,
		minTestsWhy: "one per scenario so far",
		checks: state.profile.checks ?? [],
	};
}

/** The check after the last task: every token of every task. */
export function finalCheckSpec(state: WorkflowState, cfg: WorkflowConfig): CheckSpec {
	const last = state.tasks[state.tasks.length - 1];
	return checkSpecFor(state, last && needsIntegration(state, last.id) ? "integrate" : "implement", last?.id ?? "", cfg);
}

/** The structured result of ../workflow/check.py. */
export interface CheckReport {
	ok: boolean;
	problems: string[];
	tests?: { rc: number | null; timedOut?: boolean; count?: number | null; tail?: string; failures?: Array<{ test: string; error: string }> };
	checks?: Array<{ name: string; ok: boolean; tail?: string }>;
}

/** A check report, as feedback a model can act on; `level` is WorkflowConfig.feedback. */
export function describeCheck(r: CheckReport, level: WorkflowConfig["feedback"] = "failures"): string {
	if (r.ok) return `All checks passed${r.tests?.count != null ? ` (${r.tests.count} tests ran)` : ""}.`;
	const lines = ["The harness checks did NOT pass:", ...r.problems.map((p) => `- ${p}`)];
	if (level === "minimal") return lines.join("\n");
	const failures = r.tests?.failures ?? [];
	if (level === "focus") {
		if (failures.length && !r.tests?.timedOut) lines.push("", `Start with the failing test \`${failures[0].test}\`.`);
		return lines.join("\n");
	}
	if (level === "failures" && failures.length && !r.tests?.timedOut) {
		// Tests failing the same way are one line: seven "Connection refused" lines say no more than one.
		const byError = new Map<string, string[]>();
		for (const f of failures) byError.set(f.error, [...(byError.get(f.error) ?? []), f.test]);
		lines.push("", "Failing tests:", ...[...byError].map(([error, tests]) => `- ${tests.length > 2 ? `${tests.slice(0, 2).join(", ")} and ${tests.length - 2} more` : tests.join(", ")}: ${error || "(no error line)"}`));
	}
	else if (r.tests?.tail && (r.tests.rc !== 0 || r.tests.timedOut)) lines.push("", "Last lines of the test run:", "```", r.tests.tail.trim(), "```");
	for (const c of r.checks ?? []) if (!c.ok && c.tail) lines.push("", `Output of the "${c.name}" check:`, "```", c.tail.trim(), "```");
	return lines.join("\n");
}

// -------------------------------------------------------------- the spec --

const scenarioLine = (s: Scenario): string => `- **${s.id}** [${s.kind}] ${s.title} — Given ${s.given}; when ${s.when}; then ${s.then}`;

const statusLabel = (state: WorkflowState, t: WfTask): string =>
	taskFinished(state, t) ? "done" : t.status === "implemented" ? "implemented, integration pending" : t.status === "failed" ? "FAILED" : "not started";

/** The enriched task: everything accepted so far, rendered for the next fresh session. */
export function renderSpec(state: WorkflowState, focus?: string): string {
	const out: string[] = ["## The task", "", state.task, ""];
	if (state.scenarios.length) {
		out.push("## Verification scenarios for the whole task", "");
		out.push(...state.scenarios.map(scenarioLine), "");
	}
	if (state.tasks.length) {
		out.push("## Implementation plan (tasks run in this order)", "");
		for (const t of state.tasks) {
			out.push(`${t.id}. **${t.title}** (${statusLabel(state, t)}) — ${t.goal} Files: ${t.files.join(", ")}. Covers: ${t.covers.join(", ") || "none"}.`);
		}
		out.push("");
	}
	const f = focus ? state.tasks.find((t) => t.id === focus) : undefined;
	if (f) {
		out.push(`## Current task: ${f.id} — ${f.title}`, "", f.goal, "", `Files: ${f.files.join(", ")}`);
		if (f.covers.length) {
			out.push("", "Whole-task scenarios this task must provide tests for:");
			out.push(...state.scenarios.filter((s) => f.covers.includes(s.id)).map(scenarioLine));
		}
		if (f.scenarios.length) out.push("", "This task's own scenarios:", ...f.scenarios.map(scenarioLine));
		if (f.logic.length) out.push("", "Implementation logic:", ...f.logic.map((l) => `- ${l}`));
		out.push("");
	}
	return out.join("\n").trimEnd() + "\n";
}

/** A scenario's meaning, for spotting the same scenario under two ids. */
const scenarioKey = (s: Scenario): string => [s.given, s.when, s.then].map((x) => String(x).toLowerCase().replace(/\s+/g, " ").trim()).join("|");

/**
 * The scenarios task `t` must test, each once: the whole-task scenarios it
 * covers, then its own that are not one of those (or of any whole-task
 * scenario) under another id. Planners repeat: in the 2026-09-24 rotation
 * run's plan, 23 of the 25 task-level scenarios were verbatim copies of
 * whole-task ones, so T1 asked for 12 tests where 7 were distinct.
 */
export function taskScenarios(state: WorkflowState, t: WfTask): Scenario[] {
	const out = state.scenarios.filter((s) => t.covers.includes(s.id));
	const byKey = new Map(state.scenarios.map((s) => [scenarioKey(s), s]));
	const seen = new Set(out.map(scenarioKey));
	for (const s of t.scenarios) {
		const k = scenarioKey(s);
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(byKey.get(k) ?? s);
	}
	return out;
}

/**
 * The spec as a coding step sees it: the task and the current task, nothing
 * else. The whole-task scenario list and the other tasks' plans are context
 * the step does not act on (planning steps get the full renderSpec).
 */
export function renderFocus(state: WorkflowState, taskId: string): string {
	const f = state.tasks.find((t) => t.id === taskId)!;
	const out: string[] = ["## The task", "", state.task, "", `## Current task: ${f.id} — ${f.title}`, "", f.goal, "", `Files: ${f.files.join(", ")}`];
	const sc = taskScenarios(state, f);
	if (sc.length) out.push("", "Scenarios to test:", ...sc.map(scenarioLine));
	if (f.logic.length) out.push("", "Implementation logic:", ...f.logic.map((l) => `- ${l}`));
	return out.join("\n").trimEnd() + "\n";
}

// ----------------------------------------------------------------- prompts --

/**
 * For every planning submission. The quoting rule exists because Granite-4.2-3B
 * spent a whole 4096-token response deliberating how to escape the JSON request
 * bodies its scenarios quoted, inside the JSON of the tool call, and never
 * called the tool.
 */
const FIELD_RULES =
	"Keep every field to one short sentence. Where a field shows code or JSON, write it with single quotes, for example {'title': 'Dune'}: " +
	"the harness only reads it, and single quotes keep the tool call itself simple.";

const SCENARIO_FORMAT =
	'Each scenario has: kind ("happy" or "unhappy"), title, given (the starting state), when (the exact action, with concrete input values), ' +
	"then (the exact observable result: output, return value, file contents, status code or error). Make every scenario falsifiable: someone must be able to " +
	"run it and see it pass or fail. No vague words like \"works\", \"correctly\" or \"appropriate\".\n" +
	FIELD_RULES;

const testFilesRule = (state: WorkflowState): string =>
	state.profile.testFiles?.length
		? `Tests go in files matching ${state.profile.testFiles.map((g) => `\`${g}\``).join(", ")}.`
		: 'Tests go in files whose path contains "test" (for example tests/test_orders.py or orders.test.ts).';

/** The harness's own rules for a coding step. Task-specific rules come from the task's `conventions`. */
const CODING_RULES = (state: WorkflowState, cfg: WorkflowConfig) =>
	[
		"Rules:",
		"- Work in /workspace.",
		`- Every scenario needs an automated test that proves it. ${testFilesRule(state)}`,
		`- The harness runs the whole test suite from /workspace with: \`${state.testCommand}\`. It must pass and finish within ${cfg.testTimeoutSec} seconds; run it yourself before you finish, ` +
			`with the bash tool's timeout set to ${cfg.testTimeoutSec}.`,
		"- Tests must clean up whatever they start (servers, background processes, temporary files).",
	].join("\n");

/** Task-specific rules, repeated in every step so planning and coding agree. */
const taskRules = (state: WorkflowState): string[] =>
	state.profile.conventions?.trim() ? ["## Rules for this task", "", state.profile.conventions.trim(), ""] : [];

export function buildPrompt(state: WorkflowState, step: NextStep, cfg: WorkflowConfig, feedback?: string): string {
	const header = `# Workflow step: ${step.kind}${step.taskId ? ` ${step.taskId}` : ""}`;
	const parts: string[] = [header, ""];
	switch (step.kind) {
		case "scenarios":
			parts.push(
				"You are planning, not coding. Do not write any code in this step.",
				"",
				"Read the task below and write the verification scenarios that will prove the finished work is correct: " +
					`the happy paths (at least ${cfg.scenarios.minHappy}) and the unhappy paths — invalid input, missing items, errors (at least ${cfg.scenarios.minUnhappy}). ` +
					`At most ${cfg.scenarios.max} in total.`,
				SCENARIO_FORMAT,
				"",
				renderSpec(state),
				...taskRules(state),
				"Submit them a few at a time: call the tool `submit_scenarios` with three or four scenarios and `done: false`, then with the next few, " +
					"and set `done: true` on the last call. It tells you what it has so far; if it reports problems, fix them and call it again.",
			);
			break;
		case "breakdown":
			parts.push(
				"You are planning, not coding. Do not write any code in this step.",
				"",
				`Break the task below into ${cfg.tasks.min} to ${cfg.tasks.max} small implementation tasks, in the order they should be built. ` +
					"Each task must be small enough to implement and test on its own, and later tasks may build on earlier ones. For each task give: " +
					"title, goal (what exists when it is done), files (the files it creates or changes, including its test files), and covers (the ids of the whole-task scenarios " +
					"whose tests belong to this task). Every scenario id must be covered by at least one task. " +
					FIELD_RULES,
				...(state.testCommand
					? []
					: [
							"",
							"Also give `test_command`: the one shell command, run from /workspace, that will run the whole test suite of the finished work and exit " +
								"non-zero when any test fails. Every later step is checked with it, so choose the test tool the task's language normally uses.",
						]),
				"",
				renderSpec(state),
				...taskRules(state),
				"When you are done, call the tool `submit_breakdown`" + (state.testCommand ? " with the list of tasks." : " with the list of tasks and the test command.") +
					" If it reports problems, fix them and call it again.",
			);
			break;
		case "task_plan":
			parts.push(
				"You are planning, not coding. Do not write any code in this step.",
				"",
				`Plan task ${step.taskId} (described at the end). Write (1) this task's own verification scenarios, which will become its tests: ` +
					`at least ${cfg.taskScenarios.minHappy} happy and ${cfg.taskScenarios.minUnhappy} unhappy, at most ${cfg.taskScenarios.max}; and ` +
					"(2) the implementation logic: a short list of steps saying how the code will work — data structures, function names and signatures, " +
					"validation and error handling.",
				SCENARIO_FORMAT,
				"",
				renderSpec(state, step.taskId),
				...taskRules(state),
				"When you are done, call the tool `submit_task_plan` with `scenarios` and `logic`. If it reports problems, fix them and call it again.",
			);
			break;
		case "implement":
			parts.push(
				`Implement task ${step.taskId} (described at the end), together with a test for every scenario listed for it. ` +
					"Earlier tasks are already done and verified; keep their tests passing.",
				"",
				CODING_RULES(state, cfg),
				"",
				renderFocus(state, step.taskId!),
				...taskRules(state),
				"When all tests pass, call the tool `report_done` with a one-sentence summary. It runs the harness's own checks and tells you if anything is still wrong.",
			);
			break;
		case "integrate": {
			const t = state.tasks.find((x) => x.id === step.taskId)!;
			const earlier = state.tasks.slice(0, state.tasks.indexOf(t)).map((x) => x.id);
			parts.push(
				`Task ${step.taskId} is implemented and its tests pass. Now write integration tests that exercise ${step.taskId} together with ` +
					(earlier.length ? `the earlier tasks (${earlier.join(", ")})` : "the code that already existed in the workspace") +
					" through the real entry points of the finished program, the way a user of it would, rather than by calling its internals. " +
					"If an integration test finds a bug, fix the code.",
				"",
				CODING_RULES(state, cfg),
				"",
				renderFocus(state, step.taskId!),
				...taskRules(state),
				"When the whole suite passes, call the tool `report_done` with a one-sentence summary. It runs the harness's own checks and tells you if anything is still wrong.",
			);
			break;
		}
	}
	if (feedback) parts.push("", "## A previous attempt at this step failed", "", feedback);
	return parts.join("\n") + "\n";
}
