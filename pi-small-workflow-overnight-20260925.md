# Overnight: the ≤4B rotation on a shared plan, iterating on what the models are told (2026-09-24/25)

The brief was to keep every model's context as small as possible and distract
it as little as possible. The setup:
- Every run starts from the same accepted scenarios, breakdown and task plans.
- The rotation is Granite-4.2-3B → Spark-X2.5-4B → LFM2.5-2.6B → MiniCPM5-2B,
  with Nanbeige left out.
- Each session is limited to 10 turns and 15 minutes.
- The task: iterate on the feedback until the rotation finishes every task,
  or until 06:30.

**Result: two of five tasks done, and the best grade so far on this task:
24 of 28** (the previous best was 13 of 28, Granite alone on 2026-09-24).
- T1 and T2 were implemented and accepted.
- Integrate-T2 was running when the deadline hit. Its suite passed with 9
  tests, one short of the 10 it needed.
- T3, T4 and T5 were never reached.

Four grader checks fail:
- `GET /books/abc` should be 400. The shared plan's scenario S7 says 404,
  contradicting the task text, and the models followed the scenario.
- The `q` search.
- Create with a missing title.
- Create with a wrong field type.

The two changes that got the rotation moving were both about **where a retry
starts** and **how much the model must invent**, not about the feedback wording:
- A retry starts from the attempt with the most passing tests so far.
- The task names the exact way tests should run the server.

## What changed, in order

Each change adds to everything above it. All of it is committed on
`pi-small-supervisor-research`. Every change is either a config field or a
task setting; the harness stays task-agnostic.

| # | change | why |
|---|---|---|
| 1 | `feedback: "minimal"`: a failed check tells the model only what failed and which command shows why. The scenario-id naming rule is gone; the check now counts tests. | Your call: the model runs the tests itself instead of guessing from a fragment. |
| 2 | Coding prompts carry only the task text and the current task: 5.4k characters instead of 8.5k. A task's scenarios are deduplicated. The agent's HOME is moved out of `/workspace`. `codingTools: ["bash", "edit"]`. In the roster, Spark's `reasoningBudget` drops from 2048 to 1024. | The plan repeated 23 of its 25 task-level scenarios verbatim, so T1 asked for 12 tests where 7 were distinct. Spark listed `/workspace` and read its own pi session file. Every model rewrote whole files with heredocs to change one line. Every Spark turn used the whole 2048-token budget, about 3 minutes a turn. |
| 3 | `retryWorkspace: "reset"`: a retry starts from the step's own start, with no feedback. | In iterations 1–2 every model inherited the previous model's broken design and none repaired it. |
| 4 | `retryWorkspace: "best"`: a retry starts from the attempt with the most passing tests so far, and is told only that attempt's verdict. | "reset" threw away Spark's 3 of 7. |
| 5a | A books-api convention in `task.json`: `app.py` exposes `make_server(port)`, and tests run it on port 0 in a daemon thread. | Four iterations failed T1 mostly in test plumbing: ports, servers left running, hand-built suites. |
| 5b | `feedback: "focus"`: the verdict plus the name of one failing test, with no error text. | The rotation reached 5 of 7 and stalled on the same two failures. |
| 5c | `feedback: "failures"`: one line per failing test, with its last error line. | Run for one round as the comparison with focus. It stayed on for the rest of the night. |

## T1, iteration by iteration (tests passing out of 7, per attempt)

| # | Granite | Spark | LFM | MiniCPM | notes |
|---|---|---|---|---|---|
| 1 | 0 (1 test ran) | 0 | 0 | 0 | Everyone inherited Granite's file, which uses `unittest` without importing it. |
| 2 | 0 | 0 | 0 | — | Inherited a port scheme built on an attribute that is never set. |
| 3 | 0 | **3** | 0 | — | Reset: Spark's 3 was thrown away. |
| 4 | 0 (suite hung) | 0 (no tests) | 1 | 1 | |
| 5a | **4**, then **5** | 4 | 4 | 4 | Minimal feedback, starting from the best attempt. |
| 5b | 5 | 5 | 5 | 5 | Focus: nobody fixed the two remaining tests. |
| 5c | 5 | 5 | 5 | **7 ✓** | Failures: MiniCPM passed T1. |

Iteration 1 used an 8.5k-character prompt and 12 required tests. From
iteration 2 on, the prompt was 5.4k characters and 7 tests were required. The
first launch of iteration 4 was discarded; see "Infrastructure" below.

