#!/usr/bin/env bash
# Review-only matrix: 4 prompts x 4 models on the overnight workspace.
cd /d/llama.cpp/pi-small || exit 1
exec node workflow/run.ts --task workflow/tasks/books-api \
	--review completeness,correctness,fidelity,all \
	--models Granite-4.2-3B-Q8_0,Spark-X2.5-4B-Q6_K,LFM2.5-2.6B-Q8_0,MiniCPM5-2B-Q8_0 \
	--seed-ws workflow-runs/overnight-5/ws \
	--config workflow/configs/rotation-minimal.json \
	--run-dir workflow-runs/review-1 \
	--deadline "$(( ($(date +%s) + 4*3600) * 1000 ))"
