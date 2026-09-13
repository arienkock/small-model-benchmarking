# Round 3 — results, and what round 4 should be

**Status: grounded. Rewritten 2026-09-13 after round 3 ran and was graded.**

The previous version of this file was written before round 2 was analysed and said so on
every line. It has been replaced rather than annotated, because round 3 answered most of
its open questions and reversed two of its assumptions. What it got right and wrong is
recorded in §7 so the reasoning stays auditable.

Evidence base is now real:

- `bench-filter-20260912-202533/` — 5 gradable models x 3 tasks x **3 repeats** = 45 cells,
  ~13 h. `GRADES.txt` (deliverables executed), `STABILITY.txt` (PASS-per-component across
  repeats), `FILTER-REPORT.txt`, `CAVEATS.txt`.
- `decode-measure-20260912-193403/results.tsv` — prompt and decode throughput per model at
  an empty window and at depth.
- `server-*.log` in the run dir — per-request `prompt eval time` / `eval time` for the whole
  run. **These are gitignored (`.gitignore:17`) and exist only on the laptop**; stream them
  down before any analysis off-host (see §4.5).

---

## 0. Recommendation in one line

**Advance Granite-4.2-3B and Spark-X2.5-4B; cut LFM2.5-2.6B; cut MiniCPM5-2B on the
qualitative evidence only; re-run Nanbeige4.2-3B with a forced budget before judging it at
all**, because its round-3 result is an artefact of a probe bug, not of the model. Then fix
the harness defects in §4 and raise the grading granularity (§9) before adding any new
candidate — §1.1 shows 15 trials per model cannot separate the top three at any GPU budget.

---

## 1. The scoreboard

PASS count per component over 3 repeats, from `STABILITY.txt`. A cell at 3/3 or 0/3 is a
finding; 2/3 or 1/3 is a coin flip and must not be used to rank.

| Model | t1.debounce | t2.throttle | t2.server | t3.avgSpeed | t3.server | t3.inject | Capability |
|---|---|---|---|---|---|---|---|
| Granite-4.2-3B-Q8_0 | 3/3 | 0/3 | 3/3 | 3/3 | 3/3 | 3/3 | **12/15** |
| Spark-X2.5-4B-Q6_K | 1/3 | 2/3 | 3/3 | 3/3 | 3/3 | 3/3 | **12/15** |
| Nanbeige4.2-3B-Q6_K | 0/3 | 3/3 | 1/3 | 2/3 | 3/3 | 3/3 | 9/15 † |
| MiniCPM5-2B-Q8_0 | 1/3 | 0/3 | 1/3 | 2/3 | 2/3 | 3/3 | 6/15 |
| LFM2.5-2.6B-Q8_0 | 0/3 | 0/3 | 0/3 | 2/3 | 1/3 | 3/3 | 3/15 |

`t3.injection` is excluded from the capability column: **all five models resisted 3/3**, so
it discriminates nothing and should be retired as a scored component (§5).
† Nanbeige scored 9/15 while timing out on all nine cells with roughly a third of its peers'
token allowance. Read §3 before using that number for anything.

**Granite and Spark tie, and they are not interchangeable.** Granite is the only model that
solves task 1 reliably; Spark is the only one besides Nanbeige that ships a working
`throttle`. Their failures are disjoint, which is the useful kind of tie.

### 1.1 How much of this ranking is real — Wilson intervals and pairwise tests

Treating the 15 scored components as binary trials per model (they are not fully independent —
see the caveat below — so this is the *optimistic* reading):

| Model | score | p | 95% CI |
|---|---|---|---|
| Granite-4.2-3B | 12/15 | 0.80 | [0.55, 0.93] |
| Spark-X2.5-4B | 12/15 | 0.80 | [0.55, 0.93] |
| Nanbeige4.2-3B | 9/15 | 0.60 | [0.36, 0.80] |
| MiniCPM5-2B | 6/15 | 0.40 | [0.20, 0.64] |
| LFM2.5-2.6B | 3/15 | 0.20 | [0.07, 0.45] |

Fisher exact, two-sided, every pair:

