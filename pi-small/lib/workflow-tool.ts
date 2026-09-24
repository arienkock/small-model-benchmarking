/**
 * workflow-tool.ts — the one tool a workflow step ends with.
 *
 * When PI_SMALL_WORKFLOW_STEP points at a step file (written by the host
 * orchestrator, ../workflow/run.ts), the plugin registers this step's submit
 * tool next to the model's normal tools. The tool is where the harness's rules
 * meet the model:
 *
 *   - arguments are validated by ../lib/workflow.ts; a rejection is THROWN, so
 *     pi hands it back to the model as a tool error listing what to fix, and the
 *     session carries on;
 *   - report_done first runs ../workflow/check.py (a test per scenario,
 *     the task's test command, the task's own checks) and refuses while it
 *     fails, with the failures as the error;
 *   - an accepted submission is written to the step's `out` file and ends the
 *     session (`terminate`), so the step cannot drift into the next one.
 *
 * The host re-validates the out file and re-runs the checks in a fresh
 * container; this tool is the fast feedback loop, not the authority.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { Type } from "typebox";
import { type CheckReport, describeCheck, type StepFile, unwrapArgs, validateScenarios, validateSubmission } from "./workflow.ts";

export function loadStepFile(path = process.env.PI_SMALL_WORKFLOW_STEP): StepFile | null {
	// Missing is normal: the pi process starts before the workflow writes its
	// first step, and every later session's plugin instance reads the then-current one.
	if (!path || !existsSync(path)) return null;
	return JSON.parse(readFileSync(path, "utf8")) as StepFile;
}

const scenarioSchema = Type.Object(
	{
		kind: Type.String({ description: '"happy" or "unhappy"' }),
		title: Type.String({ description: "short name of the scenario" }),
		given: Type.String({ description: "the starting state" }),
		when: Type.String({ description: "the exact action, with concrete input values" }),
		then: Type.String({ description: "the exact observable result" }),
	},
	{ additionalProperties: true },
);

// Deliberately loose: the real rules live in workflow.ts and come back as
// readable errors. A strict schema would reject a stringified array with a
// generic validator message a 3B model cannot act on.
const PARAMS: Record<string, any> = {
	submit_scenarios: Type.Object(
		{
			scenarios: Type.Array(scenarioSchema, { description: "some of the verification scenarios: a few per call is fine" }),
			done: Type.Optional(Type.Boolean({ description: "true on the last call; false while more are coming" })),
		},
		{ additionalProperties: true },
	),
	submit_breakdown: Type.Object(
		{
			tasks: Type.Array(
				Type.Object(
					{
						title: Type.String(),
						goal: Type.String({ description: "what exists when this task is done" }),
						files: Type.Array(Type.String(), { description: "files this task creates or changes" }),
						covers: Type.Array(Type.String(), { description: "ids of the whole-task scenarios whose tests belong to this task, e.g. S1" }),
					},
					{ additionalProperties: true },
				),
				{ description: "the tasks, in the order they should be built" },
			),
			test_command: Type.Optional(Type.String({ description: "only when asked for: the shell command, run from /workspace, that runs the whole test suite" })),
		},
		{ additionalProperties: true },
	),
	submit_task_plan: Type.Object(
		{
			scenarios: Type.Array(scenarioSchema, { description: "this task's own verification scenarios" }),
			logic: Type.Array(Type.String(), { description: "implementation steps: data structures, functions, error handling" }),
		},
		{ additionalProperties: true },
	),
	report_done: Type.Object({ summary: Type.String({ description: "one or two sentences on what you did" }) }, { additionalProperties: true }),
};

const DESCRIPTIONS: Record<string, string> = {
	submit_scenarios: "Submit verification scenarios for the whole task, a few per call. Set done: true on the last call; the step ends when enough have been accepted.",
	submit_breakdown: "Submit the ordered list of implementation tasks. Ends this step when accepted.",
	submit_task_plan: "Submit this task's verification scenarios and implementation logic. Ends this step when accepted.",
	report_done: "Report that this step is finished. The harness first runs its own checks (the whole test suite, a test for every scenario, the task's own checks) and refuses if they fail.",
};

/** Run check.py the way the host does, but in this container, on the live workspace. */
function runCheck(step: StepFile): CheckReport {
	const r = spawnSync("python3", [step.checkScript!, step.checkSpecPath!, process.cwd()], {
		encoding: "utf8",
		timeout: ((step.check?.testTimeoutSec ?? 300) + 60) * 1000,
	});
	try {
		return JSON.parse(r.stdout);
	} catch {
		return { ok: false, problems: [`the harness check itself failed to run: ${(r.stderr || r.error?.message || "no output").slice(0, 500)}`] };
	}
}

const flag = (v: unknown): boolean | undefined => (v === true || v === "true" ? true : v === false || v === "false" ? false : undefined);

