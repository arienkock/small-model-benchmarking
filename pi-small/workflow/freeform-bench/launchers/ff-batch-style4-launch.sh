#!/usr/bin/env bash
cd /d/llama.cpp/pi-small || exit 1
export PI_SMALL_STYLE="$(cat workflow/freeform-bench/style-v4.txt)"
exec ./workflow/freeform-bench/ff-batch3.sh style4 4 45
