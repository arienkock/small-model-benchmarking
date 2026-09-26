#!/usr/bin/env bash
# Server-config sweep for Spark-X2.5-4B (dense, whole model on the GPU).
# Usage: spark-sweep.sh "<label>|<extra args>" ...   (CTX=16384; M=<gguf>, default the cached Q6_K)
# Base args are what pi-small's roster produces for Spark today.
cd /d/llama.cpp/pi-small || exit 1
source ../llama-cache.env
M=${M:-$(ls D:/llama-cache/models--sizzlebop--Spark-X2.5-4B-GGUF/snapshots/*/Spark-X2.5-4B-Q6_K.gguf | head -1)}
BASE=(-m "$M" --alias Spark-X2.5-4B-Q6_K --jinja -c ${CTX:-16384} -ngl 999 --parallel 1 --reasoning-budget 512 --temp 1 --top-p 0.95 --top-k 0 --repeat-penalty 1 --min-p 0 --presence-penalty 0 --api-key sk-bench --host 127.0.0.1 --port 8125)
for cfg in "$@"; do
  label=${cfg%%|*}; extra=${cfg#*|}
  echo "=== $label: $extra  ($(date -u +%H:%M:%S))"
  taskkill //IM llama-server.exe //F >/dev/null 2>&1; sleep 3
  /d/llama.cpp/llama-server.exe "${BASE[@]}" $extra > ".sweep-spark-$label.log" 2>&1 &
  ok=0
  for i in $(seq 1 60); do
    sleep 3
    if curl -s -m 5 http://127.0.0.1:8125/health | grep -q '"ok"'; then ok=1; break; fi
    tasklist //FI "IMAGENAME eq llama-server.exe" | grep -q llama-server || break
  done
  if [ $ok != 1 ]; then echo "  FAILED to start"; tail -3 ".sweep-spark-$label.log"; continue; fi
  echo "  loaded after $((i*3)) s; $(nvidia-smi --query-gpu=memory.used --format=csv,noheader) GPU"
  grep -iE "CUDA0 (model|KV|compute) buffer|flash_attn|n_ubatch|offloaded" ".sweep-spark-$label.log" | sed 's/^/    /' | head -8
  python workflow/freeform-bench/spark-bench.py 8125
  taskkill //IM llama-server.exe //F >/dev/null 2>&1
done
echo "=== done $(date -u +%H:%M:%S)"
