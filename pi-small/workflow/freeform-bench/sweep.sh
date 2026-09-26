#!/usr/bin/env bash
# Server-config sweep for Qwen3.6 at 32k. Usage: .sweep.sh "<label>|<extra args>" ...
cd /d/llama.cpp/pi-small || exit 1
source ../llama-cache.env
BASE=(-m C:/models/qwen3.6-35b-a3b/Qwen3.6-35B-A3B-Q4_K_M.gguf --alias Qwen3.6-35B-A3B-Q4_K_M --jinja -c 32768 -ngl 999 --parallel 1 --reasoning-budget -1 --chat-template-kwargs '{"enable_thinking":true}' --temp 1 --top-p 0.95 --top-k 20 --repeat-penalty 1 --min-p 0 --presence-penalty 1.5 --load-mode none --api-key sk-bench --host 127.0.0.1 --port 8125)
for cfg in "$@"; do
  label=${cfg%%|*}; extra=${cfg#*|}
  echo "=== $label: $extra  ($(date -u +%H:%M:%S))"
  taskkill //IM llama-server.exe //F >/dev/null 2>&1; sleep 3
  /d/llama.cpp/llama-server.exe "${BASE[@]}" $extra > ".sweep-$label.log" 2>&1 &
  ok=0
  for i in $(seq 1 90); do
    sleep 5
    if curl -s -m 5 http://127.0.0.1:8125/health | grep -q '"ok"'; then ok=1; break; fi
    tasklist //FI "IMAGENAME eq llama-server.exe" | grep -q llama-server || break
  done
  if [ $ok != 1 ]; then echo "  FAILED to start"; tail -3 ".sweep-$label.log"; continue; fi
  echo "  loaded after $((i*5)) s; $(nvidia-smi --query-gpu=memory.used --format=csv,noheader) GPU; $(systeminfo | grep -i 'Available Physical' | sed 's/.*: //') RAM free"
  python workflow/freeform-bench/sweep-bench.py 8125
  taskkill //IM llama-server.exe //F >/dev/null 2>&1
done
echo "=== done $(date -u +%H:%M:%S)"