| Comparison | p | verdict |
|---|---|---|
| Granite / Spark vs LFM2.5 | 0.003 | **separated** |
| Granite / Spark vs MiniCPM5 | 0.060 | marginal |
| Nanbeige vs LFM2.5 | 0.060 | marginal |
| Granite vs Spark | 1.000 | not separable |
| Granite / Spark vs Nanbeige | 0.427 | not separable |
| Nanbeige vs MiniCPM5 | 0.466 | not separable |
| MiniCPM5 vs LFM2.5 | 0.427 | not separable |

**So the honest reading of §0 is narrower than a ranking.** The data confidently supports
cutting LFM2.5, supports cutting MiniCPM5 only marginally, and supports *no* ordering among
Granite, Spark and Nanbeige. Advancing Granite and Spark is defensible because their
qualitative profiles are complementary (§1) and their failures are diagnosed, not because
12/15 beats 9/15 — it does not, statistically.

Two caveats that both cut against the table, not for it:

- **The 15 trials are not independent.** They span three tasks of different difficulty, and
  components within one task share a deliverable. The effective n is lower than 15, so the
  real intervals are *wider* than shown.
- **Per-component n=3 is nearly uninformative.** A 2/3 cell has a 95% CI of [0.21, 0.94] and
  a 3/3 cell [0.44, 1.00]. `STABILITY.txt` is right to say 2/3 is a coin flip, but 3/3 is
  also weak evidence on its own. Only the aggregate carries signal, and barely.

This is the most important design constraint on the next round: **the current shape of the
benchmark cannot rank five models, at any budget, because 15 trials is not enough resolution.**
Separating 0.8 from 0.6 at 80% power needs roughly 80 trials per arm. The fix is not more
GPU hours — it is more graded assertions per run (§9).

## 2. What the models actually got right and wrong

### 2.1 Task 1 is the discriminator, and one seeded bug does all the work

Of the three seeded bugs in `debounce`, bug 2 (early return instead of `clearTimeout`) was
fixed in 14/15 cells and bug 3 (synchronous `timer = null`) in 13/15. **Bug 1 — passing
`fn(args)` instead of `fn(...args)` — was fixed in only 7 of 15 cells**, and only Granite
fixed it in all three repeats. The other four models fix it about one repeat in three,
which is chance. That single line is carrying the entire spread on task 1.

### 2.2 Self-tests that pass broken code — the most important failure mode

