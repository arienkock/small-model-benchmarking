#!/usr/bin/env bash
cd /d/llama.cpp/pi-small || exit 1
THINKING=off exec ./workflow/freeform-bench/ff-batch3.sh nothink 4 60
