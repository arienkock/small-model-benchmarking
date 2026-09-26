#!/usr/bin/env bash
cd /d/llama.cpp/coding-bench
chmod +x run-smallctl-bench.sh
export BENCH_DEADLINE="2026-09-17 07:00"
export BENCH_REPEATS=1
./run-smallctl-bench.sh > smallctl-arm.log 2>&1
echo "ARM_EXIT=$?" >> smallctl-arm.log
