#!/usr/bin/env bash
# Second repeat, Granite and Spark only. Nanbeige is excluded: at 24576 its
# server dies with a Windows TDR reset (CUDA error: the launch timed out), and
# even at 16384 it prefills at 17-23 tok/s against Granite 148 / Spark 167, so
# a single SmallCTL turn would cost ~9 minutes. The remaining night buys a
# second rep for the two models that do run instead.
cd /d/llama.cpp/coding-bench
export BENCH_DEADLINE="2026-09-17 07:00"
export BENCH_REPEATS=1
export BENCH_REP_START=2
export BENCH_MODELS="Granite-4.2-3B-Q8_0,Spark-X2.5-4B-Q6_K"
./run-smallctl-bench.sh > smallctl-arm-r2.log 2>&1
echo "ARM2_EXIT=$?" >> smallctl-arm-r2.log
