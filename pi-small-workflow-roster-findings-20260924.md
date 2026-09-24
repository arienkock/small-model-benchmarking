# The staged workflow harness on the small roster: first real runs (2026-09-24)

The question: can a harness that holds the process itself get a 2-4B model through
a coding task larger than the ones it fails on its own? The model plans, writes
tests per scenario, implements, and integrates, one small step at a time, each
checked deterministically. The harness is `pi-small/workflow/`; its design is in
[`pi-small/workflow/README.md`](pi-small/workflow/README.md).

**No model finished the task.** Every model's plan was accepted. Every model then
spent almost its whole time on the first implementation task. One run, Granite-4.2-3B
with a terse system prompt and low reasoning effort, got past it: it had the only
accepted implementation step of the day and the best grader score, 13 of 28. The
wall is implementation, not planning.

## The task and the setup

`workflow/tasks/books-api`: a Python standard-library-only REST API for books,
with create, read, update, delete, filtering by every field, `q` search, and
400/404 errors with JSON bodies. An independent black-box grader has 28 checks
and runs `app.py` over real HTTP. The model never sees it.

The workflow, each step a fresh pi-small session in the sandbox container:
1. Whole-task scenarios, happy and unhappy together.
2. A breakdown into ordered tasks.
3. A plan per task (its own scenarios plus the implementation logic).
4. Per task: implement, then integrate.

Each step ends with a submit tool the harness validates. The implementation
step's `report_done` only accepts once the harness's own check passes: every
scenario id appears in a test, the suite passes, and the task's checks pass.
Recovery policy, per step:
1. Nudge the same session, up to 2 times.
2. Then retry in a fresh session with the failure as feedback, up to 3 attempts.
3. Then stop.

A session could run 40 minutes; the test suite 300 s. The models ran one after
another, each with an equal share of the time left before 18:45 (`--deadline`).

## Results

| run | harness at the time | planning | tasks planned | furthest | impl. sessions (timed out) | grader |
|---|---|---|---:|---|---|---|
| Granite-4.2-3B, 1st | batched scenarios | 24.6 min | 3 | T1 not accepted | 2 (2) | server won't start |
| Spark-X2.5-4B | same | 46.1 min | 5 | T1 not accepted | 1 (1) | server won't start |
| LFM2.5-2.6B | + terse system prompt | 10.1 min | 3 | T1 not accepted | 6 (2) | server won't start |
| MiniCPM5-2B | same | 17.4 min | 4 | T1 not accepted | 4 (2) | **9/28** |
| **Granite-4.2-3B, 2nd** | + thinking at low effort | **8.5 min** | 2 | **T1 accepted**, stopped in T2 | 4 (3) | **13/28** |

The windows were 84-116 minutes per model. Each run ended "stopped" (time budget
used up), not "failed".

The grader scores what the workspace does, not what the harness accepted.
- MiniCPM's server passes 9 checks, although its T1 never passed the harness's check.
- The Granite rerun passes 13 checks:
  - create (201 with id and fields), the synopsis default with increasing ids,
    and get by id;
  - the 404s for an unknown id, an unknown path, and update or delete of an
    unknown id;
  - five of the six 400s on create;
  - ids not reused after a delete.

  It fails all listing and filtering, update, delete itself, a non-integer id in
  the path, and a client-supplied id.

## Planning works; implementation is the wall

**Every plan was accepted,** usually on the first attempt. Planning cost fell
sharply as the prompt changed. Granite went from 24.6 to 8.5 minutes with a terse
style plus low reasoning effort, run against run. The other rows mix two variables,
model and harness version, and can't be compared that way.

**Implementation ate the time.** 17 implementation sessions, 10 of them stopped at
the 40-minute limit. None was idle and none was a mechanical loop. Each model
fixed on one bug it could not see:

- **Granite, 1st run.** `os.environ.get('PORT', 8000)` returns a string, and
  `bind()` raises. The traceback went to the stderr of the server its tests
  started in the background, which it never read. It spent 60 minutes rewriting
  its tests.
- **LFM2.5.** `SyntaxError: name 'next_id' is used prior to global declaration`.
  About 69 turns and 50,000 output tokens in 52 minutes: re-reading, recompiling,
  clearing `__pycache__`, checking the Python version. The line never got fixed.
  After a nudge its suite went from 1 test to 10; the final attempt left 0.
- **MiniCPM5.** Tests that started a server and never stopped it, so the suite hung
  until the 300 s check timeout, every check. It also named tests in lowercase
  (`test_s1.py`) while the id check is case-sensitive. It fixed the whole-task ids
  by the end; the T1 ids were still missing.
