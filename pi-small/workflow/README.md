# workflow/ — a staged, harness-driven workflow for the small models

The idea under test: move the "intelligence" of a coding session out of the 3-4B
model and into deterministic harness logic. The model does one small, well-framed
thing per step, in a **fresh context** every time. The harness decides what the
step is, what counts as a valid answer, whether the code works, and what comes
next.

**The workflow runs inside the plugin, in one pi process.** `run.ts` is only the
host side. It makes sure `../proxy.mjs` is serving the first model, starts one
pi-small process (in the sandbox container, or here with `--local`) in pi's RPC
mode (`pi-rpc.ts`), and sends it one command: `/workflow run <run-spec.json>`.
From then on `../lib/workflow-command.ts`, in the plugin, drives the run:
- every step and every retry is `newSession()` in that process, which gives an
  empty context. pi creates new extension instances for a new session, so the
  plugin re-reads the step file (`current-step.json` in the run directory);
- turn limits and time limits are enforced by watching the session and
  aborting it;
- a model rotation asks the host proxy for the next model, so pi never exits;
- `check.py` runs as a child process of pi.

When the plugin writes `workflow_end`, `run.ts` runs the task's grader, in its
own no-network container.

    node workflow/run.ts --task workflow/tasks/books-api --model Granite-4.2-3B-Q8_0
    node workflow/run.ts --task workflow/tasks/books-api --models Granite-4.2-3B-Q8_0,Spark-X2.5-4B-Q6_K,LFM2.5-2.6B-Q8_0 \
        --config workflow/configs/rotation-10turns.json --deadline 2026-09-24T21:20

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
| `implement` Tk | write the code and a test per scenario | `report_done` | `check.py`: the test command passes, with at least one test per scenario so far, and the task's own checks pass |
| `integrate` Tk | when earlier work exists: integration tests through the real entry points | `report_done` | as above, plus at least one more test |

Every task is planned before any code is written. After the last task, one
final `check.py` run covers the whole suite. Then the task's grader, if it has
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
- **The runner judges every step again**, never trusting the session.
  - Planning submissions are re-validated.
  - Coding steps are re-checked with `check.py` after the session ends. This
    happens in the agent's container: `check.py` is on the read-only plugin
    mount, so the model cannot change it, but it is no longer a fresh
    no-network container. The grader still is.
- **Recovery is fixed policy, not model judgement. Every retry starts fresh.**
  A step that ends without an accepted result is retried in a new, empty session
  whose prompt is the full step prompt plus the failure as feedback, up to
  `attempts.<kind>` times. For code, the previous attempt's files stay in the
  workspace. Then the workflow stops and records why. Continuing the failed
  session ("nudging") was dropped after the 2026-09-24 runs: long sessions did
  not recover, and a fresh attempt did better.
- **Turn and time limits.** A session gets `stepTimeoutMin` (default 15),
  capped by what is left of `--deadline`, and `maxTurns` assistant turns (0 = no
  limit). At either limit the plugin aborts the session and waits up to 60 s
  for it to settle. The test suite gets `testTimeoutSec` (default 60).
- **Model rotation.** With `--models A,B,C`, every failed session moves to the
  next model, cycling, until the task is done or the deadline passes. The
  plugin asks `proxy.mjs` for the switch (`POST /pi-small/model`) before the
  next session starts. Requests wait while the switch is in progress.
- **A test per scenario, named however the model likes.** Every scenario is in
  the prompt as something to test. The check counts: the suite must run at least
  as many tests as there are scenarios so far, which is cumulative, so deleting
  earlier tests fails. The count comes from the task's `testCountPattern`. Until
  2026-09-24 each test also had to carry its scenario id in its name
  (`test_T2_S1_…`). That rule tripped every model in the rotation run: tests
  named `test_T1_S1` for whole-task scenario `S1` were never renamed across
  four retries, while the models worked on the failing code instead.
- **Retry feedback is short.** It lists the problems, then one line per
  failing test with its error when the task has a `failurePattern`. Otherwise
  it shows the last 40 lines of output.

**A terse response style for every session.** The workflow config's
`systemPrompt` (default `TERSE_STYLE` in `lib/workflow.ts`) is appended to the
model's own system prompt in every workflow session, so a model's roster
prompt survives. Plain pi-small sessions, `--freeform` included, get
`TERSE_STYLE` too. The reason is cost. At about 14 tokens/s, Granite-4.2-3B's
first run spent 78 of its 85 minutes generating. Set it to `""` in a task's
`config` or with `--config` to turn it off.

