# workflow/ — a staged, harness-driven workflow for the small models

The idea under test: move the "intelligence" of a coding session out of the 3-4B
model and into deterministic harness logic. The model does one small, well-framed
thing per step, in a **fresh context** every time. The harness decides what the
step is, what counts as a valid answer, whether the code works, and what comes
next.

**One agent process per run.** `run.ts` starts one pi-small process in the
sandbox container, in pi's RPC mode (`pi-rpc.ts`). Every step and every retry is
a `new_session` in that process: an empty context, no new container. pi creates
new extension instances on a new session, so the plugin re-reads the step file
at `/harness/step.json`, which `run.ts` rewrites before each session. The
harness's checks run in their own short-lived no-network container; they are a
test runner, not an agent.

    node workflow/run.ts --task workflow/tasks/books-api --model Granite-4.2-3B-Q8_0

**The harness is task-agnostic.** It assumes no language, test framework, file
layout or dependency policy. Everything about a particular task comes from its
directory's `task.json` (see [`tasks/README.md`](tasks/README.md)):
- the text;
- how to run its tests (or the model proposes a command);
- extra checks;
- a grader;
- starting code;
- config overrides.

Run it on the laptop, like everything that serves a model. It is a long job, so
launch it with `schtasks` (see the repo's CLAUDE.md), not `nohup`.

## The steps

| step | the model is asked to | it ends by calling | the harness then checks |
|---|---|---|---|
| `scenarios` | write verification scenarios for the whole task: happy paths and unhappy paths, each falsifiable (given / when / then) | `submit_scenarios` | at least 3 happy and 3 unhappy, at most 16, every field present |
| `breakdown` | split the task into 2-6 ordered implementation tasks, each with files and the scenario ids it covers; plus a `test_command` when the task has none | `submit_breakdown` | count, relative paths, every scenario covered by some task, a test command if one was asked for |
| `task_plan` Tk | for each task: its own scenarios, plus the implementation logic | `submit_task_plan` | at least 1 happy and 1 unhappy, logic present |
| `implement` Tk | write the code and a test per scenario | `report_done` | `check.py`: every scenario id so far appears in a test file, the test command passes, the task's own checks pass |
| `integrate` Tk | when earlier work exists: integration tests through the real entry points | `report_done` | as above, plus the `I<k>` token in some test |

Every task is planned before any code is written. After the last task, one
final `check.py` run covers every scenario id. Then the task's grader, if it has
one, tests the result independently. The model never sees the grader.

Everything the steps produce is merged into the **spec** (`spec.md` in the run
directory). Each fresh session gets the parts of the spec it needs, rendered by
`lib/workflow.ts` `renderSpec`:
- the task;
- the whole-task scenarios;
- the plan with each task's status;
- the current task's scenarios and logic.

## Where the determinism lives

- **A submit tool per step** (`lib/workflow-tool.ts`, registered by the plugin
  when `PI_SMALL_WORKFLOW_STEP` is set). Its arguments are validated by
  `lib/workflow.ts`. A rejection is thrown back to the model as a tool error
  that lists what to fix, and the session carries on. An accepted submission
  ends the session (`terminate`), so a planning step cannot drift into coding.
- **Planning steps get no coding tools.** A planning session has only its
  submit tool. It also gets `read`/`ls` when the workspace started with code.
- **`report_done` runs the checks itself.** It refuses, with the failing
  output, until `check.py` passes. After `doneRefusals` refusals it ends the
  session anyway, and the host decides what happens next.
- **The host judges every step again**, never trusting the session.
  - Planning submissions are re-validated.
  - Coding steps are re-checked with `check.py` in a fresh container with no
    network.
- **Recovery is fixed policy, not model judgement. Every retry starts fresh.**
  A step that ends without an accepted result is retried in a new, empty session
  whose prompt is the full step prompt plus the failure as feedback, up to
  `attempts.<kind>` times. For code, the previous attempt's files stay in the
  workspace. Then the workflow stops and records why. Continuing the failed
  session ("nudging") was dropped after the 2026-09-24 runs: long sessions did
  not recover, and a fresh attempt did better.
- **Time limits.** A session gets `stepTimeoutMin` (default 15), capped by what
  is left of `--deadline`. At the limit the harness sends `abort`; if the
  session still does not stop, it kills the process, which is started again
  for the next session. The test suite gets `testTimeoutSec` (default 60).
- **Scenario to test traceability is mechanical, and language-agnostic.** The
  id of scenario `T2.S1`, written `T2_S1`, must appear in some test file, for
  example `def test_T2_S1_…` or `it("T2_S1: …")`. This is a plain-text search
  with guards, so `S1` is not satisfied by `T2_S1` or `S10`. The required ids
  are cumulative, so deleting an earlier task's tests fails the check.

**A terse response style for every session.** The workflow config's
`systemPrompt` (default `TERSE_STYLE` in `lib/workflow.ts`) is appended to the
model's own system prompt in every workflow session, so a model's roster
prompt survives. The reason is cost. At about 14 tokens/s, Granite-4.2-3B's
first run spent 78 of its 85 minutes generating. Set it to `""` in a task's
`config` or with `--config` to turn it off.

Defaults are in `DEFAULT_CONFIG` (`lib/workflow.ts`); override them with
`--config file.json`.

## The run directory

    workflow-runs/<timestamp>-<model>/
      run.json        model, config, task, grader
      state.json      the workflow state; --resume continues from it
      spec.md         the enriched task as it stands
      events.jsonl    every step start, run and judgement, with timings
      agent.events.jsonl / agent.stderr.log   the pi process's RPC events (not
                      the token deltas) and its stderr
      harness/        the current step's files, mounted at /harness
      steps/NN-<kind>[-Tk]-aN/
        prompt.md     what the session was given
        step.json     what the plugin read: tool, tool set, limits
        check.json    what check.py was asked to verify
        out.json      what the submit tool recorded (accepted or not, refusals)
        check-report-*.json   the host's own check runs
        sessions/     pi's session file and pi-small's session log for the step
      grade.json      the task grader's output, if it has one
      ws/             the workspace the model worked in

