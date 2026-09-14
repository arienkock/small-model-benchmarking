# Round 4 findings — `bench-filter-20260913-141131`

3 models x 3 tasks x 4 repeats = 36 cells, 24 graded components per model.
Roster and per-model setup rationale: `models-round4.conf`. Grades are in
`GRADES.txt` (produced by executing every deliverable), triage signals in
`FILTER-REPORT.txt`, per-component repeat stability in `STABILITY.txt`.

Round 4's numbers are not comparable to round 3's — the harness defaults changed.

## 1. The scoreboard, and why it does not settle anything

Shipped-deliverable pass rate, injection row excluded (all three resisted 4/4,
so it carries no information):

| model | shipped pass |
|---|---|
| Spark-X2.5-4B-Q6_K | 15/20 (75%) |
| Nanbeige4.2-3B-Q6_K | 12/20 (60%) |
| Granite-4.2-3B-Q8_0 | 10/20 (50%) |

Fisher exact on every pair:

| pair | p |
|---|---|
| Granite vs Spark | 0.191 |
| Nanbeige vs Spark | 0.501 |
| Granite vs Nanbeige | 0.751 |

Doubling the repeats did not break the three-way tie round 3 identified. Spark
leads and is the least bad bet, but the result is not significant and
`STABILITY.txt` flags 11 of 18 components as coin flips. Do not treat 75% vs
50% as a real gap on this evidence.

## 2. The gap that does exist is packaging, not reasoning

`GRADES.txt` carries a `logic:` column — the same grader run against the
deliverable with the model's own self-test block stripped out. Scored on the
algorithm alone, the .ts deliverables are a dead heat:

| model | algorithm correct (logic-only) | shipped working |
|---|---|---|
| Granite | 8/12 | 4/12 |
| Nanbeige | 8/12 | 7/12 |
| Spark | 8/12 | 8/12 |

All three write a correct algorithm exactly 8 times out of 12. All three have
exactly 3 real logic bugs and 1 missing/unloadable deliverable. **The entire
spread in the shipped score is the "algorithm is right, the file will not
load" column: Granite 4, Nanbeige 1, Spark 0.**

Granite's `t2.throttle` 0/4 is the clearest case. Three of its four throttle
implementations are correct sliding-window code. What killed them:

- `02-r1`: guard is `if (import.meta.globEager && typeof import !== 'undefined' && ...)`
  — a Vite API that does not exist in Node, and `typeof import` is a syntax
  error. The file also ships the model's deliberation as comments
  ("Actually, let's just...", "Let me just export the function cleanly").
- `02-r2`: `const timestamps = []` followed by `timestamps = timestamps.filter(...)`
  — assignment to a `const`, a hard parse error.
- `02-r3`: the one genuine logic bug — `const windowStart = 0` never advances,
  so `now - windowStart > windowMs` is always true, the counter resets on every
  call and the throttle never throttles (grader: 10 calls in a window of 3).
- `02-r4`: `require('fs')` in an ESM `.ts` — "both require() and top-level
  await are present".

Module-format confusion is almost entirely a Granite trait: 5 of the 7
deliverables in the run that mix `require()`, `__filename`, `module.exports` or
`import.meta.main` into an ESM `.ts` are Granite's.

The prompt asks for a self-test in the file. That instruction is what is
failing Granite, not the coding task.

## 3. The false pass is still live

`01-r2-Granite`: signed off with "the debounce implementation is complete and
passes all tests". Its own self-test printed a pass. The grader: `LOGIC_FAIL`,
`self:SELF_PASS`. It shipped `fn(args)` instead of `fn(...args)` and wrote a
self-test that never checks the arguments. This is exactly the failure the
objective grader exists to catch, and round 4 still produced it.

## 4. Seeded-bug coverage on task 1

The original `debounce.ts` has three defects. Every delivered file fixed the
missing `clearTimeout`. The discriminator is the argument spread:

| model | `fn(...args)` correct |
|---|---|
| Granite | 3/4 |
| Spark | 2/4 (+1 no file) |
| Nanbeige | 1/4 |

Failing to spread is worth calling out because two models watched it happen and
did not see it. `01-r3-Spark` ran two debug scripts that printed the callback
receiving `[["d"]]` instead of `["d"]`, twice, and spent 26k characters of
reasoning without connecting the nesting to the missing `...`.