Defaults are in `DEFAULT_CONFIG` (`lib/workflow.ts`); override them with
`--config file.json`.

## Review-only runs

A separate experiment from the staged workflow above: instead of building
something, N models each review an EXISTING workspace against the task text
and submit prioritised findings, no fixing. `../lib/review.ts` (`runReviews`)
drives it in place of `../lib/workflow-runner.ts`'s `runWorkflow`; it shares
everything else — the same `run.ts`, the same in-plugin step-file/submit-tool
machinery (`../lib/workflow-command.ts`, `../lib/workflow-tool.ts`), the same
`WorkflowEnv`. There is no state to accumulate across steps and no pass/fail
check to retry against: every (model, variant, repeat) combination is one
independent, fresh session against the SAME starting workspace.

    node workflow/run.ts --task workflow/tasks/books-api --models Granite-4.2-3B-Q8_0,LFM2.5-2.6B-Q8_0 \
        --review completeness,correctness --seed-ws path/to/an/existing/implementation

- `--review v1,v2,…` turns the run into a review instead of the staged
  workflow. Each name is a key of `REVIEW_VARIANTS` (`completeness`,
  `correctness`, `fidelity`, or `all`, which asks about all three in one
  session) — an unknown name is rejected before anything starts.
- `--seed-ws DIR` copies an existing implementation into the workspace before
  the run starts (`__pycache__` skipped) — the code under review. Without it
  the workspace is whatever `--ws` already holds, or the task's own `seed`.
- `--models A,B,C` is the reviewer roster here, not a failure-triggered
  rotation: EVERY model reviews EVERY variant. A single `--model A` still
  works — the run just has one reviewer.
- The workspace is snapshotted once at the start and restored before every
  session, so one reviewer's stray edit can never leak into the next one's
  read of the code. The default tool set (`WorkflowConfig.reviewTools`,
  `["bash", "read"]`) lets a reviewer run the tests and the app to check a
  claim rather than only guess from reading — the restore is what actually
  keeps the workspace honest, not the absence of write tools.
- No `--resume`, no retries, no grader: a session either submits through
  `submit_findings` (validated by `validateFindings` in `lib/review.ts`) or it
  doesn't, and that is the recorded result either way — see `reviews.json`
  below. `--no-grade` is a no-op in this mode; there is nothing to grade.
- The run directory carries `reviews.json` (a `ReviewResult[]`, one per
  model/variant/repeat) instead of `state.json`, and its steps are named
  `steps/NN-review-<variant>-<model>/`. `run.ts` still waits on the same
  `workflow_end` marker in `events.jsonl`, so `--review` needed no change to
  that wait loop — only to what happens after it.

Tests: `node test/workflow-test.ts` covers `validateFindings`,
`buildReviewPrompt` and `runReviews`'s (model × variant × repeat) loop against
a fake `WorkflowEnv`, the same way it covers the staged workflow. `node
test/review-e2e.ts [--local]` is the real thing, the same way
`workflow-e2e.ts` is: `run.ts`, the proxy, one pi process, two scripted models
(`test/fixtures/review-script.mjs`) each reviewing `test/fixtures/books-reference`
under two variants, asserting the scripted findings AND that the workspace is
still byte-for-byte the seed afterwards.

## The fix loop

Fixes an EXISTING workspace until only low-priority findings remain.
`../lib/fix-loop.ts` (`runFixLoop`) drives it, not the staged workflow:

    node workflow/run.ts --task tasks/books-api --models A,B --fix \
        --seed-ws path/to/existing/code --config workflow/configs/fix-loop.json

Each round:

1. **Probe.** `check.py` runs the task's suite and checks, plus
   `config.fixChecks` (`configs/fix-loop.json` adds `checks/http_fuzz.py`).
   A failing suite is one high-priority finding; a failing check is one finding
   per `FAIL` block in its output (the fuzzer prints one per crash site).
2. **Review**, only when the probe found nothing: one reviewer session
   (`reviewSession` in `lib/review.ts`, with the wrap-up nudge and
   continuations), with the `--review-variant` prompt (default `all`), told
   that the machine checks already pass. The workspace is restored afterwards.
3. **Fix.** Nothing high or medium left: the loop ends `clean`. Otherwise the
   top `config.fixBatch` findings go to one coding session (step kind `fix`,
   `report_done`). The host then re-runs the **gate**: the suite, with no
   fewer tests than the first probe found, and the task's own checks — not
   `fixChecks`, whose failures are findings, not a bar. A failed attempt is
   reverted to the round's start, and the next model in `--models` retries
   with the same findings plus the check's verdict, up to `config.fixAttempts`
   times; then the loop stops `stuck`.

