# The debounce task on Qwen3.6-35B and Qwen3.8-27B, thinking on (2026-09-23)

The 3-4B roster's hardest coding-bench task, given to the two strongest
beyond-VRAM models from
[`pi-small-verification-round-findings-20260922.md`](pi-small-verification-round-findings-20260922.md),
each running exactly as its vendor ships it: thinking on, no budget, the card's
thinking-mode sampler.

**Both passed on every measure the benchmark has.** The bench's own grader
passes each shipped file. Each self-test really runs and prints "all tests
passed". Both models named all three seeded bugs correctly.

The more useful finding is how they got there. **Both first drafts contained the
same class of mistake that sank the 3B models, and both fixed it from their own
test output.** Qwen3.6 wrote `require.main === module`, the exact ESM idiom that
cost Granite-3B all three of its deliverables in round 1, then read the
`ReferenceError` and rewrote the guard. Qwen3.8 left the seeded `fn(args)` bug in
its first draft, and its own self-test reported
`FAIL: test1: wrong args [[1,"two"],null]`. That is the verification step working
as intended, which Qwen3-Coder never managed in five attempts.

| | Qwen3.6-35B-A3B (MoE) | Qwen3.8-27B (dense) |
|---|---|---|
| bench grader, shipped file | **PASS** | **PASS** |
| bench grader, algorithm | **PASS** | **PASS** |
| own self-test (`node debounce.ts`, Linux/macOS) | **SELF_PASS** | **SELF_PASS** |
| own self-test on Windows | runs nothing, exits 0 (`SELF_SILENT`) | **SELF_PASS** |
| seeded bugs named in the explanation | 3 / 3 | 3 / 3 |
| first-draft defects caught by running it | 1 (`require.main` in ESM) | 2 (missing `async`; `fn(args)`) |
| tool calls / calls that ran the module | 5 / 2 | 10 / 7 |
| thinking (chars, session total) | ~4,900 | ~11,200 |
| generated tokens | 3,376 @ 10.4 t/s | 5,641 @ 1.20 t/s |
| server compute (% prompt) | 9.3 min (42%) | 82.2 min (4%) |
| **wall clock** | **16m40s** | **85m28s** |

n = 1 per model. The 3B rounds ran three or four repeats per model, so this is
two passes, not a pass rate. See *What this does not show* below.

## Why this task

`coding-bench` suite T5, filter task 1: fix a seeded-buggy `debounce.ts`, keep
the export, add a self-test that prints "all tests passed", and verify with
`node debounce.ts`. The prompt was read straight out of
`coding-bench/prompts-filter.txt` on the laptop, so it is exactly what the 3-4B
roster was given. The one difference is the trailing newline, which shell
command substitution strips.

It is the task those models did worst on:

- **Filter round 1: 0 of 7 produced a working `node debounce.ts`.** Most of that
  was ESM packaging trivia (`require.main === module`, `__filename`, a bad
  `node:assert` named import), not the algorithm. See
  [`coding-bench/bench-findings-filter-083544.md`](coding-bench/bench-findings-filter-083544.md) §1.
- **Round 4: `debounce.algo` was the lowest-passing component of the whole
  suite, 5 of 12** (Granite-3B 3/4, Nanbeige 1/4, Spark 1/4); see
  [`bench-findings-filter-141131.md`](coding-bench/bench-findings-filter-141131.md) §11.1.
- The most recent round in the repo (`bench-filter-20260914-203559`), regraded
  for this report with the same script: Granite-3B 3/3, Spark 2/3 on the
  algorithm. By the later rounds it was no longer a wall for the 3B models, but it
  stayed the task that separated them most.

The three seeded bugs, which `graders/debounce.grader.ts` tests one assertion
each:

1. an early `return` where `clearTimeout` belongs, so the call is never cancelled
   and the *first* args win;
2. `fn(args)` rather than `fn(...args)`, so the args arrive double-wrapped;
3. `timer = null` directly after `setTimeout`, synchronously, so the guard is dead
   code and nothing is ever debounced.

## Grading

Graded with the benchmark's own `coding-bench/grade-run.sh`, unchanged. The
pi-small workspaces were laid out in the `<task>-r<rep>-<model>/` shape it
expects, in a scratch copy. That is the same instrument as the 3B rounds, which
means it grades the **exported function by importing it**, not the model's claims
about it, and separately runs the model's own file to classify its self-test.

The Windows row is an extra check made for this report: each shipped file run
natively on the bench laptop (node 24.11.1, Git Bash).

## Settings: vendor default thinking, verified on the wire

