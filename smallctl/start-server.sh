#!/usr/bin/env bash
# Start llama-server for the SmallCTL experiment. Same port/key/sampler
# conventions as run-filter-bench.sh so nothing here is a special case.
set -uo pipefail
cd /d/llama.cpp

ALIAS="${ALIAS:-Spark-X2.5-4B-Q6_K}"
REPO="${REPO:-sizzlebop/Spark-X2.5-4B-GGUF}"
FILE="${FILE:-Spark-X2.5-4B-Q6_K.gguf}"
CTX="${CTX:-16384}"

exec ./llama-server.exe \
    -hf "$REPO" -hff "$FILE" \
    --alias "$ALIAS" \
    --jinja \
    -c "$CTX" \
    -ngl 999 \
    --parallel 1 \
    --reasoning-budget "${THINK:-512}" \
    --temp 0.7 --top-p 0.95 --top-k 40 \
    --api-key sk-bench \
    --host 0.0.0.0 --port 8123
