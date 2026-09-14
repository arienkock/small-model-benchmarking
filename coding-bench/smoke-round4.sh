#!/usr/bin/env bash
# Round-4 smoke test: the real code path, one task, one repeat, short caps.
# Verifies the three things that must work tonight:
#   1. all three models load with their per-model server_args (Nanbeige's q8_0 KV)
#   2. both preflight probes pass for each
#   3. measure_tok_s returns a NUMBER for each — the fix that round 3 needed
set -u
cd /d/llama.cpp/coding-bench || exit 1
export BENCH_MODELS=/d/llama.cpp/coding-bench/models-round4.conf
export BENCH_PROMPTS=/d/llama.cpp/coding-bench/prompts-smoke.txt
export BENCH_REPEATS=1
export BENCH_TOKEN_BUDGET=1500
export BENCH_MIN_RUN_SEC=240
export BENCH_MAX_RUN_SEC=420
export BENCH_DEADLINE="2026-09-14 07:00"
exec ./run-filter-bench.sh
