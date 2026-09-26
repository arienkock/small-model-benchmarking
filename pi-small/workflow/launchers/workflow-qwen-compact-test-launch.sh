#!/usr/bin/env bash
# Compaction test (2026-09-25): Qwen3.6 at ctx 16384 with maxTokens 8192, so the
# compaction threshold is ~6k tokens and the first compaction comes within a few
# turns. Uses a TEMPORARY roster edit (restored at the end); free-form books-api, 45-min cap.
cd /d/llama.cpp/pi-small || exit 1
cp roster.json .roster.committed.json
python - <<PY
import json
r=json.load(open("roster.json"))
q=[m for m in r["models"] if m["alias"]=="Qwen3.6-35B-A3B-Q4_K_M"][0]
q["ctx"]=16384; q["ctxCandidates"]=[16384]
json.dump(r,open("roster.json","w"),indent="\t")
PY
node workflow/run.ts --task workflow/tasks/books-api \
	--model Qwen3.6-35B-A3B-Q4_K_M \
	--freeform --cap-min 45 \
	--run-dir workflow-runs/qwen-compact-test-1
cp .roster.committed.json roster.json