What the user asked for, and what was checked on the live server rather than
assumed from `roster.json`:

- `--reasoning-budget -1`: unrestricted, which is both the vendor's default and
  llama.cpp's. Read off the running `llama-server` command line.
- No `--chat-template-kwargs enable_thinking:false`, so thinking is on.
- No `reasoning_effort` sent. The plugin declares `supportsReasoningEffort:
  false`, so each model thinks at its template's default depth.
- Reasoning preservation on, per the server log, which matches Qwen's
  `preserve_thinking` default.
- Sampler, each card's thinking-mode row, confirmed live via `/props` for Qwen3.8:

| | temp | top_p | top_k | min_p | presence | repeat |
|---|---:|---:|---:|---:|---:|---:|
| Qwen3.6 (general thinking row) | 1.0 | 0.95 | 20 | 0 | 1.5 | 1.0 |
| Qwen3.8 (thinking row) | 1.0 | 0.95 | 20 | 0 | 0.0 | 1.0 |

Two new roster aliases carry this: `Qwen3.6-35B-A3B-Thinking-Q4_K_M` (existing,
budget moved from 2048 to -1) and `Qwen3.8-27B-Thinking-UD-IQ4_XS` (new). Both
are the same weights as their non-thinking siblings.

Qwen3.6's card also has a separate row for "precise coding tasks (e.g. WebDev)":
temp 0.6, presence 0.0. Arguably that fits this task better. It was not used,
because the request was the vendor's *default*, and the general row is what
Qwen's `generation_config.json` ships.

**The one real ceiling is pi-small's, not the model's.** `RESPONSE_MAX_TOKENS` in
`extensions/small.ts` caps every response at 4096 tokens, thinking and answer
combined. The vendors' own evaluations allow up to 32k. A turn that thinks past
the cap is cut off with no answer. It never came close here: the longest single
turn in either run was **1,959 tokens** (Qwen3.8's first real turn, 25 minutes
long), and no turn ended at 4096. A harder task could hit it, though. The flat
cap and "unrestricted thinking" do not fully agree with each other.

## What the models actually did

Traced from pi's session records, call by call.

### Qwen3.6-35B-A3B: 5 tool calls, 16m40s

```
[call]   cat /workspace/debounce.ts           → No such file (the source was in the prompt)
[call]   cat > /workspace/debounce.ts <<EOF … (draft 1)
[call]   node /workspace/debounce.ts
[result] if (require.main === module) {
         ReferenceError: Cannot determine intended module format because both
         'require' and top-level await …
[call]   cat > /workspace/debounce.ts <<EOF … (draft 2: import.meta.url guard)
[call]   node /workspace/debounce.ts
[result] [PASS] delays execution  [PASS] passes latest arguments
         [PASS] cancels and resets timer  …  all tests passed
```

Its explanation is a clean three-row table naming each seeded bug and its fix.
The algorithm was right from draft 1, and only the packaging failed. That is
exactly Granite-3B's round-1 failure, except this model read the error and fixed
it.

Two weaknesses, neither of which the grader penalises on Linux:

- **The main-module guard is not portable.**
  `` import.meta.url === `file://${process.argv[1]}` `` builds a URL by string
  concatenation. On Windows `argv[1]` is `D:\…\debounce.ts`, so the comparison is
  false, the self-test silently never runs, and the file exits 0 with no output.
  Verified on the laptop. The bench scores that `SELF_SILENT`, and it is the
  failure mode the bench's `SELF_SILENT` class exists to catch: a self-test that
  claims nothing and checks nothing.
- One of its four self-tests, "returns distinct debounced functions", tests
  nothing about debouncing.

### Qwen3.8-27B: 10 tool calls, 7 of them running the module, 85m28s

```
[call]   node --version && pwd && ls -la                  (checks the environment first)
[call]   cat > /workspace/debounce.ts <<EOF … (draft 1)
[call]   node debounce.ts; echo "exit=$?"
[result] await sleep(10);  ^^^^^  SyntaxError — selfTest was not async
[call]   sed -i 's/^function selfTest() {$/async function selfTest() {/' debounce.ts
[call]   node debounce.ts; echo "exit=$?"
[result] FAIL: test1: wrong args [[1,"two"],null]  exit=1
[call]   node -e "…await import('./debounce.ts')… consumer test"
[result] consumer test failed: [ 3 ]  exit=1
[call]   sed -i 's/fn(args);/fn(...args);/' debounce.ts && node debounce.ts
[result] all tests passed  exit=0
[call]   node -e "…consumer smoke test…"
[result] consumer smoke test ok (fired once with latest args; no self-test output on import)
```

