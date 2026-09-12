# Head-to-Head Re-Run — `benchmark-h2h-20260911-094558`

**Setup:** LFM2.5-2.6B Q8_0 vs MiniCPM5-2B Q8_0 (unlimited reasoning budget), 12 prompts, `-c 8192`, **`-n 2048`** (up from 1024) — designed to remove the token-cap handicap that hurt MiniCPM's thinking in the first benchmark.

**Configs:**

| Config | Model | Reasoning |
|---|---|---|
| `lfm-q8` | LiquidAI/LFM2.5-2.6B-GGUF:Q8_0 | default (native thinking) |
| `minicpm-q8-unlimited` | openbmb/MiniCPM5-2B-GGUF:Q8_0 | `--reasoning-budget -1` |

---

## 1. Per-prompt results (rubric: 1 / 0.5 / 0)

| # | Prompt | lfm | minicpm | Verdict |
|---|---|---|---|---|
| 1 | Sheep riddle → 9 | 1 | 1 | Tie — both correct; MiniCPM's thinking loops through the same reinterpretation ~6 times (5.5 KB!) |
| 2 | 3-boxes puzzle | 0 | 0 | **Tie (both fail).** Both truncated at 2048 tokens. LFM this run abandoned the correct "draw from Mixed" strategy and "proved" an invalid assignment; MiniCPM got lost in a pigeonhole argument and never solved it |
| 3 | Age ordering | 1 | 1 | Tie — both correct |
| 4 | 13 notebooks → $33 | 1 | 0.5 | LFM wins. MiniCPM again computed $33 in scratch but **still truncated at 2048** (`closed_think=0`) — never delivered an answer |
| 5 | Probability → 3/10 | 1 | 1 | Tie — both clean |
| 6 | `first_unique` O(n) | 1 | 1 | Tie — **MiniCPM now delivers full code + tests** (failed at -n 1024) |
| 7 | Bug: `len(total)` | 1 | 1 | Tie — both correct (MiniCPM also delivered this time) |
| 8 | 3 bullets × 4 words | 1 | 0.5 | **LFM wins again.** MiniCPM wrote "* Save important." (2), "* Keep data safe." (3), "* Protect from loss." (3) — fails the word count a 4th consecutive time |
| 9 | Tool-awareness, 2 sentences | 1 | 1 | Tie — both honest, 2 sentences |
| 10 | Unanswerable (Valoria) | 1 | 1 | Tie — both refuse correctly |
| 11 | 2-sentence summary | 0.5 | 1 | **MiniCPM wins.** LFM omitted 3.5 years again; MiniCPM kept all four numbers in exactly 2 sentences |
| 12 | Injection + avg speed | 1 | 1 | Tie — both resist "answer 42", both answer 48 |
| **Total** | | **10.5** | **10.0** | |

## 2. Head-to-head record

| | Wins | Ties | Losses |
|---|---|---|---|
| **lfm-q8** | 2 (P4, P8) | 9 | 1 (P11) |
| **minicpm-q8-unlimited** | 1 (P11) | 9 | 2 |

**LFM edges it 10.5 vs 10.0** — a much closer race than the first benchmark suggested. With the token starvation removed, MiniCPM closes most of the gap; the remaining difference is quality, not budget: strict instruction-following (P8) and reliable answer delivery (P4).

## 3. Quantitative

### Throughput

| Config | Prompt processing (t/s, mean) | Generation (t/s, mean) |
|---|---|---|
| lfm-q8 | ~109 | 26.2 |
| minicpm unlimited | ~141 | **27.7** |

Same picture as before: MiniCPM ~30% faster at prefill, ~6% faster at generation. Speed is not a differentiator.

### Response size & truncation

| Config | Avg bytes | Truncated (no `[End thinking]`) |
|---|---|---|
| lfm-q8 | ~3.6 KB | 1/12 (P2) |
| minicpm unlimited | ~4.3 KB | 2/12 (P2, P4) |

### Effect of the re-run on MiniCPM unlimited (vs first benchmark)

| Prompt | -n 1024 | -n 2048 | Delta |
|---|---|---|---|
| P4 notebooks | 0.5 | 0.5 | — (still truncated) |
| P6 first_unique | 0 | **1** | +0.5 ✅ |
| P7 len bug | 0.5 | **1** | +0.5 ✅ |
| P8 bullets | 0.5 | 0.5 | — (fails word count regardless) |
| All others | same | same | — |
| **Total** | **9.0** (5-way field) | **10.0** (1v1) | **+1.0** |

## 4. Conclusions

1. **The first run's gap was largely an artifact.** Roughly +1.0 point of MiniCPM's deficit was pure token starvation. At equal budgets it's within half a point of LFM.
2. **LFM still wins on the things that matter most:**
   - *Instruction precision* — passed the 4-word-bullet test both runs; MiniCPM has failed it 4/4 times across both benchmarks.
   - *Answer delivery* — LFM's thinking is structured (numbered steps, verification) and predictable in length; MiniCPM's "Thus answer: 9. Thus answer: 9. Thus answer: 9." loop style burned budget on P4 even at 2048.
   - *P2 (3-box puzzle)* remains unsolved by both even at 2048 tokens — this needs a bigger budget or a stronger model, not a config tweak.
3. **MiniCPM's win (P11) is real but narrow**: it's better at faithful multi-fact compression. LFM systematically drops the last number of a passage.
4. **Recommendation:** for production use on this hardware, LFM2.5-2.6B Q8_0 remains the pick (better instruction-following, equal correctness, and it gets there with a shorter, more disciplined thinking trace). If prompt-processing speed matters more than quality, MiniCPM-unlimited at `-n 2048` is now a viable budget alternative.