#!/usr/bin/env bash
cd /d/llama.cpp/pi-small || exit 1
node serve.mjs Qwen3.6-35B-A3B-Q4_K_M; echo "serve exit $?"
node serve.mjs --status
systeminfo | grep -i "Available Physical"
nvidia-smi --query-gpu=memory.used,memory.total --format=csv
python workflow/freeform-bench/speed.py 8123
systeminfo | grep -i "Available Physical"
