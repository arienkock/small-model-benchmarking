#!/usr/bin/env bash
# Proxy verification, real models: the shared plan, the overnight settings, 45 minutes.
cd /d/llama.cpp/pi-small || exit 1
d=workflow-runs/proxy-check-1
node workflow/from-plan.ts workflow-runs/rotation-20260924-201405 "$d" || exit 1
exec node workflow/run.ts --resume --run-dir "$d" \
	--models Granite-4.2-3B-Q8_0,Spark-X2.5-4B-Q6_K,LFM2.5-2.6B-Q8_0,MiniCPM5-2B-Q8_0 \
	--config workflow/configs/rotation-minimal.json \
	--deadline "$(( ($(date +%s) + 45*60) * 1000 ))"