## 5. Struggles worth reading in full

### 5.1 Nanbeige `02-r1` — a corrupted identifier it could not escape

Nanbeige emitted `WINDOWCESTARS` where it meant `WINDOW_SECONDS`, noticed it
immediately, and then could not get rid of it. Over 21 tool calls it rewrote
the file eight times through four different mechanisms — the `write` tool, a
quoted heredoc, a `python3 -c` string, a Python list-of-lines — and reproduced
a corrupted spelling every single time. It then blamed the tools ("the write
tool seems to be modifying my content", "the edit tool seems confused", "sed
didn't work because the text might have different encoding").

The trap closed because the corruption drifted: the surviving token is
`WINDOCESTARS` (no `W` after `WINDO`), so its `grep -n "WINDOW"` returned only
the healthy line 7 and its `sed s/WINDOWCESTARS/` matched nothing. It confirmed
a clean file twice with tooling that structurally could not see the defect. It
finally saw the real spelling on its last tool call, with no budget left.
`throttle.ts` was never written.

114 occurrences in that one cell, zero anywhere else in the run, across any
model. Not a systematic quant defect — a single-context attractor that, once in
the window, was copied forward by every regeneration.

### 5.2 Nanbeige `03-r2` — a shell-quoting error that shipped as a code defect

The full chain:

1. Ran `curl http://.../api/average-speed?distance=240&hours=5` unquoted. Bash
   splits on `&`, so the server received `?distance=240` and `hours=5` ran as a
   separate command. The server correctly returned 400.
2. Spent ~20 tool calls hunting a server bug that did not exist, including
   `python3 -c` repros of `parse_qs` and `float()` that both worked fine.
3. Added a `_debug()` helper writing to a hardcoded `/workspace/debug_log.txt`.
4. Read its own debug output, saw `hours_str=None`, and correctly concluded the
   query string was being truncated — but attributed it to curl, not to bash.
5. Proved the server worked by calling it with `urllib.request`
   (`{'average_speed': 48.0}`, and 400 on `hours=0`). Correct diagnosis, wrong
   cause.
6. "Fixed" the invocation with `curl --data-urlencode`, which turns the GET
   into a POST. The server answered 501.
7. Shipped the file with the debug instrumentation still in it.

The grader copies `server.py` into a fresh directory where `/workspace` does
not exist. Every request raises `FileNotFoundError` in `_debug()` before it can
answer. Graded `server:FAIL (000)`. Reproduced locally — confirmed.

A shell-quoting mistake became a phantom bug hunt became debug scaffolding
became a hardcoded path became a failed deliverable. The task code was never
wrong.

The unquoted-`&` pattern appears 10 times in Nanbeige cells and twice in Spark;
Granite never made it.

### 5.3 Granite `02-r3` — debugging blind, then chasing its own artifact

Started `python3 server.py &` with no stderr capture, so the crash was
invisible. Response to an unreachable server was to change the port — 8000,
then 8080, then 8888 — three times, without once reading an error. Only at tool
call 28 did it redirect to a log; the answer (`self.full_path` does not exist)
was in the first traceback it could have had at call 4.

Then, having fixed it, it ran one bare `curl` to confirm 200, and immediately
afterwards ran a 6-request test script. Requests 1–4 returned 200 and the 5th
returned 429 — because its own confirmation curl had already consumed a slot of
the 5-per-window limit. It concluded the rate limiter had an off-by-one, and
spent its last 4,573 characters of reasoning and its remaining budget on a bug
it had manufactured 3 tool calls earlier. 40 tool calls, exit 124.

### 5.4 Granite `03-r3` — the right answer, lost to malformed tool syntax

Found the real bug at tool call 34 (`parse_qs` returns lists; `float(['240'])`
raises, hence the 400). Its fix at call 35 was emitted with literal
`</function></tool_call><tool_call>...` text inside the `write` tool's `path`
argument — a second tool call nested inside the first one's arguments. The fix
never landed; the graded file is the debug version, and the grader saw exactly
what the model saw before its diagnosis: `valid=400 hours0=400`.

25 raw tool-syntax fragments in this one cell, zero in the other 35. Isolated,
but it cost a solved task.

### 5.5 Nanbeige `01-r4` — a working repro it never diffed against the file

Shipped a self-test whose callback logs `args`, a variable that is not in its
scope — a `ReferenceError` inside the timer, so `calls.push()` never ran. The
outer assertion also fired at `setTimeout(..., 0)` against a 50ms debounce, so
it was checking before the callback could have run either way.

At tool call 7 it wrote a minimal inline repro that worked perfectly and
concluded "the debounce logic is correct — the issue must be with something in
the self-test structure". It then rewrote the file three more times, each time
carrying the stray `args` forward, and never diffed the working repro against
the failing file. Five identical `node debounce.ts` invocations, same error.

### 5.6 Spark `01-r1` and `01-r2` — right reasoning, wrong budget

Spark's failure is not confusion, it is spend. Its reasoning quality is the
best in the round: in `01-r1` it recognised that its own two test cases were
mutually contradictory (one expecting accumulated arguments, one expecting only
the latest) and set out to reconcile them — the most sophisticated
self-correction anywhere in the run. It then hit the output token limit
mid-`edit`, four times.

`01-r2` is the extreme: 40,172 characters of reasoning across **two** tool
calls (`ls`, then `read prompt.txt` — a file already in its context). 5,506
output tokens per tool call. No `debounce.ts` was ever written. Graded MISSING.

Spark averages 1,033 output tokens per tool call against Granite's 465. At
13.03 tok/s that is ~80 seconds of wall clock per action taken.

## 6. Harness findings

### 6.1 The 1.35x overhead factor is too low

The budget rule is 12,000 generated tokens x 1.35, clamped to [900s, 3600s].
Measured overhead, wall-clock divided by (output tokens / measured decode
speed):

| model | median | min | max |
|---|---|---|---|
| Granite | 1.75x | 1.16x | 1.92x |
| Nanbeige | 1.57x | 1.06x | 2.47x |
| Spark | 1.52x | 1.04x | 2.39x |

Timed-out cells finished on ~8,500–10,000 generated tokens, not 12,000. The
missing time is prefill on a growing window plus tool execution — and the cells
that time out are precisely the ones doing many short tool calls, where the
factor is worst. Granite `02-r3` spent 528s of its 1,016s decoding; the other
48% was prefill and `sleep`s.

1.35x systematically shortens the runs that most need the budget. Raise it to
~1.9x, or budget on measured wall-clock rather than a token count.

### 6.2 The 16k context probe buys a 10.2k working window

Compaction is configured at `reserveTokens = 3/8 * ctx`, so it fires at 5/8 of
the window: 10,240 tokens of the probed 16,384. Measured trigger point across
43 compactions: median 10,511.

31 of 36 cells compacted at least once; many compacted two or three times.
Compaction is itself generated output charged against the budget:

| model | compactions | tokens spent summarising | share of nominal budget |
|---|---|---|---|
| Spark | 18 | 25,254 | 17.5% |
| Granite | 10 | 15,947 | 11.1% |
| Nanbeige | 15 | 12,714 | 8.8% |

Spark spent a sixth of its entire generation budget writing summaries of its
own context.

The 6,144 reserved tokens are the same for every model and never carry
content. The fix is not per-model context tuning — see 8.1, where the reserve
turns out to be set by `THINK_BUDGET`, not by the context probe.

### 6.3 Confirmed non-issues

- The per-model time budget does equalise generation: Granite 1,013s x 15.98,
  Spark 1,243s x 13.03 and Nanbeige 2,183s x 7.42 all come to ~16,190 tokens of
  decode. Exit 124 means "ran out of tokens", not "was slow". The round-3
  prefill cliff is gone — Nanbeige timed out 5/12, the fewest of the three.
- `server:FAIL` is a real code defect. `grade-run.sh` copies `server.py` into a
  fresh directory and starts its own instance, so a model that killed its
  server at the end is not penalised for it.
- Prompt injection (task 3) is fully saturated: 12/12 RESISTED. Only Spark
  named it explicitly ("the 'forget the task' instruction was a trap"). It
  costs a component slot and yields no signal — replace it with something
  discriminating.

## 7. Self-verification is already measurable, and it is the strongest signal here

Cross-tabulating "did the model ever execute the artifact it was graded on"
against the grade, over all 36 cells:

| | graded .ts passed |
|---|---|
| model executed that artifact at least once | **18/29 (62%)** |
| model never executed it | **1/7 (14%)** |

No other variable in this round separates that cleanly — not model, not task,
not repeat.

**It is coverage, not volume.** Granite ran the most verification commands of
any model and shipped the worst:

| model | verification commands | cells where it never ran the graded artifact | shipped .ts pass |
|---|---|---|---|
| Granite | 97 | 4 | 4/12 |
| Nanbeige | 72 | 2 | 7/12 |
| Spark | 48 | 1 | 8/12 |

All four of Granite's never-executed cells are failures (`02-r1`, `02-r4`,
`03-r4` LOAD_FAIL; `02-r3` LOGIC_FAIL). In three of four task-2 cells it ran
`node throttle.ts` zero times while curling the server 3-7 times. Task 2's
prompt carries two verification instructions — "a brief self-test that passes
when run with: node throttle.ts", then "Verify before finishing: curl /api/time
six times". Granite obeyed the second and dropped the first. Its `02-r3` logic
bug (`const windowStart = 0`) would have been caught instantly: the self-test
it wrote asserts `called === 3`, and it never ran it.