After `config.fixRounds` fixes, a last probe and review record where things
ended up (`rounds_exhausted`). Other end states: `no_review` (no reviewer in
`--reviewers`, default `--models`, submitted) and `stopped` (`--deadline`).
`fix-loop.json` in the run directory has every round: the probe, the review,
what was selected, and each fix attempt. The run is graded like a workflow run,
and `run.ts` exits 0 only when the loop ends `clean`.

Why this order: in the 2026-09-25 review experiment
(`../../pi-small-review-scoring-20260925.md`), the fuzzer found every crash in
the workspace in 6 s with no model, while the reviewers were needed for
spec-level defects (a 404 where the task says 400, a field that is never
type-checked).

Tests: `node test/fix-loop-test.ts` covers the control flow against a fake
`WorkflowEnv`. `node test/fix-e2e.ts [--local]` runs it for real with a scripted
model (`test/fixtures/fix-script.mjs`) on `books-reference` with one crash put
back in. It covers the fuzzer finding the crash, a broken first fix that is
reverted, the retry on the next model, a review finding that gets fixed, and
the end state `clean`, graded 28/28.

## The run directory

    workflow-runs/<timestamp>-<model>/
      run.json        model(s), config, task, deadline
      run-spec.json   what the plugin was given (/workflow run reads it)
      state.json      the workflow state; --resume continues from it
      spec.md         the enriched task as it stands
      events.jsonl    every step start, run and judgement, with timings
      workflow.log    the same, one line per session and check, human-readable
      agent.events.jsonl / agent.stderr.log   the pi process's RPC events (not
                      the token deltas) and its stderr
      proxy.log       the host proxy and every model switch, when run.ts started it
      current-step.json   the step the plugin's next session reads
      steps/NN-<kind>[-Tk]-aN/
        prompt.md     what the session was given
        step.json     what the plugin read: tool, tool set, limits
        check.json    what check.py was asked to verify
        out.json      what the submit tool recorded (accepted or not, refusals)
        check-report-*.json   the host's own check runs
      reviews.json    --review: one ReviewResult per model/variant/repeat
      fix-loop.json   --fix: every round's probe, review, selection and fix attempts
      grade.json      the task grader's output, if it has one
      home/           the agent's HOME: pi's session files and pi-small's session
                      logs, kept out of the workspace so a model listing it does
                      not read its own transcripts (Spark did, 2026-09-24)
      ws/             the workspace the model worked in

## Files

| file | does |
|---|---|
| `run.ts` | the CLI, host side: the proxy, the agent process, the run spec, the grader |
| `pi-rpc.ts` | the one pi-small process of a run, driven over pi's RPC mode |
| `../lib/workflow-command.ts` | `/workflow run`: the runner's I/O on top of pi sessions, in the plugin |
| `../proxy.mjs` | host daemon in front of llama-server; switches models on request |
| `../lib/workflow.ts` | steps, validators, spec rendering, prompts. No I/O |
| `../lib/workflow-runner.ts` | the loop: fresh attempts, feedback, deadline, stop. I/O through an interface |
| `../lib/workflow-tool.ts` | the submit tool the plugin registers in the container |
| `../lib/review.ts` | review-only runs, and the one review session the fix loop also uses |
| `../lib/fix-loop.ts` | the fix loop: probe → review → fix, until only low-priority findings remain |
| `check.py` | the harness's verdict on a workspace (runs in the sandbox) |
| `checks/` | reusable checks: Python stdlib-only, and `http_fuzz.py`, a spec-agnostic crash fuzzer for `http.server` apps |
| `tasks/<name>/` | pluggable tasks: `task.json`, the prompt, the grader. See `tasks/README.md` |
| `launchers/` | the exact command behind each run in `../workflow-runs/` (the scheduled task's target), and `workflow-overnight-stop.sh`, which stops a run and every llama-server |

Tests:
- `node test/workflow-test.ts` covers the validators, step order, runner
  control flow, `check.py` and the submit tool, with no model and no Docker.
- `node test/workflow-e2e.ts`, on the laptop, runs the whole thing: the proxy,
  Docker, one pi process in RPC mode, `/workflow run`, and a two-model
  rotation, with the stub server (started by the proxy, as llama-server would
  be) playing the model from `test/fixtures/workflow-script.mjs`. Add `--local`
  to run it without Docker, for example on the Mac. That script takes every
  recovery path once:
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
  or time out on the Mac. They are fine in the container. `workflow-e2e.ts
  --local` patches it out with `test/fixtures/local-python/sitecustomize.py`.