## Files

| file | does |
|---|---|
| `run.ts` | the CLI: docker, serve.mjs, the run directory |
| `pi-rpc.ts` | the one pi-small process of a run, driven over pi's RPC mode |
| `../lib/workflow.ts` | steps, validators, spec rendering, prompts. No I/O |
| `../lib/workflow-runner.ts` | the loop: fresh attempts, feedback, deadline, stop. I/O through an interface |
| `../lib/workflow-tool.ts` | the submit tool the plugin registers in the container |
| `check.py` | the harness's verdict on a workspace (runs in the sandbox) |
| `checks/` | reusable task checks a task.json may opt into (e.g. Python stdlib-only) |
| `tasks/<name>/` | pluggable tasks: `task.json`, the prompt, the grader. See `tasks/README.md` |

Tests:
- `node test/workflow-test.ts` covers the validators, step order, runner
  control flow, `check.py` and the submit tool, with no model and no Docker.
- `node test/workflow-e2e.ts`, on the laptop, runs the whole thing: Docker, one
  pi process in RPC mode, and the plugin, with the stub server playing the model
  from `test/fixtures/workflow-script.mjs`. That script takes every recovery path
  once:
  - a session that runs past its time limit and is aborted;
  - a session that ends without submitting;
  - a refused submission;
  - a refused `report_done`.

  The result must pass the grader. It uses `tasks/books-api`, loaded like any
  other task.

## Traps already handled

- **Stale bytecode.** Python validates `__pycache__` by source mtime and size,
  so a one-character fix saved within the same second as the previous run
  executes the old code. Every command `check.py` runs gets a private
  `PYTHONPYCACHEPREFIX`, which does nothing for other languages.
- **`run.ts` builds its own `docker run -i`** (the same image, mounts and
  environment as `pi-small-docker.sh`), because it has to talk to pi over
  stdin/stdout. `pi-small-docker.sh` sets stdin to `/dev/null` when there is no
  TTY.
- **Node's built-in TypeScript support** (how these `.ts` files run) rejects
  constructor parameter properties such as `constructor(private x: T)`.
  `tsc --noEmit` accepts them, so only running the file shows the problem.
- **`http.server` on macOS** calls `socket.getfqdn()` when it binds, and a
  reverse DNS lookup can take more than 5 s. Tests that start a server are slow
  or time out on the Mac. They are fine in the container.