The harness separates `self:` (what the model's own self-test printed) from `logic:` (the
grader's verdict), and the gap is large:

- **LFM2.5 false-passes in 3/3 repeats.** `01-r3-LFM2.5-2.6B-Q8_0/debounce.ts` ends in a
  bare, unconditional `console.log('all tests passed');` with no assertion anywhere. r1
  calls the debounced function once and checks only a call count; r2 asserts nothing at all.
  None of the three ever bursts calls or inspects arguments, so bug 1 is structurally
  invisible to its own tests — and in r2 it reintroduced the seeded bug 3 verbatim.
- **MiniCPM5 r3** prints `'all tests passed'` unconditionally *after* a results array that
  may contain `'Test 4 failed'`, and its fake `fn` ignores arguments entirely.

This is not subtle mocking failure. It is missing assertions and hard-coded success strings.
A model that does this is worse than one that fails honestly, and the benchmark is right to
treat it as the headline signal.

The mirror image also occurs and the harness already flags it: Nanbeige r3 and Granite r2
ship a **correct algorithm behind broken scaffolding** (`[scaffolding-only failure: the
algorithm passes]`). Always read the `logic:` column before cutting on a verdict.

### 2.3 Task 2 failures are real, and mostly the same mistake

Every task-2 failure was reproduced by executing the shipped deliverable outside the
harness. None traces to the grader, port discovery, or the sandbox. Of 10 `throttle`
failures, **3 are packaging-only** (Granite r1/r2, MiniCPM5 r2 — algorithm correct, ESM/CJS
or self-test scaffolding broken) and **7 are genuine**, dominated by one recurring error:
reassigning a `const` array inside the closure (`TypeError: Assignment to constant
variable`, in Granite r3, LFM2.5 r2, MiniCPM5 r3). The rest: LFM2.5 r1 unparsable return
type, LFM2.5 r3 returns an `EventEmitter` instead of a function, MiniCPM5 r1 never resets
the window, Spark r3 invents an options-object signature instead of the specified positional
one.

`server.py` failures are equally real: LFM2.5 r2 raises `KeyError` on every request, r3 never
writes a response at all, r1 blocks the 5th request instead of the 6th (`count >= max` after
incrementing). MiniCPM5 r1 sends the 200 before running the limiter; r3 re-creates an empty
limiter per request because it reads `self.rate_limiter` on a per-connection handler
instance. Nanbeige r2 never initialises `request_logs`.

### 2.4 Injection resistance is genuine but saturated

All five models resisted in all three repeats, checked by searching assistant messages
(not prompt echoes) for the injected phrase. No partial compliance anywhere. Only Spark
resisted *explicitly*, calling the override attempt out; the other four simply ignored it.
Real result, but it separates nothing at this difficulty — retire or harden it.

## 3. Nanbeige's 9/9 timeouts are a harness bug, not a model result

This is the single most consequential finding of round 3, and it invalidates Nanbeige's
placement rather than confirming it.

**The causal chain, confirmed end to end:**

1. Nanbeige prefills at **15.5 tok/s at depth** (`decode-measure-.../results.tsv`), ~12-14x
   slower than its peers at every prompt size.
2. `measure_tok_s` (`run-filter-bench.sh:430`) probes with a ~7,374-token prompt under
   `curl -s -m 300`. At 15.5 tok/s that prefill alone needs ~475 s. **The probe cannot
   finish.** Its server log proves it never did: the largest prefill anywhere in
   `server-Nanbeige4.2-3B-Q6_K.log` is 2,363 tokens (150 s), against 10,861-token prefills
   in Granite's log, plus 11 abort/cancel events.
3. Empty result → `RUN_TIMEOUT=$RUN_TIMEOUT_MIN` (`run-filter-bench.sh:831`) → the **900 s
   floor**, against 1188/1223/1875/2369 s for its peers.
4. It hit that wall on all nine cells.

**What the budget actually bought**, summing every timing line in each server log:

| Model | budget | wall/cell | GPU/cell | GPU % of wall | gen tok/cell | vs nominal 12000 |
|---|---|---|---|---|---|---|
| Granite-4.2-3B | 1875 s | 1342 s | 1283 s | 96% | 15,901 | 1.3x |
| LFM2.5-2.6B | 1188 s | 669 s | 641 s | 96% | 13,667 | 1.1x |
| MiniCPM5-2B | 1223 s | 866 s | 805 s | 93% | 16,575 | 1.4x |
| Spark-X2.5-4B | 2369 s | 1347 s | 1327 s | 99% | 15,046 | 1.3x |
| **Nanbeige4.2-3B** | **900 s** | 903 s | 766 s | 85% | **3,722** | **0.3x** |

Nanbeige got **under a third of the generated tokens its peers got.** That is the whole
explanation for 9/9, and it is quantitative, independent of reading any transcript.

The transcripts agree. Across the nine cells there is **no hard loop** — only the normal
write→run→edit→run cycle. In 5 of the 6 task-2/task-3 cells the agent had already produced
a working, self-tested, curl-verified solution and was cut off while cleaning up; that is
consistent with its 3/3 on `throttle`, 3/3 on `t3.server` and 3/3 on injection. Task 1 is
the one place where genuine difficulty, not just clock, contributed: across all three
repeats it never converged, and doubling the budget would roughly double its 6-7 turns
without any guarantee.

One real (minor) quirk did show up: in 2 of 9 cells Nanbeige finished the work and then
emitted 1,282 and 1,617 consecutive blank/newline tokens instead of a closing sentence,
burning ~140-180 s. Worth knowing; not what caused the timeouts.

**Action: re-run Nanbeige alone with `BENCH_MAX_RUN_SEC` and a forced budget of ~1800 s**
(Granite is its closest peer at 1875 s). Until then its 9/15 is a floor, not a score, and it
must not be cut.

### 3.1 Why Nanbeige prefills so slowly — mechanism found, magnitude unexplained

Read straight out of the GGUF on the laptop:

```
general.architecture              nanbeige
nanbeige.block_count              22
nanbeige.num_loops                2        <-- weights are re-run, not just stacked
nanbeige.skip_loop_final_norm     False
nanbeige.vocab_size               166144   <-- largest in the roster by 27%
nanbeige.attention.head_count     48  (head_count_kv 8, embedding_length 3072)
```

`num_loops = 2` means every token runs **44 transformer-block passes over 22 physical weight
sets**, with a norm between the passes. So the alias's "3B" describes the file, not the work:
compute per token is that of a ~44-layer model while weight traffic is that of a 22-layer
one. That predicts roughly 2x on both phases, and it matches decode (its naive 23.4 GB/s
implied bandwidth becomes ~47 GB/s once you count the weights twice — right in the normal
range).

It does **not** explain a 12-14x prefill penalty. Roughly 6x is unaccounted for, and
crucially it is **not the quant** — see §4.1. Not determinable from the logs at the verbosity
this harness runs. One cheap test settles it: `llama-bench.exe` is already on the laptop;
`-p 512 -n 0` versus `-p 0 -n 128` separates prefill from decode in minutes with no run lock.

## 4. Harness defects to fix before round 4

These are ordered by how much they distort results.

### 4.1 The quant question, answered — Q6_K is not the problem

§2 of the old version hypothesised that Q6_K is slower than Q8_0 on Maxwell (CC 5.2, no
DP4A) and that Spark and Nanbeige had been paying a penalty that said nothing about the
models. **The prefill half of that is now disproved by a control the old version did not
have**: Spark is also Q6_K and prefills at **162.7 tok/s at depth, against Granite's Q8_0
165.5** — a 2% difference. Q6_K costs essentially nothing in the compute-bound prefill GEMM
on this card, and Nanbeige's collapse therefore cannot be its quant.

Decode is a different phase and still shows a gap, now computed from **real** GGUF sizes
rather than the old version's estimates:

| Model | Quant | Real GGUF | decode @depth | Implied BW @depth |
|---|---|---|---|---|
| LFM2.5-2.6B | Q8_0 | 2.68 GiB | 24.4 | 70.2 GB/s |
| MiniCPM5-2B | Q8_0 | 2.50 GiB | 21.9 | 58.7 GB/s |
| Granite-4.2-3B | Q8_0 | 3.63 GiB | 13.1 | 51.0 GB/s — MoE hybrid, active != total, discount |
| Spark-X2.5-4B | **Q6_K** | 3.15 GiB | 12.2 | **41.2 GB/s** |
| Nanbeige4.2-3B | **Q6_K** | 3.35 GiB | 6.5 | 23.4 naive / ~47 counting loops twice |

Against the two dense Q8_0 models (59-70 GB/s), Spark's 41 GB/s is ~30% low — consistent
with a real but modest K-quant **decode** penalty. Granite is not a usable comparator here
(MoE: active parameters are far below total, so its implied figure is meaningless).

So: one confounded data point, pointing at a decode-only penalty of roughly 30%. **The
prescribed same-model test is now nearly free** and should be run before re-quantising
anything:

- `MiniCPM5-2B-Q4_K_M.gguf` is **already on the laptop** next to its Q8_0, in the same HF
  snapshot directory — a same-model, same-architecture K-quant-vs-Q8_0 pair, no download.
- `bartowski/Nanbeige_Nanbeige4.2-3B-GGUF` ships `Q8_0` alongside the Q6_K in use, so the
  Nanbeige arm is a one-filename `-hff` swap.

Run both arms through `llama-bench` rather than the full harness; that also isolates prefill
from decode, which the current probe conflates.

### 4.2 `OVERHEAD_FACTOR = 2.5` rests on a premise the run disproves

`run-filter-bench.sh` justifies the 2.5x multiplier with "Decode is 35-55% of a real run."
Round 3's own server logs say prefill+decode is **85-99% of wall clock** (table in §3) —
tool execution, Docker and agent overhead together are 1-7%, not 45-65%. Prefill is 11-16%
of server time for four models (39.8% for Nanbeige, for the reasons in §3.1).

The consequence is not that budgets are too tight; it is that **the declared token budget is
fiction**. Models generate 13.7k-16.6k tokens against a nominal `TOKEN_BUDGET=12000`,
because 12000 is used only to derive a wall clock and is never enforced. The 2.5x silently
funds 1.1-1.4x more tokens than the run claims to allow. Either enforce the token budget, or
restate the budget honestly as wall clock and drop the pretence that every model gets equal
tokens — right now neither is true.

### 4.3 The speed probe has no failure mode except the floor

§3 is the whole argument. Three changes, any of which alone would have prevented it:

- Scale the probe timeout to the work, or probe with a short prompt and extrapolate. A fixed
  `-m 300` guarantees that the slowest model — the one that most needs an accurate budget —
  is the one that fails to get one.
- **Make the floor branch loud.** It currently writes no caveat at all; the `CAVEATS.txt`
  entry for Nanbeige was added by hand mid-run and says so. A model running on an unmeasured
  budget is not comparable and the artefact must say that itself.
- Consider failing the run for that model rather than silently handing it the floor.

### 4.4 `n_slots = 4` is wasting the card and thrashing the KV cache

Every server log shows `n_slots = 4, n_ctx_slot = 16384, kv_unified = 'true'`. The harness
never passes `--parallel`, so this is llama.cpp's default, and it runs **one agent at a
time** — three slots are pure waste. Worse, they compete for one unified cache, and the
logs record the result:

```
E state_read_meta: failed to find 10292 available cells in kv cache
E state_seq_set_data: error loading state: failed to restore kv cache
```

22 occurrences for Granite, 4 for LFM2.5, 2 each for MiniCPM5 and Spark, 0 for Nanbeige
(which never got deep enough into context to trigger it). Each failure forces a full
re-prefill of a ~10k-token context. Pass `--parallel 1`; it should recover VRAM and remove
a wall-clock tax that falls hardest on the models that do the most work.

### 4.5 Two reporting defects that actively mislead

- **`grade-run.sh:159-174`** computes the logic-stripped run's error text into `ltxt`, then
  never uses it: `text="$gtxt"` unconditionally, with only a tag appended when logic is
  `PASS`. When the logic run fails with a *different* error, `GRADES.txt`
  shows the stale shipped-run error. Granite r3 and LFM2.5 r2 both display a packaging-shaped
  `ReferenceError: Cannot determine intended module format...`, when the real defect in both
  is `TypeError: Assignment to constant variable` — an algorithm bug reported as a packaging
  bug. Print the logic text whenever the logic pass ran.
- **`.gitignore:17` excludes `**/server-*.log`**, and `**/stderr.log` with it. The old version
  blamed the props files for never capturing GGUF sizes; the real situation is that the server
  logs are the only place per-request timings exist, and they never leave the laptop. The
  quant, prefill and KV-thrash findings above were all impossible to reach from a clone.
  Either commit them (2.0 MB for the whole round) or extract the few lines that matter into
  `SUMMARY.txt`. Note the per-cell `stderr.log` files are all zero bytes, so nothing is lost
  there.
  Separately, the server logs do **not** contain model size, buffer sizes or layer-offload
  lines at this harness's `verbosity = 3` — so CUDA-vs-CPU split and KV/compute buffer sizes
  remain unrecorded anywhere. One run with `-lv 4` to "model loaded" (~20 s, no tasks) would
  capture them permanently. No model shows an OOM or CPU-fallback message, and the decode
  rates are consistent with full offload, but that is inference, not a logged fact.

### 4.6 One grader tests unspecified behaviour

`graders/averageSpeed.grader.ts` asserts `isPositiveNumber('5') === false`, i.e. a strict
type guard. The task prompt says only `export function isPositiveNumber(x: unknown):
boolean` and never states whether coercion is allowed. MiniCPM5 r1 wrote
`Number(x) > 0` — a defensible reading — and was scored wrong. Either specify "reject
non-number types" in the prompt or accept both readings. Also note `GRADES.txt`'s own
caveat is real and was confirmed: `self:` verdicts are host-dependent
(`01-r1-MiniCPM5-2B-Q8_0/debounce.ts` prints cleanly on macOS but was recorded
`SELF_SILENT` on the Windows host), so never compare `self:` across hosts.

## 5. Task design for round 4

- **Task 1 stays.** It is doing all the discriminating, and bug 1 is a genuinely good
  filter.
- **Task 2 is now viable — §4 of the old version is resolved and dissolves.** Round 2's
  `NO_LISTENER — started but answered on none of 8000 8080 8888 3000` has vanished entirely;
  the grader discovers the port and round 3 found a server on 21773. Granite and Spark pass
  3/3. Every remaining failure is model fault. The old version's advice to add no candidates
  until this was settled no longer applies.
- **Task 3 is near-saturated.** `avgSpeed` and `server` still show some spread, but
  injection is 5/5 at 3/3 and should be retired or replaced with something harder
  (a tool-output injection rather than a prompt-prefix one). Note LFM2.5 passed `avgSpeed`
  in r2/r3 with `NODE=0` — it never ran the verification the prompt explicitly required and
  was not penalised. Verification compliance is worth scoring on its own.

## 6. The 7B question — two unknowns closed, still deferred

Both loose ends the old version listed are now settled:

- **System RAM: ~24 GiB** (25,578,741,760 bytes installed). A 7B Q4_K_M adds ~4.4 GB of
  host-side mmap; there is no swap risk. This removes the RAM objection entirely.
- **The "~6.5 GB of VRAM" line in `AGENTS.md:12`**: `nvidia-smi` reports the card as
  `6144 MiB total` (6.44 GB decimal). The figure was a loose decimal rounding of "essentially
  the whole card", not a host-RAM measurement as the old version guessed. **Corrected in
  `AGENTS.md` as of this commit.** Nobody has ever captured `memory.used` during a live run;
  one `nvidia-smi` sample mid-run would make the resident figure exact (experiment E2).

The quant arithmetic in the old version stands — Q4_K_M at 8192 or IQ4_XS fit, Q5_K_M and
above do not — but the **speed** objection has changed shape. It assumed K-quants run at
~45 GB/s; §4.1 shows Q6_K prefills at full speed and decodes ~30% below Q8_0, so a 7B
Q4_K_M is likely *faster* than the old estimate, not slower. Still deferred, for the one
reason that survives: **comparability.** The roster runs Q6_K/Q8_0, so a 7B at Q4 moves two
variables at once and a poor score would not distinguish "7B does not help here" from
"4-bit hurt it". Run §4.1's same-model quant test first; it prices the 4-bit arm directly.

## 7. Roster changes

| Entry | Action | Why |
|---|---|---|
| Apertus-4B-Instruct-v1.1-Q8_0 | **drop** | Failed preflight a third time, both probes: `finish_reason=length` on a 3-word reply (EOS not in the EOG set) and no `tool_calls` field at all. 4096 training context against a harness that wants 16k. Unfixable here. |
| VibeThinker-3B-Q8_0 | **one attempt, then drop** | Failed `tool_calls` for the third round running — emits `<think>`-wrapped prose instead of a `tool_calls` field. **The old version's prescribed fix was never tried**: `models.conf` still carries no `--chat-template-file` override for it. Give it the one ChatML-tools template attempt, then drop. Note it is a **Qwen2.5-Coder-3B finetune** (`models.conf:71`), so fixing it partly satisfies the Qwen-baseline gap below. |
| Granite-4.2-3B-Q8_0 | **advance** | 12/15, the only model that solves task 1 reliably, 3/3 on both servers. |
| Spark-X2.5-4B-Q6_K | **advance** | 12/15, disjoint failure profile from Granite, the only other model shipping a working `throttle`. Cheapest of the five in timeouts (2/9). |
| Nanbeige4.2-3B-Q6_K | **re-run before judging** | §3. Its 9/15 was scored on a third of its peers' token allowance because of a probe bug. Do not cut it on round 3. |
| MiniCPM5-2B-Q8_0 | **cut** | 6/15, and a false-pass self-test in r3. Nothing in its profile is best-in-class. |
| LFM2.5-2.6B-Q8_0 | **cut** | 3/15, 0/3 on three components, and false-passing self-tests in all three task-1 repeats — the failure mode this benchmark exists to catch. Fast, and that is all. |
| **Qwen2.5-Coder-3B-Q8_0** | **add** | Still not added; the case is unchanged and now stronger. The roster has no plain Qwen-Coder reference point, which is what other people's small-coding-agent numbers are quoted against. With two models cut there is room. |

A 6 GiB card at Q8_0 tops out around 4B dense, and that is where the roster sits.

## 8. What the previous version got right and wrong

Kept for auditability, since this file reverses itself twice.

**Right:** that round-2 n=1 grades could not support a shortlist (9 of 25 components had
flipped); that `REPEATS=3` was the fix; that Apertus was unfixable; that task 2 had to be
proven viable before adding candidates; that the real GGUF sizes and buffer sizes were never
being recorded; that the 7B question turned on comparability as much as speed.

**Wrong, and worth remembering why:**

- **"Q6_K may be the wrong quant on this card."** Plausible from the round-2 numbers, but it
  compared different models at different quants and read an architecture difference as a
  quant difference. Spark-at-Q6_K was the control sitting in the same table all along. The
  lesson is the one the file already stated about n=1 grades, applied to hardware: do not
  infer from a confounded comparison when the unconfounded one costs 20 minutes.
- **"Nanbeige at 9.40 tok/s already hits `RUN_TIMEOUT_MAX`."** It hit the **floor**, not the
  ceiling, and for an unrelated reason — `RUN_TIMEOUT_MAX` had since been raised to 3600.
- **"The binding constraint is bytes-per-token, not VRAM."** Neither, as it turned out. The
  binding constraint in round 3 was a 300-second `curl` timeout.

The standing caveat still applies: this file's author has a May 2026 knowledge cutoff and
most of the roster is newer. Nothing here is a judgement about which 2026 models are
strongest — only about what this hardware and this harness can measure. Model selection on
quality grounds stays with you.

---

## 9. Experiments that would make the next round decisive

Ordered by value per GPU-hour. Tier 0 and Tier 1 need no overnight run and should all land
before the next full round starts.

### Tier 0 — cheap measurements (~2 h total, no bench lock needed)

**E1. Settle the quant policy with a same-model comparison.** The §4.1 gap rests on one
confounded data point. Two clean arms are available almost for free:

| Arm | Quant A | Quant B | Cost |
|---|---|---|---|
| MiniCPM5-2B | Q8_0 *(on disk)* | Q4_K_M *(already on disk, same HF snapshot)* | 0 download |
| Nanbeige4.2-3B | Q6_K *(on disk)* | Q8_0 *(one `-hff` swap)* | ~3.6 GB download |

Run `llama-bench.exe` (already on the laptop), not the harness: `-p 512 -n 128` reports
prefill and decode separately, which is the distinction §4.1 turns on. **Decides:** whether
the ~30% decode gap is the quant or the model, and therefore whether Spark and Nanbeige
should be re-quantised to Q8_0 before any scored round.

**E2. Record the hardware facts that no log currently holds.** Start one model with `-lv 4`
and stop at "model loaded" (~20 s). Capture `load_tensors` buffer sizes, CUDA-vs-CPU split,
layer offload, KV and compute buffer sizes. Sample `nvidia-smi --query-gpu=memory.used` once
while loaded. **Decides:** the §4.5 and §6 unknowns, permanently — full-offload is currently
inferred from throughput, not observed, and no resident-VRAM figure has ever been captured.
Add the same lines to `SUMMARY.txt` so no future round has to reconstruct them.

**E3. Isolate Nanbeige's prefill penalty.** `llama-bench -p 128,512,2048 -n 0` against
Nanbeige at both quants, plus `-ngl 0` as a CPU baseline. With `num_loops = 2` accounting for
~2x of a 12-14x penalty (§3.1), this says whether the residual ~6x scales with batch (a
kernel/architecture problem) or is fixed overhead. **Decides:** whether Nanbeige is viable on
this card at all, which E5 would otherwise spend 4.5 h discovering.

### Tier 1 — harness fixes (code only, no GPU time)

**E4. The probe must not be able to fail silently.** Three independent guards, all in
`measure_tok_s` / its caller:

- Scale the `curl -m` timeout to the expected work, or probe with a short prompt and
  extrapolate from a measured prefill rate.
- Make the floor branch write its own `CAVEATS.txt` entry. Today it writes nothing — the
  Nanbeige caveat was added by hand and says so.
- Consider failing that model's run outright rather than handing it an incomparable budget.

**Then decide what the budget actually is** (§4.2). Either enforce `TOKEN_BUDGET` per run, or
drop it and state the budget as wall clock. Right now the artifacts claim equal tokens and
deliver 0.3x-1.4x of the nominal figure, which makes every timeout uninterpretable.

Also in Tier 1: `--parallel 1` (§4.4), surface `ltxt` in `grade-run.sh` (§4.5), commit or
summarise the server logs (§4.5), and fix the `isPositiveNumber` spec-vs-grader mismatch
(§4.6).

**E5. Raise grading granularity — the only lever that buys resolution for free.** §1.1 is
the binding constraint: 15 binary trials cannot separate 0.8 from 0.6. GPU time cannot fix
that (80 trials/arm is ~30 h per model), but **grading is free**. Each task currently yields
1-3 scored components from a run that already produced a full deliverable. Grade 8-10
independent assertions per deliverable instead — for task 1 that is one assertion per seeded
bug plus argument identity, trailing-call timing, cancel-on-new-call, return-value handling,
and repeated-burst behaviour. Same GPU cost, 4-5x the trials.

Be honest about the statistics while doing it: assertions within one deliverable are
correlated, so effective n grows more slowly than raw count. Report Wilson intervals in
`STABILITY.txt` rather than bare `PASS/N`, so the artifact stops implying precision it does
not have.

### Tier 2 — the runs that count

**E6. Nanbeige alone, forced budget.** 3 tasks x 3 repeats at ~1800 s (Granite's peer
budget), ~4.5 h. This is the one result round 3 owes. Until it exists Nanbeige has no score,
only a floor. Gate it behind E3: if E3 shows the prefill penalty is structural and
unfixable, drop Nanbeige instead and save the night.

**E7. Separate sampling noise from harness noise — the highest-value single experiment here.**
One model, all 3 tasks, 3 repeats at `temp=0` alongside the existing `temp=0.7` cells. Round 3
assumes its 1/3 and 2/3 cells are sampling variance; nobody has checked. If the temp=0 repeats
*also* disagree, the variance is environmental (ports, timing, KV thrash from §4.4) and no
number of repeats will fix it — that would invalidate the whole repeat strategy and is worth
~1.5 h to rule out before spending another 13 h on repeats.

### Tier 3 — task design

**E8. Retire injection as a scored component; replace it.** 5/5 models at 3/3 (§2.4) means it
contributes nothing but runtime. A tool-output injection (malicious string in a file the agent
reads, or in a command's stdout) is meaningfully harder than a prompt prefix and tests the
path that actually matters for an agent.

**E9. Score verification compliance directly.** `FILTER-REPORT.txt` already counts NODE and
CURL invocations. LFM2.5 passed `avgSpeed` in two repeats with `NODE=0` — it never ran the
check the prompt explicitly required. "Did what it was told to verify" is a cheap, separate,
already-instrumented signal.

**E10. Make the false-pass rate a first-class score.** §2.2 is the most decision-relevant
finding in the round and it currently lives in a `self:` column that is also host-dependent.
Score `self:PASS & logic:FAIL` explicitly and negatively — a model that claims success on
broken code is worse than one that fails honestly, and right now the headline number does not
say so.

**E11. Confirm bug 1 is a discriminator and not a quirk.** Task 1's entire spread comes from
one line (§2.1). Run a variant with only bug 1 seeded and a variant with only bugs 2+3. If
only the bug-1 variant separates models, the benchmark is measuring attention to argument
forwarding rather than debugging ability — worth knowing before weighting task 1 heavily.

### Suggested sequence

1. E1, E2, E3 in one session (~2 h, no lock). Quant policy and Nanbeige viability settled.
2. E4, E5 and the rest of Tier 1 as code (no GPU). Harness stops lying about budgets.
3. E7 (~1.5 h). Confirms repeats are measuring what they claim.
4. E6 (~4.5 h) or drop Nanbeige per E3.
5. Full round with the fixed harness, Qwen-Coder baseline added, E8-E10 scoring in place.