The second failure is the one that matters. Draft 1 had carried seeded bug 2,
`fn(args)`, straight through from the original. The model's own test caught it,
and so did an independent consumer test it wrote to import the module the way a
user would. It fixed the bug with a one-line `sed`. It also said so unprompted,
and accurately: "my initial draft inherited this from the original — the
self-test caught it immediately".

Things it did that no other run in either round did:

- **A portable main-module guard**,
  `import.meta.url === pathToFileURL(resolve(process.argv[1])).href`, which
  passes on Windows as well as Linux. It is the correct idiom, and the one the 3B
  models kept getting wrong.
- **An import smoke test.** It checked separately that importing the module
  prints nothing, i.e. that the self-test does not leak into consumers. That is
  a requirement the prompt only implies ("runs when the file is executed
  directly").
- Its explanation of bug 1 is the most precise of any run: the guard is "dead
  code — it could never observe a pending timer" because `timer = null` runs
  synchronously.

## Cost: thinking made this a generation-bound task, and that is the dense model's bad case

Yesterday's report found that the MoE and dense models finished the easy
word-frequency task **six seconds apart**, by opposite routes. The MoE model is
slow at prompt processing and fast at generation; the dense model is the reverse.
It predicted that "generation-heavy work — anything with thinking enabled —
favours the MoE models by a wide margin". This run is that case:

| | generated tokens | generation t/s | % of compute that was prompt | wall |
|---|---:|---:|---:|---:|
| Qwen3.6 (MoE) | 3,376 | 10.4 | 42% | 16m40s |
| Qwen3.8 (dense) | 5,641 | 1.20 | **4%** | **85m28s** |

With thinking on and a harder task, prompt processing (the dense model's
strength) fell to 4% of its compute. Generation at 1.2 t/s is everything. Qwen3.8
also generated 67% more tokens: more thinking (~11,200 chars against ~4,900) and
more tool calls. **So the same pair that tied yesterday is 5x apart here.**
Neither result says one architecture is faster in general. Which one wins depends
on the prompt-to-generation ratio of the work, and thinking pushes that ratio
hard towards generation.

## What this does not show

- **Two passes are not a pass rate.** The 3B rounds ran each model three or four
  times, and even Granite-3B, the best of them, failed the algorithm on some
  repeats. Qwen3.6 costs ~17 minutes per repeat, so three more would take under
  an hour. Qwen3.8 is ~1.5 hours each.
- **It does not isolate thinking.** Both runs had thinking on. The non-thinking
  aliases were not run on this task, so this does not say whether thinking is
  *why* they passed. Yesterday's evidence, on an easier task, is that it made no
  difference for Qwen3.6.
- **The harness is not identical to the 3B rounds.** They ran in `coding-bench`
  with its guard extension, its prompt file in the workspace, and its time budget.
  These ran in pi-small, which has no guard, gets the prompt as the pi argument,
  and uses a wall-clock timeout. The grader and the task text are the same; the
  scaffold around them is not.

## Harness notes

- `roster.json` (at the time of these runs): `Qwen3.6-35B-A3B-Thinking-Q4_K_M`
  had `reasoningBudget: -1`, up from 2048. The cap was never reached in the 2026-09-22 round (about 200
  thinking tokens per session), and -1 is the vendor default. There is a new
  `Qwen3.8-27B-Thinking-UD-IQ4_XS` alias. 28 checks green on both machines.
- The probes still ran with thinking on in these two runs. In Qwen3.8's log the
  first two completed requests (30 and 49 generated tokens) are the probes,
  costing 56 seconds between them. Since fixed: probes now run with thinking off
  and a configurable timeout (`PI_SMALL_PROBE_TIMEOUT`, default 600 s).
- **Aliases since consolidated (2026-09-23).** `Qwen3.6-35B-A3B-Thinking-Q4_K_M`
  and `Qwen3.8-27B-Thinking-UD-IQ4_XS` no longer exist. Thinking is now a
  per-model field, and each model carries both sampler rows. These two runs
  correspond to `Qwen3.6-35B-A3B-Q4_K_M` and `Qwen3.8-27B-UD-IQ4_XS` in their
  default mode (`thinking: "on"`), with the same budget and samplers.
- Artefacts on the laptop: `/d/tmp/debounce-20260923/` holds both workspaces with
  pi session records, per-run logs, `summary.log` and the exact `task.txt` sent.
  The runner is `/d/tmp/run-debounce.sh`. llama-server logs are under
  `pi-small/.logs/`.
- GPU free, no `llama-server` running, scheduled task deleted.
