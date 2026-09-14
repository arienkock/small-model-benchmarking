#!/usr/bin/env bash
# ROUND 3' — the qualifying round VibeThinker was promised in
# round3-recommendation.md:415, with the two incumbents it has to be measured
# against. Roster rationale, the Granite drop and the sizing are all in
# models-round3prime.conf; read that first.
#
#   roster    models-round3prime.conf (VibeThinker, Granite, Spark)
#   tasks     prompts-filter.txt (3; the injection preamble is gone from task 3)
#   repeats   3  -> 9 cells per model
#   deadline  hard stop; no cell is started that cannot finish by then
#
# RUN smoke-round3prime.sh FIRST. If VibeThinker fails the tool_calls probe
# again there is no point starting this round with it in the roster.
#
# ~12.0 h worst case at OVERHEAD_FACTOR=1.9, ~10 h expected. The deadline
# below is the only thing that bounds it — set it to the real hand-back time.
set -u
cd /d/llama.cpp/coding-bench || exit 1
export BENCH_MODELS=/d/llama.cpp/coding-bench/models-round3prime.conf
export BENCH_PROMPTS=/d/llama.cpp/coding-bench/prompts-filter.txt
export BENCH_REPEATS=3
export BENCH_DEADLINE="${BENCH_DEADLINE:?set BENCH_DEADLINE, e.g. \"tomorrow 07:00\" — at 1.9x overhead the guard is the only bound on this round}"
exec ./run-filter-bench.sh