Granite also has the best red-to-green convergence in the round (32 red : 65
green, ends green in 11 of 12 cells). It verifies diligently, and it verifies
the wrong artifact.

### 7.1 Proposed measurement

Stop prescribing the mechanism. Replace both verification lines in each prompt
with one non-prescriptive line — "Before you finish, verify your work; how you
verify is up to you" — and drop the "prints 'all tests passed'" requirement.
The choice then becomes observable instead of dictated.

This costs the grader nothing. `grade-run.sh` already imports the exported
function and tests it independently, and already computes the `logic:` column
with the model's own test block stripped. It never depended on the model's
self-test to decide the grade.

Four components, all derivable from the transcript plus the existing grader:

1. **Coverage** (binary, per graded artifact) — did any executed command load
   this artifact? Not just a basename match on the command line: also count a
   command that executes a file which imports the artifact, so a model that
   writes `test_throttle.ts` gets credit. This is the predictive one.
2. **Mechanism** (categorical, unscored) — in-file self-test / separate test
   file / ad-hoc one-liner / manual probe / none. Descriptive. This is the
   "choice is itself signal" part; scoring it would just re-impose a preference.
3. **Detection** (binary, scored only where the grader says FAIL) — did the
   model's own verification go red on the defect the grader later found? This
   splits "never looked" from "looked and misread", which round 4 shows are
   different failures: Granite `02-r1` never looked; Nanbeige `01-r4` ran the
   same check five times, watched it fail five times, and misread it every time.
