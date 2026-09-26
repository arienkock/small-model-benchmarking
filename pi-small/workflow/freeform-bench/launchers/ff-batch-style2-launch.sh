#!/usr/bin/env bash
cd /d/llama.cpp/pi-small || exit 1
export PI_SMALL_STYLE="$(cat workflow/freeform-bench/style-v2.txt)"
exec ./ff-batch2.sh style2 4 60
