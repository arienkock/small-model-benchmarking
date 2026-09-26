#!/usr/bin/env bash
# Experiment: Qwen3.6 with tools [bash, edit] (TEMPORARY roster edit, restored at
# the end) and style v3, which points at the edit tool.
cd /d/llama.cpp/pi-small || exit 1
cp roster.json .roster.committed.json
python - <<PY
import json
r=json.load(open("roster.json"))
q=[m for m in r["models"] if m["alias"]=="Qwen3.6-35B-A3B-Q4_K_M"][0]
q["tools"]=["bash","edit"]
json.dump(r,open("roster.json","w"),indent="\t")
PY
export PI_SMALL_STYLE="$(cat workflow/freeform-bench/style-v3.txt)"
./workflow/freeform-bench/ff-batch3.sh edit3 4 60
cp .roster.committed.json roster.json