4. **Correction** (ratio) — red check, then an edit, then the same check green.
   Measures acting on a failing signal rather than producing one.

Keep the existing false-pass counter (`self:SELF_PASS` + `LOGIC_FAIL`) as a
fifth line; `01-r2-Granite` produced one this round.

## 8. Withdrawn: re-measuring Nanbeige at `-c 12288` with f16 KV

An earlier draft of this document proposed this. It should not be run.

The implicit hypothesis was that `q8_0` KV might be degrading Nanbeige — it is
the only model in the roster with a quantised cache, and two of its results
look like the kind of damage that would cause (1/4 on the argument-spread bug,
and the corrupted identifier in 5.1 that it could not copy correctly from its
own context).

That does not hold. The corruption first appears at **tool call #2, at a
context depth of ~729 input tokens**. At that depth f16 and `q8_0` KV are
indistinguishable; nothing has been evicted and almost nothing has been
quantised. It is a sampling artifact on a rare identifier at temp 0.7, not
cache damage.

With that gone there is no reason to re-run it, and `models-round4.conf`
already settled the general question deliberately: per-model setup is the
design, the benchmark ranks deployable configurations rather than bare weights,
and `q8_0` KV is Nanbeige's best deployable configuration. Arguing otherwise
without new evidence is re-litigating a decision the roster made on purpose.

### 8.1 What replaces it: one uniform knob, not a per-model re-measurement

The compaction tax in 6.2 is real, but it is not a context-window problem. The
numbers:

```
reserve = ctx * 3/8      = 6144      (compaction fires at ctx - reserve = 10240)
think   = min(ctx/4, THINK_BUDGET)
        = min(4096, 4096) = 4096
6144 = 4096 + 2048
```

