#!/usr/bin/env bash
# One-off launcher (schtasks /tr is limited to 261 chars): the 10-turn model-rotation experiment,
# books-api, rotation Granite -> Spark -> LFM -> MiniCPM -> Nanbeige, until done or 21:20.
cd /d/llama.cpp/pi-small && exec node workflow/run.ts --task workflow/tasks/books-api \
	--models Granite-4.2-3B-Q8_0,Spark-X2.5-4B-Q6_K,LFM2.5-2.6B-Q8_0,MiniCPM5-2B-Q8_0,Nanbeige4.2-3B-Q6_K \
	--config workflow/configs/rotation-10turns.json \
	--deadline "$(( $(date -d '2026-09-24 21:20' +%s) * 1000 ))" \
	--run-dir workflow-runs/rotation-$(date +%Y%m%d-%H%M%S) > workflow-rotation.log 2>&1
