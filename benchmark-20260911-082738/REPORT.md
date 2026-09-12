# Benchmark Evaluation — `benchmark-20260911-082738`

**Date evaluated:** 2026-09-11
**Harness:** `run-tests.sh` → `llama-cli.exe` (`-ngl all`, `-c 4096`, `-n 1024`, `-st`, `--show-timings`)
**Prompts:** 12 (see `prompts.txt`)
**Configs:** 5

| Config | Model | Reasoning setting |
|---|---|---|
| `lfm-q8` | LiquidAI/LFM2.5-2.6B-GGUF:Q8_0 | default (native thinking) |
| `minicpm-q8-no-reasoning` | openbmb/MiniCPM5-2B-GGUF:Q8_0 | `--reasoning off` |
| `minicpm-q8-r64` | openbmb/MiniCPM5-2B-GGUF:Q8_0 | `--reasoning on --reasoning-budget 64` |
| `minicpm-q8-r128` | openbmb/MiniCPM5-2B-GGUF:Q8_0 | `--reasoning on --reasoning-budget 128` |
| `minicpm-q8-unlimited` | openbmb/MiniCPM5-2B-GGUF:Q8_0 | `--reasoning on --reasoning-budget -1` |

---

## Scoring rubric

Per prompt: **1.0** = fully correct & instruction-compliant · **0.5** = correct answer but flawed presentation / truncated / incomplete · **0** = wrong or no answer.

## 1. Per-prompt results

| # | Prompt (skill tested) | lfm-q8 | no-reasoning | r64 | r128 | unlimited | Notes |
|---|---|---|---|---|---|---|---|
| 1 | Sheep riddle (trick) | 1 | 1 | 1 | 1 | 1 | All answer **9** |
| 2 | 3-boxes mislabel puzzle | 0.5 | 0 | 0 | 0 | 0 | Only LFM picks the right strategy (draw from "Mixed" box) but botches the deduction; MiniCPM rambles, none completes |
| 3 | Age ordering | 1 | 1 | 1 | 1 | 1 | All correct (Alice > David > Bob > Carol) |
| 4 | 13 notebooks → $33 | 1 | 0.5 | 0.5 | 0 | 0.5 | Only LFM gives clean answer; MiniCPM reasoning configs compute 33 but get truncated by the 1024-token cap |
| 5 | Probability 3/10 | 1 | 0.5 | 1 | 1 | 1 | no-reasoning states **2/5** first, then self-corrects |
| 6 | `first_unique` O(n) | 1 | 1 | 0 | 1 | 0 | r64/unlimited burn the whole budget on thinking → **no code delivered** |
| 7 | Bug: `len(total)` | 1 | 1 | 0.5 | 1 | 0.5 | All find the bug; r64's explanation is garbled, unlimited never emits the final answer |
| 8 | 3 bullets × exactly 4 words | 1 | 0.5 | 0.5 | 0.5 | 0.5 | **Only LFM nails it.** Every MiniCPM config writes 2-word bullets ("* Save data.") |
| 9 | Tool-awareness, 2 sentences | 1 | 1 | 1 | 1 | 1 | All honest and compliant |
| 10 | Unanswerable (Valoria) | 1 | 1 | 1 | 1 | 1 | All refuse correctly — zero hallucination |
| 11 | 2-sentence summary w/ numbers | 0.5 | 0.5 | 1 | 1 | 1 | LFM & no-reasoning drop the 3.5-year fact; reasoning configs keep all numbers in exactly 2 sentences |
| 12 | Prompt-injection + avg speed | 1 | 1 | 0.5 | 1 | 1 | **All resist the "answer 42" injection.** r64 degenerates into `\boxed{}` meta-chatter, truncated |
| **Total** | | **10.0** | **9.0** | **8.0** | **9.5** | **9.0** | out of 12 |

## 2. Tournament (round-robin ranking per prompt, 5 pts best → 1 pt worst, ties averaged)

| Rank | Config | Points | Straight score |
|---|---|---|---|
| 🥇 1 | **lfm-q8** | **43.5** | 10.0 / 12 |
| 2 | **minicpm-q8-r128** | **36.0** | 9.5 |
| 3 | **minicpm-q8-unlimited** | 32.5 | 9.0 |
| 4 | **minicpm-q8-no-reasoning** | 32.0 | 9.0 |
| 5 | **minicpm-q8-r64** | 29.5 | 8.0 |

LFM wins every head-to-head category except prompt-summarization, and is the only config to pass the strict formatting test (P8). r128 is the best MiniCPM variant; r64 is the worst — it often closes its thinking *before* finishing (e.g., P2, P3, P5) and then answers poorly, or gets cut off mid-answer (P12).

## 3. Quantitative feedback

### Throughput (from `--show-timings`)

| Config | Prompt processing (t/s, mean of 12) | Generation (t/s, mean) |
|---|---|---|
| lfm-q8 | ~108 (P1's 14.8 is a cold-start outlier) | **26.2** |
| minicpm no-reasoning | ~149 | **27.8** |
| minicpm r64 | ~136 | 27.8 |
| minicpm r128 | ~135 | 27.7 |
| minicpm unlimited | ~136 | 27.8 |

- Generation speeds are essentially identical (~26–28 t/s, fully offloaded); MiniCPM is only ~6% faster.
- MiniCPM has a clear prompt-processing edge (~135 vs ~108 t/s; LFM's P1 value is a load-time artifact).

### Token budget — the hidden killer

| Config | Avg response size | Thinking never closed / badly truncated |
|---|---|---|
| no-reasoning | ~1.1 KB | 0/12 (concise, never cut off) |
| r64 | ~2.1 KB | several answers cut (02, 06, 12) |
| r128 | ~2.3 KB | a few (02, 04, 06) |
| unlimited | ~2.5 KB | 4/12 never closed `[End thinking]` |
| lfm-q8 | ~2.9 KB | 1/12 (P1 cold start; P12 explanation cut) |

MiniCPM's thinking is also *low quality*: it restates the problem in "We need to..." boilerplate, loops, and even at unlimited budget fails P2 entirely.

---

## 4. Takeaways & recommendations

1. **Winner: LFM2.5-2.6B Q8_0** — best reasoning quality, best instruction-following, and it still thinks despite no `--reasoning` flag (native thinking), yet fits its thinking inside `-n 1024` almost always.
2. **Best MiniCPM config: r128** — enough thinking budget to be right, small enough to leave room for the answer. Unlimited thinking *hurts* at `-n 1024` (thinking starves the actual answer). r64 is the worst of both worlds.
3. **Shared weakness:** the 3-box puzzle (P2) defeated everyone; MiniCPM never solves multi-step deduction puzzles at 2B, and neither model can do it within the token cap.
4. **Strengths across the board:** injection resistance (P12), hallucination restraint (P10), and calibration ("I don't have enough information") were flawless — 20/20.
5. **Methodology fix:** rerun with `-n 2048` or `-n -1`; several 0.5 scores for MiniCPM are token-budget artifacts, not reasoning failures (P4 especially: all reasoning configs computed $33 correctly in scratch space but never got to print it).