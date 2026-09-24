# Can a small decision model supervise a 3B agent? A replay bake-off (2026-09-23)

The idea under test: a Jev-style decision model runs alongside a pi-small session and injects
short "capsules" when a requirement is not being met. It would check between turns for rules that
must always hold, and at yield for things that must be true at the end. The questions come either
from a fixed task-agnostic bank or from the 3B model itself, which writes falsifiable checks for
its own task in a separate session.

**Short answer: not with any judge this hardware can run.** The best judge, MiniCPM5-2B used as a
yes/no readout, separates failed runs from passed ones with **AUROC 0.78**, and that holds within
each model × task. But it scores *how the run went*, not the question it is asked: its answers to
six different questions correlate at 0.86–0.98. It flags **none of the 7 runs whose own self-test
passed while the grader found the logic wrong**, which is the failure a supervisor was meant to
catch. Between turns, every judge is noise: 5–10 capsules per session even with a per-criterion
cap, in a corpus with almost no real between-turn violations. The model-written checklists aim at
the right requirement in 75% of failing sessions, but mostly at the easy runtime ones, and half of
their shell commands fail on runs the grader passed.

Nothing here ran live. Every number comes from replaying 129 graded benchmark transcripts; see
*What this does not show*.

## What ran

| | |
|---|---|
| corpus | 129 graded filter-round runs from `coding-bench/bench-filter-*` (5 models; Apertus and VibeThinker dropped because neither can write a checklist). 74 FAIL, 55 PASS. 4 task prompts: debounce, throttle + rate-limited server, averageSpeed + server, books server. 1,911 turn boundaries. |
| labels | Run level: PASS only if every graded component passes, so a shipped file that does not load is a FAIL. Invariants: mechanical labels for G2 (input damaged), G4 (forbidden install) and G5 (loop), 26 positives corpus-wide; hand labels for G1 and G3 on 40 boundaries, written before any judge ran. |
| judges | **MiniCPM5-2B** and **Qwen3.5-4B** as readout judges: P(Yes) vs P(No) at the first answer token, asked in both option orders and averaged. **Kev-0.8B** and **Kev-4B** (jaredpalmer/kev). **Laya** (421M ModernBERT, 512-token window). OpenJev 27B needs an 80 GB GPU or Apple silicon; neither machine has one. |
| question source 1 | a fixed bank, written once: G1–G5 between turns, G6–G11 at yield (`pi-small/eval/supervisor/questions.py`) |
| question source 2 | each run's own model, served on its roster sampler, given only the task prompt, writes up to 10 `{scope, statement, command}` checks. 79 checklists. Every judge is scored on checklists k = 0–2 per model × task. |
| state conditions at yield | **T**: task + rendered transcript. **TE**: T plus evidence the supervisor gathers itself: the files read back, the last code command re-run, and each generated check's own command output. Commands run in `coding-bench-agent` with no network, a fresh workspace per command, and a 10 s limit. |

Tooling and traps: [`pi-small/eval/supervisor/README.md`](pi-small/eval/supervisor/README.md).

## Step 0: what a judge costs on this hardware

Measured on the laptop CPU (4-core i7-6820HK) while the GPU served a 3B model, since a live
supervisor would not get the GPU. The GPU model's generation speed did not drop: 17.9 t/s
throughout. Readout rows count both option orders.

| judge | state | new state | each further question | next turn (+1 turn) | a 6-question yield check |
|---|---|---:|---:|---:|---:|
| Qwen3.5-4B readout | ~1.9k tok | 178 s | 86 s | 144 s | **606 s** |
| Qwen3.5-4B readout, `-ub 128` | ~1.9k tok | 227 s | 32 s | 43 s | **385 s** |
| MiniCPM5-2B readout | ~1.9k tok | 66 s | 2.8 s | 15 s | **80 s** |
| MiniCPM5-2B readout | ~5.5k tok | 227 s | 4.7 s | 61 s | **250 s** |
| Kev-0.8B | ~1.9k tok | 18.5 s | 1.9 s | 19 s | **18.5 s** |
| Kev-0.8B | ~5.5k tok | 75 s | 3.7 s | 77 s | **75 s** |
| Kev-4B (bf16) | ~1.9k tok | 847 s | 59 s | 984 s | **847 s** |
| Laya | any | 18 s | 18 s | 18 s | **18 s** |