The reserve is exactly the reasoning budget plus 2048 tokens of answer room.
The 10.2k working window is set by `THINK_BUDGET`, not by anything about
context. Measured per-turn reasoning across all 509 assistant turns:

| model | turns | median | p90 | max | turns > 3000 |
|---|---|---|---|---|---|
| Granite | 210 | 60 | 677 | 4524 | 4 |
| Nanbeige | 190 | 44 | 461 | 4120 | 2 |
| Spark | 109 | 82 | 3647 | 4160 | 16 |

Seven turns out of 509 exceeded 4000 reasoning tokens. Every model reserves
6144 tokens of window, permanently, for a per-turn allowance that 98% of turns
use under 700 of.

`THINK_BUDGET=2048` drops the reserve to 4096 (`ctx/4`) and moves the
compaction trigger from 10,240 to 12,288 — a 20% larger working window, one
knob, applied identically to all three models, no per-model confound
introduced.

The risk is Spark, which genuinely uses long reasoning (16 turns over 3000
tokens, against 6 for the other two combined). That risk is the experiment:
long reasoning is also Spark's documented failure mode (5.6 — 40,172 characters
of reasoning across two tool calls and no deliverable at all). Whether a lower
cap costs Spark its analytical edge or stops it talking itself out of shipping
is worth one smoke run to settle. Nothing else in the roster needs to change.

## 9. What to change

Items 1-3 are implemented; 4-6 are not.

1. **Split the grade.** [DONE] `grade-run.sh` now grades every module component
   twice and reports `<name>.algo` and `<name>.pkg` as separate verdicts, with
   a new per-model `SPLIT.txt`. Replaying round 4's own results through it gives
   ALGO 8/11 (+1 unknown) / 8/12 / 8/12 against PKG 7/12 / 8/12 / 11/12 and
   scaffolding deaths of 4 / 1 / 0 — i.e. the report now states section 2
   directly instead of burying it in a `logic:` field.
2. **Raise the overhead factor to 1.9x.** [DONE] `OVERHEAD_FACTOR` 1.35 -> 1.9
   in `run-filter-bench.sh`, still overridable with `BENCH_OVERHEAD`.
   Consequence: per-run budgets rise to Granite 1,427s, Spark 1,750s, Nanbeige
   3,073s, so a full 3x3x4 round goes from ~14.8h to ~20.8h worst case
   (round 4 actually spent 12.3h; same behaviour under the new budgets would be
   ~15.3h). **Set `BENCH_DEADLINE` for the next overnight run** — the deadline
   guard is the only thing that bounds this, and it is inactive when unset.
3. **Drop the injection component.** [DONE] The preamble is gone and the
   detector is gone from `grade_task3`. Superseded by §11: the whole of task 3
   has since been replaced, because the injection was not the only part of it
   that had stopped separating anything.
4. **[not done] Make verification a measured behaviour, not a dictated one** (7.1). Stop
   prescribing the mechanism; score coverage, detection and correction, and
   record the chosen mechanism without scoring it.
5. **[not done] Test `THINK_BUDGET=2048`** (8.1) in a smoke run before the next full
   round. Do not re-measure Nanbeige's context (8).
6. **[standing] Do not pick a winner from this round.** Spark leads on shipped output and
   has the best reasoning per token, but p=0.19 against Granite and 11 of 18
   components are coin flips. If a decision is needed now, Spark — on the
   strength of 0 packaging deaths and the best verification coverage, not on
   the score.

## 10. Round 3' — the roster for the next run

VibeThinker was dropped from round 4 without the attempt round 3 granted it.
`round3-recommendation.md:415` ruled "one attempt, then drop" — give it a
ChatML-tools template via `--chat-template-file`, then decide. `git log -S` over
`models.conf` shows its line was added once and its `server_args` column has
been empty ever since, so the attempt was never made. Its three failures to date
are all the same preflight failure (no tool-call channel in its template, so it
invents `<script type="text/json">{...}</script>` and pi drops every call) and
say nothing about its coding. In round 1 its debounce reasoning was largely
correct and never reached disk.

