#!/usr/bin/env bash
# ROUND 4 — three-model shortlist round.
#
#   roster    models-round4.conf (Nanbeige, Spark, Granite; per-model config)
#   tasks     prompts-filter.txt (the usual 3)
#   repeats   4  -> 24 scored trials per model, against round 3's 18
#   deadline  hard stop; no cell is started that cannot finish by then
#
# SIZING (measured, not assumed). Per-cell caps from each model's own probe:
#   Nanbeige ~7.5 tok/s @depth -> 12000/7.5 x1.35 ~= 2166s
#   Spark    ~12.5             -> ~1296s
#   Granite  ~13.5             -> ~1200s
# Worst case 3 tasks x 4 repeats = ~15.5 h if every cell hits its cap; round 3's
# actual/worst ratio was 0.68, so expect ~10.5 h. The deadline guard makes the
# worst case safe rather than merely unlikely.
set -u
cd /d/llama.cpp/coding-bench || exit 1
export BENCH_MODELS=/d/llama.cpp/coding-bench/models-round4.conf
export BENCH_PROMPTS=/d/llama.cpp/coding-bench/prompts-filter.txt
export BENCH_REPEATS=4
export BENCH_DEADLINE="2026-09-14 07:00"
exec ./run-filter-bench.sh