- **Qwen3.5 is a hybrid model,** so llama.cpp can only resume from checkpoints and re-processes
  about one micro-batch per question. `-ub 128` makes follow-up questions ~3× cheaper and the cold
  state slower.
- **MiniCPM5 reuses its cache fully,** so follow-up questions are nearly free, but every new
  turn's tokens cost 12–30 t/s.
- **Kev answers all questions in one pass but cannot reuse a grown state.**
- **Laya is flat** because it never reads more than 512 tokens.
- **Only Kev-0.8B and Laya are anywhere near every-turn speed.** An agent turn here takes 10–60 s.

Step 1 ran on the GTX 970M for throughput, not realism. MiniCPM5 did about 0.55 s per question
with 4 slots. Kev-0.8B took 2.4 s per 2k-token pass, but the Windows GPU watchdog (TDR, ~2 s per
kernel) kills it on states over ~4k tokens, so long states went to a CPU instance.

## Step 1a: at yield, does a capsule fire on the runs that failed?

A session's score is its highest violation probability; a capsule fires above 0.5. The generic
bank is one session per run. Generated checks are one session per (run, checklist), because a
live session would have exactly one checklist. TPR is the share of failing sessions fired on; FPR
the share of passing ones.

| judge | source | T: AUROC / TPR / FPR | TE: AUROC / TPR / FPR |
|---|---|---|---|
| **MiniCPM5-2B readout** | generic | 0.77 / 39% / 9% | **0.78** [0.70–0.86] / 43% / 9% |
| | generated | 0.77 / 39% / 8% | 0.78 / 61% / 18% |
| | both | 0.78 / 45% / 10% | 0.79 / 63% / 21% |
| **Kev-0.8B** | generic | 0.74 [0.65–0.83] / 61% / 16% | 0.74 / 51% / 16% |
| | generated | 0.65 / 53% / 31% | 0.62 / 53% / 41% |
| **Laya** | generic | 0.56 [0.45–0.66] / 26% / 11% | 0.56 / 5% / 2% |
| | generated | 0.55 / 15% / 10% | 0.57 / 45% / 38% |
| **Qwen3.5-4B readout** | generic, TE, 68 runs | — | 0.79 [0.67–0.90] / 79% / **60%** (MiniCPM5 on the same 68 runs: 0.77) |
| *no judge* | B2: re-run the last code command, exit ≠ 0 | 0.64 [0.56–0.72] / 53% / 25% | |
| *no judge* | B1: the model's own check commands, any exit ≠ 0 | 0.51 / 66% / 64% | |
| *trivial* | turn count / error outputs / in-sample model fail rate | 0.56 / 0.55 / 0.68 | |

Kev's TE condition shares the generic evidence across all questions and does not attach each
generated check's own command output. Per-check passes were over the watchdog limit and would
have fallen to the CPU at about a minute each. Kev-4B is not in Step 1: 14 minutes per check on
the only hardware that can hold it.

### The signal is real, but it answers the wrong question

- **It is not model or task recognition, for MiniCPM5.** Comparing only runs of the same model on
  the same task, MiniCPM5 still scores 0.78. Kev drops from 0.74 to 0.64 there, so part of Kev's
  signal is recognising which model or task a run is.
- **It is not one "run went well" question either; it is one score whatever the question.**
  Across runs, MiniCPM5's P(true) for G6–G11 correlates at **0.86–0.98** between questions that ask
  different things; Kev's at 0.81–0.92. G6, "every file the request asks for exists", predicts run
  failure (0.82) better than it predicts the runs where the grader actually found a file missing
  (0.71–0.78; Kev 0.49–0.57). Each judge is rating the session, and the question text barely
  moves the answer.
- **The failures it sees are the visible ones.** Seven failing runs passed their own self-test
  while the grader's test failed: LFM ×3, Granite ×2, Nanbeige, MiniCPM5. That is exactly the
  "reports success while wrong" case that motivated a supervisor. **With the generic bank, no judge
  fires on any of the 7, in either condition. Generated-check sessions fire on 0–3 of 20.** The
  AUROC above comes from runs that crashed, errored or left a dead server.