`models-round3prime.conf` gives it that attempt, pointed at the base model's own
Qwen2.5 tool-calling template (it is a Qwen2.5-Coder-3B finetune), alongside two
incumbents. `smoke-round3prime.sh` settles whether the template works before the
round starts; `round3prime.sh` runs it at 3 repeats.

### 10.1 Granite stays; Nanbeige is the model dropped

An earlier draft of this section dropped Granite on one number: round-4
deliverables breaking an ESM rule the system prompt states verbatim — Granite
8/12 (6 fatal), Nanbeige 1/12, Spark 0/12, Fisher p=0.0013 against Spark. The
number is right. Reading it as a fact about the model rather than about the
harness was wrong.

**What Granite actually does.** Of its five packaging deaths:

| cell | what happened |
|---|---|
| 02-r1, 02-r4, 03-r4 | never executed the artifact at all |
| 02-r2 | executed it, saw red, diagnosed it correctly ("the throttle.ts file needs fixing for ES module syntax"), ran out of budget mid-rewrite |
| 01-r1 | executed it **twice**, its own run printed "all tests passed", and the grader still failed it |

None is a case of seeing a red signal and ignoring it. Granite runs more
verification commands than either peer (97 vs Nanbeige 72, Spark 48) and has the
best red-to-green convergence in the round (32 red : 65 green, ending green in
11 of 12 cells). Its algorithm score ties at 8/12 and it is the best of the
three at the seeded bug the benchmark was built around (3/4 on the argument
spread, vs Spark 2/4, Nanbeige 1/4).

**01-r1 is the harness's fault outright.** The file ships
`if (import.meta.main || process.argv[1] === __filename)`. Run directly,
`import.meta.main` short-circuits the `||` and it prints "all tests passed";
imported, it evaluates `__filename` and throws. The model verified exactly as
the prompt instructed (`node debounce.ts`) and **the prescribed check is
structurally blind to the defect the grader tests for**. Reproduced directly.

**And "a targeted fix already failed" does not survive either.** What round 2
applied was a *sentence in the system prompt*. The harness's strong instrument
was never pointed at this class: `bench-guard.ts` blocks a forbidden action
inline with the correction in hand, and across every round **13 of 13 guard
blocks were followed by a different action** — no model has ever retried a
blocked one. The weakest available intervention was tried; the strongest was
never tried. Dropping a model for failing an intervention that was never made
is not a measurement.

**Both gaps are now closed** (§10.2), so round 3' measures Granite's coding
rather than its memory of a rule.

**Nanbeige goes instead, on grounds that are not about coding ability:**

1. **Cost.** 21,330s of round 4's 44,355s — 48% of the round for one of three
   models — and 3,073s per cell at 1.9x against Granite's 1,427s. Dropping it
   frees ~4.1h at 3 repeats, which is what pays for VibeThinker.
2. **Its retention was conditional and the condition is discharged.**
   `round3-recommendation.md:418` kept it explicitly: *"re-run before judging —
   its 9/15 was scored on a third of its peers' token allowance because of a
   probe bug. Do not cut it on round 3."* Round 4 was that re-run, on a measured
   budget, and it came out indistinguishable from both peers (p=0.50 vs Spark,
   p=0.75 vs Granite). The debt is paid and nothing emerged.
3. **No best-in-class axis, unlike the other two.** Granite: best at the seeded
   bug, most verification activity, best convergence. Spark: zero packaging
   deaths, zero rule violations, best shipped output. Nanbeige: worst on the
   seeded bug (1/4), middle everywhere else, half the speed, and the only model
   needing a config workaround to fit at all.
4. **Its failures are the ones no harness change reaches.** §5.2 (an unquoted
   `&` that became a phantom bug hunt and shipped as a hardcoded debug path) and
   §5.5 (a working repro it never diffed against the failing file) are reasoning
   and discipline, not packaging. There is nothing to hand it that would change
   the result, so another 9 cells at twice the price buys the least of the three.

Counter-argument, recorded because it is real: Nanbeige is the only model whose
deployable configuration this roster has actually tuned (q8_0 KV, measured
headroom), and cutting it leaves that work unused. If a third incumbent is
wanted later, it is the one to bring back.

### 10.2 The two harness fixes this implies

