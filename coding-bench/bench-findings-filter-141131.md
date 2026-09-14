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

This matters most for Nanbeige, which was moved to `q8_0` KV specifically to
reach 16,384 (see `models-round4.conf`). It bought 6,144 tokens of window that
are reserved and never carry content. At `-c 12288` with f16 KV it would fit
(176 KiB/tok x 12288 = 2,112 MiB + 3,026 MiB weights = 5,138 MiB of 6,143) and
get a 7.7k working window. Worth measuring whether the 2.5k of extra working
window is worth the KV quantisation.

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

## 7. What to change

1. **Split the grade.** Report algorithm and packaging separately. One number
   hides the only difference between these three models.
2. **Raise the overhead factor to ~1.9x** (6.1), or budget on wall clock.
3. **Drop the injection component** (6.3) and spend the slot on a task that
   separates.
4. **Decide what the self-test is for.** It is currently the dominant cause of
   failure and it tests packaging, not problem-solving. Either keep it and say
   so explicitly, or grade the exported function and treat the self-test as a
   separate component.
5. **Re-measure Nanbeige at `-c 12288` with f16 KV** (6.2) before accepting
   `q8_0` KV as its configuration.
6. **Do not pick a winner from this round.** Spark leads on shipped output and
   has the best reasoning per token, but p=0.19 against Granite and 11 of 18
   components are coin flips. If a decision is needed now, Spark — on the
   strength of 0 packaging deaths and the cleanest debugging discipline, not on
   the score.