- **A bigger readout judge does not change this.** Qwen3.5-4B, on the 68 runs it covered, ranks
  runs no better than MiniCPM5 (0.79 vs 0.77). Its answers depend less on option order (6% flips
  against 17%), and its probabilities are badly calibrated: at 0.5 it fires on 60% of passing runs.
  The halo is the same (median correlation 0.88), and it flags 0 of the 4 self-test-passed-but-wrong
  runs in its subset.
- **Evidence helps less than expected.** Adding the re-run and the files moves MiniCPM5's generic
  AUROC from 0.77 to 0.78. Adding each generated check's own command output raises TPR (39% → 61%)
  and FPR (8% → 18%) together.

### Would the capsule say the right thing?

For every session where a capsule fires on a failing run: does the top check point at a
requirement the grader says failed? Generated checks use the target labels below. The generic
questions use a fixed map written before looking at the fires. Nine of 10 hand spot checks agree
with the automated call; the tenth was scored "wrong" but was arguably right.

| judge (condition) | failing sessions that get a capsule aimed at what actually failed | passing sessions that get a capsule anyway |
|---|---:|---:|
| MiniCPM5-2B readout (TE) | **84 / 213 (39%)** | 32 / 153 (21%) |
| MiniCPM5-2B readout (T) | 46 / 213 (22%) | 16 / 153 (10%) |
| Kev-0.8B (T) | 60 / 213 (28%) | 56 / 153 (37%) |
| Kev-0.8B (TE) | 48 / 213 (23%) | 67 / 153 (44%) |
| Laya (TE) | 36 / 213 (17%) | 60 / 153 (39%) |

## Step 1b: between turns

616 boundaries: every boundary of 40 stratified runs, plus every mechanically-positive boundary in
the corpus. Transcript only, because intermediate workspaces were never saved.

| judge | G2 input damaged: AUROC, share of boundaries fired | G5 loop: AUROC | G1 / G3: false alarms on hand-labelled clean turns | capsules per session: 2-in-a-row rule / plus maxFires = 2 | sessions with ≥1 capsule |
|---|---|---|---|---|---|
| MiniCPM5-2B readout | 0.62, fires on 70% | 0.47 | 21% / 55% | 24 / **7.2** | 98% |
| Kev-0.8B¹ | 0.52, 20% | **0.79** | 12% / 30% | 12 / **5.6** | 100% |
| Laya | 0.45, 78% | 0.65 | 92% / 77% | 49 / **9.5** | 100% |

¹ Kev skipped 106 boundary states over ~4k tokens (the late turns of long runs), because of the
GPU watchdog.

- **The corpus barely contains between-turn violations.** G1 (off-task) had no positives among
  the 40 hand-labelled turns and G3 (error treated as success) had one: LFM ending its session on
  an unfixed `require is not defined` crash. G2/G4/G5 have 7, 3 and 16 positives across all 1,911
  boundaries. So these numbers mostly measure false alarms, and false alarms are what the judges
  produce.
- **G2, "input damaged", which you doubted, fires on 20–78% of boundaries** and ranks near chance
  (AUROC 0.45–0.62) against the 7 real overwrites of `prompt.txt`. Drop it.
- **The one invariant with a usable signal is G5 (loop), with Kev: 0.79 on 15 positives.**
- **Model-written "always" checks fire on 1–18% of boundaries.** They are quieter than the generic
  bank, largely because many are really end-state checks written as "always" (see below).

## Question source 2: the checklists the 3B models wrote

| model | checklists (failed) | checks per list | with a command | marked "always" | GPU time per checklist |
|---|---|---:|---:|---:|---:|
| Granite-4.2-3B | 20 (0) | 4.3 | 100% | 59% | 136 s |
| Spark-X2.5-4B | 20 (**3**: ran into the 3,000-token cap mid-JSON) | 8.4 | 100% | 23% | 223 s |
| LFM2.5-2.6B | 15 (0) | 4.6 | 100% | 16% | 30 s |
| MiniCPM5-2B | 15 (0) | 4.5 | 100% | 9% | 87 s |
| Nanbeige4.2-3B | 9 (**1**: invalid JSON) | 9.9 | 90% | 23% | 376 s |

