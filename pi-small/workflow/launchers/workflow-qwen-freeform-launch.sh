#!/usr/bin/env bash
# Free-form comparison run (2026-09-25 night; -4: terse, in-context compaction (200 words per part), ctx 32k, maxTokens 8192, n-cpu-moe 35): Qwen3.6-35B-A3B, plain pi-small, the books-api
# prompt.md as its only message, no workflow/checks/feedback, one session capped at 4 h. Graded.
cd /d/llama.cpp/pi-small || exit 1
exec node workflow/run.ts --task workflow/tasks/books-api \
	--model Qwen3.6-35B-A3B-Q4_K_M \
	--freeform --cap-min 240 \
	--run-dir workflow-runs/qwen-freeform-4
