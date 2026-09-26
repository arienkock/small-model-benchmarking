# Spark-X2.5-4B: can it be made faster? (2026-09-26)

**Result:** not with server flags. On the laptop's GTX 970M a small dense model is
**compute-bound**, so the quant format is the lever: **Q8_0 generates ~24% faster than the
roster's Q6_K** (16.4 vs 13.2 t/s) and is the more precise of the two. The roster still runs
Q6_K. A free-form books-api run with Spark was not worth continuing (4/28 at the 40-minute cap),
and the batch was stopped after one run.

Scripts are in `pi-small/workflow/freeform-bench/` (`spark-sweep.sh`, `spark-bench.py`,
`gpu-probe.sh`, `launchers/spark-*`), output in its `results/`.

## Server flags: no gain

`spark-sweep.sh`: Spark with the roster's own arguments (ctx 16384, all layers on the GPU),
cold prompts of ~1.2k and ~6k tokens, 256 generated tokens each, two runs per size.

| config | GPU memory | prompt t/s (1.2k / 6k) | generation t/s (1.2k / 6k) |
|---|---:|---:|---:|
| roster today (flash attention auto = on) | 4043 MiB | 196–202 / 188–189 | 13.2 / 12.8 |
| `-fa on` | 4043 MiB | 195–199 / 187 | 13.2 / 12.8 |
| `-fa off` | 4540 MiB | 145 / 185 | 11.0 / 9.4 |
| `-b 2048 -ub 1024` | 4185 MiB | 201–203 / 185–186 | 13.0 / 12.7 |
| `-b 2048 -ub 2048` | 4472 MiB | 205–207 / 176 | 13.1 / 12.4 |
| `-fa on -ctk q8_0 -ctv q8_0` | 3763 MiB | 196–197 / 184 | 11.9 / 10.9 |

Nothing spills: the model and its 16k KV fit in 4 GiB of the 6 GiB card, so there is nothing
to recover the way `--n-cpu-moe 35` recovered Qwen3.6. Flash attention is already on by default.

## Why: the card is compute-bound

`gpu-probe.sh`, sampling `nvidia-smi` during generation: P0, SM clock at its 1037 MHz maximum,
memory at its 2505 MHz maximum, no throttle reasons, **GPU utilization 93–100%, memory-controller
utilization 34–51%**, 77–82 W, High performance power plan, on AC. The GPU is busy computing, not
waiting on memory. Maxwell (sm_52) has no `dp4a` integer dot product, so dequantizing K-quants is
expensive. At 3.38 GB of weights, 13 t/s is ~44 GB/s of the card's ~120 GB/s.

## Quants: Q8_0 wins

Same bench, roster arguments, `M=<gguf> spark-sweep.sh`. The two extra files were downloaded from
`sizzlebop/Spark-X2.5-4B-GGUF` into `D:/models/spark-x2.5-4b/`, outside `LLAMA_CACHE` and without
`-hf`, so the cached Q6_K's refs were not touched.

| quant | file | GPU memory | prompt t/s (1.2k / 6k) | generation t/s (1.2k / 6k) |
|---|---:|---:|---:|---:|
| Q4_K_M | 2.60 GB | 3300 MiB | 190–191 / 180–181 | 16.1 / 15.5 |
| Q6_K (roster) | 3.38 GB | 4043 MiB | 196–202 / 188–189 | 13.2 / 12.8 |
| **Q8_0** | 4.38 GB | 4993 MiB | 196–197 / 184–185 | **16.4 / 15.8** |

Q8_0 is larger than Q6_K and still faster, which confirms the compute limit. It leaves ~1.1 GiB of
the card free at 16k. Q4_K_M matches it on speed but is lower precision. Prompt speed does not
change with the quant. Of the small models only Spark and Nanbeige4.2-3B (left out of the
rotation) are on Q6_K; Granite-4.2-3B, LFM2.5-2.6B and MiniCPM5-2B already run Q8_0. For any new small dense model on this card, try Q8_0
before a flag sweep.

## Free-form: one run, stopped

`launchers/spark-ff-launch.sh 3 40 sparkq6:Q6_K sparkq8:Q8_0`: books-api `prompt.md` as the only
message, plain pi-small session, 40-minute cap, graded by the hidden grader (28 checks). Run 1 (Q6_K):

- **4/28 at the cap**: 45 responses, 44 tool calls, 19,752 output tokens, 3 compactions.
- Time: model responses 26.4 min, compactions 8.7 min (22%), tools 1.4 min.
- **In-context compaction fails for Spark every time.** The instruction says "Do not call any
  tools"; Spark calls one anyway, the attempt is discarded after 47–50 s, and the serialized fallback
  then takes 104–138 s. pi's own compaction was never reached.

The batch was stopped during run 2 (not kept). The free-form setup is not realistic for the ≤4B
models; Qwen3.6 did the same task in 5–16 minutes at 28/28.

## Open

- **Spark on Q8_0 in the roster:** faster and more precise, at +1 GiB of GPU memory. Not switched.
- **In-context compaction for tool-happy models:** force a text reply on that one request
  (`tool_choice: "none"`, if it leaves the rendered prompt and so the cache intact), or skip straight
  to the serialized prompt for models that fail it.
- `D:/models/spark-x2.5-4b/` holds ~7 GB (Q4_K_M, Q8_0); D: is at 93%. Delete Q4_K_M at least if
  Q8_0 is adopted.
