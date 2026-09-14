#!/usr/bin/env bash
# ROUND 3' — begun as the qualifying round VibeThinker was promised in
# round3-recommendation.md:415. It failed the tool_calls probe there twice on
# 2026-09-14, with the prescribed template AND its prescribed deepseek
# follow-up, so it was dropped before this round ever started and what remains
# is the re-measurement of the two incumbents under the new algo/pkg grading.
# Roster rationale, the Granite drop and the sizing are all in
# models-round3prime.conf; read that first.
#
#   roster    models-round3prime.conf (Granite, Spark)
#   tasks     prompts-filter.txt (3; the injection preamble is gone from task 3)
#   repeats   3  -> 9 cells per model
#   deadline  hard stop; no cell is started that cannot finish by then
#
# RUN smoke-round3prime.sh FIRST — it is what caught VibeThinker, and it also
# confirms both incumbents still report a numeric decode rate.
#
# ~8.0 h worst case for the two-model roster at OVERHEAD_FACTOR=1.9, from their
# measured rates (Granite ~16 tok/s -> 1424s/cell, Spark ~13 -> 1751s/cell).
# The deadline below is the only thing that bounds it — set it to the real
# hand-back time.
set -u
cd /d/llama.cpp/coding-bench || exit 1
export BENCH_MODELS=/d/llama.cpp/coding-bench/models-round3prime.conf
export BENCH_PROMPTS=/d/llama.cpp/coding-bench/prompts-filter.txt
export BENCH_REPEATS=3
export BENCH_DEADLINE="${BENCH_DEADLINE:?set BENCH_DEADLINE, e.g. \"tomorrow 07:00\" — at 1.9x overhead the guard is the only bound on this round}"
exec ./run-filter-bench.sh