After T1, from iteration 5c's settings:
- **T2**: MiniCPM 8 of 9, then Granite 8 of 9, then Spark 9 of 9 ✓.
- **Integrate-T2**: ran nine attempts until the deadline. Most left the suite
  at 9 passing tests, one short of the 10 needed. Granite's attempts wrote 12
  and then 15 tests, but with failures, so neither beat the 9-of-9 attempt.

## Findings

- **Inheriting a failed attempt was the single biggest problem.** In
  iterations 1–2, every model after the first spent its turns reading and
  patching someone else's broken test harness, and none repaired it. Resetting
  lost real progress. Keeping the best attempt measured by passing tests is
  deterministic, adds no words to the prompt, and is what made the rotation
  climb: from 4 to 5 to 7 on T1, and from 8 to 9 on T2.
- **Most T1 failures were plumbing, not logic.** Before 5a, the tests had to
  start a server themselves "on a free port", and each model invented its own
  machinery: fixed ports, subprocesses, suites built by hand, servers left
  running. Naming one pattern in the task file took Granite from 0 to 4 of 7
  on its first attempt. This is task configuration, not harness logic, and it
  is exactly the kind of "robust, directed" information you allowed for.
- **The feedback wording mattered less than expected, and the one difference
  goes against the minimal hypothesis.** With the workspace stuck at 5 of 7:
  - minimal feedback: a full round with no progress;
  - focus (naming one failing test): a full round with no progress;
  - failures (each failing test with its last error line): MiniCPM passed T1
    on the fourth attempt of its round.
  That is a single success, so it is weak evidence. It does not show that
  error lines make models over-confident. From the check reports alone the two
  remaining failures had obvious causes (an error message that didn't name the
  field, and a `PUT` route that compared the path to `/books`). Seeing the
  error line may simply have saved the turns otherwise spent finding it.
- **Turns go to re-orientation.** A fresh session on inherited files typically
  spends 3–6 of its 10 turns on `ls`, `cat` and a first test run before it
  changes anything. Across iteration 5, most sessions ended at the turn limit
  or the time limit, not by giving up.
- **Early endings.** Several LFM and MiniCPM sessions ended after 3–5 turns
  with turns to spare. The last response hit the 4096-token output cap, or
  errored, without making a tool call. That ends a pi session, and the rotation
  simply moved on.
- **Weakness in the "best" measure.** It counts passing tests, so an
  integration attempt that adds tests but breaks one scores no higher than one
  that adds nothing. Both of Granite's 12- and 15-test attempts at
  integrate-T2 lost to the 9-of-9 workspace.
- **The bash default timeout triggered 3 times in 231 calls.** The command
  after each hint was a different one, never a re-run of the timed-out
  command. Nothing that timed out overnight was a legitimate long job. The
  hint is now wrapped in `<harness-note>` tags, which ships from the next run.

## Infrastructure problems found and fixed

- **A stray llama-server.**
  - Stopping a run while `serve.mjs` was loading the next model left that
    server running, untracked.
  - On Windows a second llama-server can listen on the same port. As a result,
    a Granite session was served by a leftover MiniCPM.
  - `serve.mjs` printed "ready", and its sampler check passed because the two
    models' roster samplers are identical.
  - Iteration 4's first launch was discarded (`workflow-runs/overnight-4-invalid-stray-server`).
  - Fixed: `serve.mjs` now refuses when the port answers as another model
    (exit 4), and `workflow-overnight-stop.sh` on the laptop kills every
    llama-server.
  - A second server of the same model is invisible to that check. The stop
    script is the only guard against it; it happened once more, and I killed
    it by hand.
- `serve.mjs --stop` reported "nothing to stop" while a server it had started
  was still running: its pidfile only tracks the last start.
- The retry wording for integration steps was wrong: "9 tests ran, but there
  are 10 scenarios", where the tenth test is the integration test. It now
  reads "at least 10 are needed (one per scenario so far, plus the integration
  tests this step asks for)".

## Not done / open

- The proxy architecture (`71b788f`) is still untested on the laptop. The
  overnight runs used the existing runner, patched in place (the agent's HOME
  and the workspace snapshots). The originals are in `pi-small/.bak-pre-replay/`.
- The shared plan's scenario S7 contradicts the task text (404 against 400),
  and that costs a grader check. Validating plans against the task text is not
  something the harness does.
- The "best" measure could prefer, on a tie, an attempt that runs more tests,
  which would matter for integration steps.
- Reading transcripts is limited on my side. A safety filter
  (`reasoning_extraction`) stops my replies when they include the models'
  reasoning, so the analysis here uses counts and the harness's own logs, not
  quoted transcript text.
- Nothing is pushed. Every commit is local on `pi-small-supervisor-research`.
