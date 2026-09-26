#!/usr/bin/env bash
# Resume the proxy verification run (checkpoint/resume test).
cd /d/llama.cpp/pi-small || exit 1
exec node workflow/run.ts --resume --run-dir workflow-runs/proxy-check-1 \
	--models Granite-4.2-3B-Q8_0,Spark-X2.5-4B-Q6_K,LFM2.5-2.6B-Q8_0,MiniCPM5-2B-Q8_0 \
	--config workflow/configs/rotation-minimal.json \
	--deadline "$(( ($(date +%s) + 30*60) * 1000 ))"