export function buildWorkflowTool(step: StepFile) {
	let refusals = 0;
	const limit = step.config.doneRefusals;
	const stop = (text: string) => ({ content: [{ type: "text" as const, text }], details: {}, terminate: true });

	/**
	 * Whole-task scenarios may arrive a few per call. A 3B model asked for up to
	 * 16 concrete scenarios in ONE tool call spent its whole 4096-token response
	 * thinking and deliberating about JSON escaping and never made the call
	 * (Granite-4.2-3B, 2026-09-24, twice in a row). Valid batches accumulate in a
	 * draft next to the out file, which outlives this tool instance (pi creates a
	 * new plugin instance for every session) — and the step completes on `done: true`, or on any
	 * call once the minimums are met if `done` is left out (one-shot still works).
	 */
	const draftPath = `${step.out}.draft.json`;
	const loadDraft = (): any[] => {
		try {
			return JSON.parse(readFileSync(draftPath, "utf8"));
		} catch {
			return [];
		}
	};
	const scenarioBatch = (params: any) => {
		const a = unwrapArgs(params, "scenarios");
		const batch = Array.isArray(a?.scenarios) ? a.scenarios : [];
		const done = flag(a?.done);
		const draft = [...loadDraft(), ...batch];
		const all = validateScenarios({ scenarios: draft }, step.config);
		const refuse = (errors: string[]) => {
			refusals++;
			if (refusals >= limit) {
				writeFileSync(step.out, JSON.stringify({ tool: step.tool, accepted: false, args: { scenarios: loadDraft() }, errors, refusals, at: new Date().toISOString() }, null, 2));
				return stop("Still not accepted after several tries; this step ends here.");
			}
			throw new Error(`Not accepted. Fix these and call ${step.tool} again:\n- ${errors.join("\n- ")}\n(${refusals} of ${limit} tries used.)`);
		};
		// Errors in THIS batch (a bad field, a duplicate title, one too many) reject the batch; the draft is kept.
		const itemErrors = all.ok ? [] : all.errors.filter((e) => !/^need at least/.test(e));
		if (batch.length === 0 && done !== true) return refuse(["`scenarios` must be a list with at least one scenario."]);
		if (itemErrors.length) return refuse(itemErrors.map((e) => e.replace(/^scenario (\d+)/, (_, n) => `scenario ${Number(n) - loadDraft().length} of this call`)));
		writeFileSync(draftPath, JSON.stringify(draft, null, 2));
		if (all.ok && done !== false) {
			writeFileSync(step.out, JSON.stringify({ tool: step.tool, accepted: true, args: { scenarios: draft }, value: all.value, refusals, at: new Date().toISOString() }, null, 2));
			return stop(`Accepted ${draft.length} scenarios. This step is complete.`);
		}
		const happy = draft.filter((s) => /happy|positive|success/i.test(String(s?.kind)) && !/unhappy/i.test(String(s?.kind))).length;
		const status = `${draft.length} scenarios recorded so far: ${happy} happy, ${draft.length - happy} unhappy (at least ${step.config.scenarios.minHappy} and ${step.config.scenarios.minUnhappy} needed, at most ${step.config.scenarios.max} in total).`;
		if (done === true) return refuse(all.ok ? [] : all.errors);
		return { content: [{ type: "text" as const, text: `${status} Call submit_scenarios again with the next few; set done: true on the last call.` }], details: {}, terminate: false };
	};

	return {
		name: step.tool,
		label: step.tool,
		description: DESCRIPTIONS[step.tool] ?? step.tool,
		parameters: PARAMS[step.tool],
		async execute(_id: string, params: any) {
			const record = (accepted: boolean, extra: Record<string, unknown>) =>
				writeFileSync(step.out, JSON.stringify({ tool: step.tool, accepted, args: params, refusals, at: new Date().toISOString(), ...extra }, null, 2));
			if (step.kind === "scenarios") return scenarioBatch(params);

			const v = validateSubmission(step, params);
			if (!v.ok) {
				refusals++;
				// Out of refusals: end the session and let the host start a fresh attempt,
				// rather than letting a model loop on the same mistake until the timeout.
				if (refusals >= limit) {
					record(false, { errors: v.errors });
					return stop("Still not accepted after several tries; this step ends here.");
				}
				throw new Error(`Not accepted. Fix these and call ${step.tool} again:\n- ${v.errors.join("\n- ")}\n(${refusals} of ${limit} tries used.)`);
			}
			let check: CheckReport | undefined;
			if (step.tool === "report_done" && step.checkScript) {
				check = runCheck(step);
				if (!check.ok) {
					refusals++;
					if (refusals >= limit) {
						// The host re-checks, then retries the step with fresh context or stops.
						record(false, { value: v.value, check });
						return stop("Recorded, but the checks still fail; this step ends here.");
					}
					throw new Error(`${describeCheck(check, step.config.feedback)}\n\nFix these, run the tests, and call report_done again. (${refusals} of ${limit} tries used.)`);
				}
			}
			record(true, { value: v.value, check: check ?? null });
			return stop("Accepted. This step is complete.");
		},
	};
}
