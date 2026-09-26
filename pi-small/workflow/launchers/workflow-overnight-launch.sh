#!/usr/bin/env bash
# Overnight 2026-09-24/25: the rotation on the shared plan, minimal feedback.
#   workflow-overnight-launch.sh <run-dir> [fresh]
# fresh: build <run-dir> from the rotation run's plan first; otherwise resume it.
cd /d/llama.cpp/pi-small || exit 1
d="$1"
if [ "$2" = fresh ]; then node workflow/from-plan.ts workflow-runs/rotation-20260924-201405 "$d" || exit 1; fi
exec node workflow/run.ts --resume --run-dir "$d" \
	--models Granite-4.2-3B-Q8_0,Spark-X2.5-4B-Q6_K,LFM2.5-2.6B-Q8_0,MiniCPM5-2B-Q8_0 \
	--config workflow/configs/rotation-minimal.json \
	--deadline "$(( $(date -d '2026-09-25 06:30' +%s) * 1000 ))"