**Enforce the ESM rules, do not merely state them.** `bench-guard.ts` now blocks
a `write`/`edit` that introduces `require(`, `require.main`, `module.exports`,
`exports.x`, `__filename`/`__dirname`, or a named `assert` import **into a .ts
file**, with the exact correction in the block message. Replayed over round 4 it
catches 6 of Granite's 12 deliverables at write time, including 4 of its 5
packaging deaths, 1 of Nanbeige's and 0 of Spark's.

Three properties that make this a measurement rather than a concession:

- It only inspects text being *introduced*, so a model halfway through fixing a
  violation is never stuck behind it (tested).
- `.py` files are exempt — they are not ES modules (tested).
- Every block is counted per cell in `meta.txt` (`signal_guard_blocks`), so a
  model needing six corrections stays visibly different from one needing none.
  A silent killed deliverable becomes a counted, corrected one, which is
  strictly more information than a `LOAD_FAIL`.

This is consistent with the harness's existing position, not a new concession:
`run-filter-bench.sh:642` already calls the Node/ESM rules "environment facts,
not task hints… identical for every model, and they advantage none of them", and
the guard already enforces one such fact (no `npx`) by blocking.

**Tell models the module is imported, not only run.** One line added to the
system prompt: the module is also imported by a separate file, the exported
function is what is checked, and a file can run and still fail to import. This
closes the 01-r1 gap directly. It is a statement of fact about the harness, like
the rest of that block — not a hint about any task.

The residual risk is a model that loops against the new block instead of
adapting. The 13/13 record says it will not, but those were bash commands, not
writes. `smoke-round3prime.sh` uses the debounce task precisely because that is
where round 4 saw `require.main`/`__filename`, so the smoke run exercises it —
**if a model re-issues the same write after a block, the message is wrong and
must be fixed before the real round.**

### 10.3 Sizing

3 repeats, not 4 — this is a qualifying round, and 3 is what round 3 used. At
`OVERHEAD_FACTOR=1.9`: Granite 1,427s/cell, Spark 1,750s, VibeThinker ~1,629s
(estimated; it has no measured depth rate, and the harness measures it for
real). 9 cells each, **~12.0h worst case, ~10h expected**. `round3prime.sh`
refuses to start without `BENCH_DEADLINE` — at 1.9x the guard is the only bound.

Round 3' numbers are **not** comparable to round 4's for any model: the overhead
factor changed. That is why two incumbents run alongside VibeThinker rather than
comparing it against round 4's table.

## 11. The task list, and why task 3 is now a different task

**It has never changed.** `prompts-filter.txt` was created once, in `355c925`,
and the only edit since was removing the injection preamble. Rounds 1, 2, 3 and
4 all ran the same three tasks: suite T5 (debounce bugfix), T7 (rate limiter),
T12 (average speed).

Repetition is not itself the problem — these are static local weights with no
memory between runs, so there is no contamination, and repeats are how variance
gets beaten. **Saturation** is the problem: a task everyone passes tells you
nothing however many times it runs.

### 11.1 Which tasks still separate the current roster

Pass-count range across the three models, round 4:

| component | Granite | Nanbeige | Spark | range |
|---|---|---|---|---|
| t2.throttle.pkg | 1/4 | 3/4 | 4/4 | 3 |
| t1.debounce.algo | 3/4 | 1/4 | 1/4 | 2 |
| t2.server | 4/4 | 2/4 | 3/4 | 2 |
| t3.server | 2/4 | 3/4 | 4/4 | 2 |
| t1.debounce.pkg | 3/4 | 2/4 | 3/4 | 1 |
| t2.throttle.algo | 2/4 | 3/4 | 3/4 | 1 |
| **t3.avgSpeed.algo** | 3/4 | 4/4 | 4/4 | **1 — saturated** |
| **t3.avgSpeed.pkg** | 3/4 | 3/4 | 4/4 | **1 — saturated** |

By task: **t2 = 2.00, t1 = 1.50, t3 = 1.33**. Task 3 is the weakest, and its
`avgSpeed` half is effectively dead — the function is `distance / hours` rounded
to two decimals. What remained after the injection went was a saturated
arithmetic function plus a second HTTP server duplicating task 2's.

Worth recording: the original "three most discriminating" selection was made on
a **0-10 rubric over two models — LFM2.5 and MiniCPM5 — that have both since
been cut**, n=1 per task. The task list has never been validated against the
models actually being compared. T5 and T7 have held up anyway; T12 has not.

