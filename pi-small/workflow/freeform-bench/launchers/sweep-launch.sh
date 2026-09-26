#!/usr/bin/env bash
cd /d/llama.cpp/pi-small && ./workflow/freeform-bench/sweep.sh "m35t8|--n-cpu-moe 35 -t 8" "m35t4|--n-cpu-moe 35 -t 4" "m34t8|--n-cpu-moe 34 -t 8" "m35ub1k|--n-cpu-moe 35 -t 8 -ub 1024" "m35ub2k|--n-cpu-moe 35 -t 8 -b 2048 -ub 2048"
