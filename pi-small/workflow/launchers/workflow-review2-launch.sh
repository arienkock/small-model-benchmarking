#!/usr/bin/env bash
# Review-only re-run (2026-09-25): Spark (reasoningBudget 512) and MiniCPM, 4 prompts,
# with the wrap-up nudge + one continuation session, on the overnight-5 workspace.
cd /d/llama.cpp/pi-small || exit 1
exec node workflow/run.ts --task workflow/tasks/books-api \
	--review completeness,correctness,fidelity,all \
	--models Spark-X2.5-4B-Q6_K,MiniCPM5-2B-Q8_0 \
	--seed-ws workflow-runs/overnight-5/ws \
	--config workflow/configs/rotation-minimal.json \
	--run-dir workflow-runs/review-2 \
	--deadline "$(( ($(date +%s) + 5*3600) * 1000 ))"