Nanbeige's chat template breaks llama.cpp's JSON-schema grammar, so it ran without one, with one
format line added and a backslash repair. It also ran at the roster's `maxTokens` of 4096 and
with 3 samples per task, because at 3,000 its thinking used up the budget.

**Do they aim at the right thing?** Each check was labelled with the graded requirement it
targets, from its text alone. In 166 of 222 failing sessions (75%), the checklist targets at least
one requirement that run failed. But the coverage sits on the runtime requirements; the logic ones
are where it thins out. Checklists (out of 3 per model) with any check aimed at each requirement:

| requirement | failing runs | Granite | LFM | MiniCPM5 | Nanbeige | Spark |
|---|---:|---|---|---|---|---|
| debounce passes the latest args (`fn(...args)`) | 15 | 1 | **0** | **0** | 2 | 2 |
| throttle allows N per window, then resets | 5 | **0** | 1 | **0** | 2 | 2 |
| Content-Length on the books server (the seeded bug) | 2 | **0** | – | – | – | 2 |
| throttle.ts loads and its self-test runs | 21 | 1 | 2 | 1 | 3 | 3 |
| server: 6th request gets 429 + Retry-After | 17 | 3 | 2 | 3 | 3 | 3 |
| debounce.ts loads and prints "all tests passed" | 11 | 3 | 3 | 3 | 2 | 3 |

**Their commands are not evidence on their own.** On runs the grader *passed*, 47/310 (Granite),
8/17 (LFM), 55/111 (MiniCPM5) and **355/715 (Spark)** of the generated commands still exit
non-zero. These counts cover all 5 checklists per task for the first four models; Nanbeige's
checklists came later. The causes: a grep for a pattern correct code need not contain (132), `python` where
the container has only `python3` (110), a curl with no server running (78), and node loader
errors inside the check itself (37). Hence B1 at chance.

**Some checks are wrong in ways that would hurt.** One MiniCPM5 checklist requires the self-test
to be "guarded by `require.main`". In these ES-module files that is exactly the pattern that
crashes on load, and CommonJS-in-ESM load failures are a common way these models' shipped files failed. Granite marks
"server.py exists" as *always*, so it would fire at turn 1, before anything is written.

## What this does not show

- **No capsule reached a model.** Whether a capsule would change the next turn, including the
  "right reason" ones, is untested. That is the live A/B.
- **The transcripts are from the benchmark harness** (bench sampler, `bench-guard`, older rounds),
  not from pi-small sessions, and are rendered with truncation to ~14k characters of actions.
- **The label base is small:** 74 FAIL / 55 PASS runs, few invariant positives. The AUROC
  intervals are about ±0.08.
- **Reduced runs:** checklists k = 0–2 only (Nanbeige has 3); Kev's TE without per-check command
  output; Kev's invariants without 106 long boundaries; Qwen3.5-4B on generic TE for 68 runs; no
  OpenJev 27B.

## What I would do next

1. **Drop between-turn capsules from a decision model.** Every judge fires on nearly every session
   in a corpus that has almost nothing to catch. If one invariant stays, make it the loop check
   (G5), and a mechanical one (the same tool call twice with no write in between) is cheaper than
   any judge.
2. **At yield, treat a judge as one "is this done?" gate, not a per-requirement checker.** The
   halo means the question barely matters. A single generic question with MiniCPM5 and evidence
   fires on 43% of failing runs at 9% false alarms, but its capsule cannot honestly say *what* is
   wrong. On the CPU that costs 80–250 s per yield. Kev-0.8B is 4× cheaper and weaker.
3. **The cheap baseline is not far behind.** Re-running the agent's last code command against the
   final files (B2) scores 0.64 with no model at all. A live A/B needs that arm.
4. **The silent logic failure needs a different tool.** No judge or checklist here catches
   "self-test passes, logic wrong". What catches it in this corpus is the graders' own
   behavioural tests. The nearest supervisor-side equivalent is a stronger model writing
   *executable* acceptance tests from the task prompt, which is a job for something bigger than a
   3B writer and a 2B judge.

## Appendix

How others use classifiers and small models inside agent harnesses, and what to try next:
[`pi-small-supervisor-classifier-survey-20260924.md`](pi-small-supervisor-classifier-survey-20260924.md).