- **Spark.** Out of time mid-T1 after a 46-minute plan of 5 tasks. The grader
  found a server that binds its port twice ("Address already in use").

**Fresh context beat long sessions.** Granite's rerun failed T1 in two full
40-minute sessions, then fixed it in 3 minutes on a fresh third attempt that was
given the failure as feedback.

## Where the time goes: generation, at normal speed

Measured on Granite's first run, from llama-server's own timing lines:

| | tokens | time | speed |
|---|---:|---:|---:|
| generation | 67,500 | 78 min | 14.4 t/s |
| prompt processing | 105,000 | 11 min | ~160 t/s |
| tool execution | — | < 1 min | — |

The generation speed matches the bench rounds: 14.9 t/s on 2026-09-12 and 14.5
on 2026-09-14. What changed is volume.
- **Planning** cost about 21,000 tokens, roughly one or two whole bench tasks.
  Each planning response was 2,400-4,600 tokens, 3-5 minutes each.
- **T1 took another ~45,000.**
- **For comparison,** in the bench Granite finished each filter task in 4-31
  minutes; round 1's three tasks together took ~31,500 tokens.

Starting every step in a fresh session costs little: each step's first prompt
(~1,500-2,700 tokens) is processed from scratch in 10-20 s. That is 1.5-2 minutes
per run, against 78 minutes of generation.

## Harness changes made during the day

1. **Scenarios can be submitted in batches.** In the first attempt (09:59, aborted)
   Granite spent two full 4,096-token responses deliberating how to escape JSON
   request bodies inside the JSON of one large tool call, and never called it.
   Scenarios now accumulate over calls and finish on `done: true`. The planning
   prompts ask for short fields and single-quoted code.
2. **The harness became task-agnostic.** The language, test command, test files,
   dependency policy, grader and seed come from each task's `task.json`.
   Scenario-to-test traceability is a plain-text search, so it works in any
   language.
3. **A terse response style is appended** to every workflow session's system
   prompt.
4. **Granite's roster entry now declares its template's thinking mode.** Its
   template thinks by default (`enable_thinking` true) and reads
   `reasoning_effort`, where only "low" does anything. The roster had declared no
   mode, so pi-small sent only `--reasoning-budget 2048`, and every turn thought up
   to ~2,048 tokens with no switch in use. It now runs thinking on at low effort,
   via a new roster field `reasoningEffort`.

## What to change next

- **One process per run; retries always fresh.** Replace the container-per-step
  design with a single pi process that starts a new, empty session for every step
  and every retry, carrying the failure over as feedback. Same-session nudges go.
- **Shorter limits.** About 15-20 minutes per session instead of 40, and about
  60 s for the test suite instead of 300. Long sessions did not recover, and every
  hanging suite cost a full timeout.
- **Case-insensitive scenario ids.** MiniCPM lost much of its window to
  `test_s1` against `S1`.
- **Show server crash output** when a suite fails because the program under test
  did not start. That was Granite's first-run bug.
- **Scenario quality.** Granite's first run submitted 6 scenarios twice under new
  titles, and the title-based duplicate check let them through. Its breakdown also
  omitted update entirely, because the validator only checks that scenarios are
  covered, not the task's requirements.
- **Scenarios are proved only by name.** The harness checks that a test carrying
  each scenario id exists and the suite passes, not that the test does what the
  scenario says. The independent grader is what measures behaviour.
  Harness-executable scenarios, such as a command plus its expected output, would
  close that gap.

## Caveats

One run per model; three harness versions across the day; runs cut off at a fixed
time rather than at completion. These are observations about failure modes and
costs, not a ranking of models.

## Where things are

- **Harness and tests:** `pi-small/workflow/`, `pi-small/lib/workflow*.ts`,
  `pi-small/test/workflow-*.ts` (commit `0ddd4cb`, branch
  `pi-small-supervisor-research`).
- **Run data (on the laptop, uncommitted):**
  - `/d/llama.cpp/pi-small/workflow-runs/roster-20260924-095928`: Granite's
    aborted first attempt;
  - `roster-20260924-101641`: Granite and Spark;
  - `roster-20260924-131050`: LFM, MiniCPM and the Granite rerun.

  Each run directory has `state.json`, `spec.md`, `events.jsonl`, the steps with
  their prompts, check reports and session logs, `grade.json`, and the workspace.
- **llama-server logs:** `/d/llama.cpp/pi-small/.logs/`.
