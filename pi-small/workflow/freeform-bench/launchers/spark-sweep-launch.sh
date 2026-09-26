#!/usr/bin/env bash
cd /d/llama.cpp/pi-small || exit 1
./workflow/freeform-bench/spark-sweep.sh \
  "base|" \
  "fa-on|-fa on" \
  "fa-off|-fa off" \
  "ub1024|-b 2048 -ub 1024" \
  "ub2048|-b 2048 -ub 2048" \
  "kvq8|-fa on -ctk q8_0 -ctv q8_0"