### 11.2 T12 out, T4 in

Task 3 is now suite **T4**, the books-server bugfix, with one deliberate edit
to its verification line (§11.4). Three reasons, in order of weight:

1. **Its seeded bug is invisible to shallow verification and visible to
   thorough verification.** Verified by running the unmodified server: plain
   `curl` returns 200 with valid JSON, so a model that checks the body sees a
   working server and stops. Only `curl -i`/`-v` shows there is no
   `Content-Length`. §7 found verification coverage to be the sharpest axis in
   the whole benchmark — 62% pass when a model executed the artifact it was
   graded on, 14% when it did not — but it could only be measured from the
   transcript after the fact. **T4 puts that axis into the grade itself.**
2. **It is the suite's only Python bugfix.** Round 4's worst cells across every
   model were Python server bugs (`self.full_path`, `parse_qs` returning lists,
   `self.connection.headers`). Until now those appeared only as self-inflicted
   damage inside a build task, confounded with the build. T4 isolates it: the
   bug is given, and finding it is the task.
3. **Cost-neutral.** Three tasks stay three tasks, so the round stays ~12h.

The honest counter-argument: on the original rubric T4 scored 4.0 vs 7.5 — a
spread of 3.5 against T12's 6.0 — so by the criterion that picked the current
list, T4 is the weaker task. That criterion was n=1 subjective scoring on two
models now cut, and T12's measured spread against the *current* roster has since
collapsed to 1. Measured discrimination on the models being compared is the
better guide.

### 11.3 Grading

T4 has one deliverable (`server.py`) and no TypeScript, so the algo/pkg split
does not apply. Rather than collapse it to one pass/fail, it is graded as three
independent components:

| component | checks |
|---|---|
| `books.status` | 200 on `/api/books`, 404 on an unknown path |
| `books.body` | valid JSON, both seeded books |
| `books.headers` | `Content-Type: application/json` **and** a correct `Content-Length` |

`status` and `body` are already correct in the buggy original, so they catch a
"fix" that broke something that worked. `headers` is the seeded bug. Tested
against three servers — the unmodified original (`headers:FAIL`, "no
Content-Length — the seeded bug"), a correct fix (all three PASS), and a
plausible half-fix with `Content-Length` off by one (`headers:FAIL`,
"Content-Length 111, body is 110").

### 11.4 The verification line: "and headers" deleted

The suite text ends *"confirm valid JSON with correct status and headers"*.
Those two words are deleted in `prompts-filter.txt`, so task 3 reads:

> Verify before finishing: run the server, curl /api/books, confirm valid JSON
> with correct status, then stop the server.

This changes what `books.headers` measures. With "and headers", the prompt hands
the model the bug and the component measures whether it does as it is told.
Without them, **the prompt names only checks that PASS on the buggy server** —
valid JSON, status 200 — so a model that verifies exactly what it was asked to
verify sees a healthy server. The component now measures whether the model reads
the code properly or looks beyond the instruction it was given.

It is not a trick: the task still says "find every bug that breaks or degrades
correct HTTP behavior", so the model is told a bug exists. Only the verification
line stops pointing at it.

`prompts-filter.txt` and `prompts.txt` now differ on this line **on purpose**.
Do not "restore" it.

### 11.5 Prediction, and the risk

The risk of removing the hint is that `books.headers` floors at 0/n for
everyone and discriminates in the opposite direction. Round 4 gives a prior
against that. No task in round 4 ever asked for `Content-Length`, so whether a
model set one in its own servers is spontaneous behaviour:

| model | servers setting Content-Length unprompted |
|---|---|
| Spark | 5/8 |
| Nanbeige | 3/8 |
| Granite | **0/8** |

A range of 5, wider than any component measured in round 4 (the best was 3). So
the component should separate rather than floor.

Note what that prior also predicts: **Granite is the model most likely to fail
it**, and for reasons that are *not* harness-amenable — this is a thoroughness
and knowledge gap, not an ESM packaging rule the guard can block. §10.1 argued
Granite stays because its round-4 failures were harness artefacts. If it goes
0/3 on `books.headers` in round 3', that is a real result and the argument for
keeping it does not cover it. That is the point of running the round.
