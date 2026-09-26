#!/usr/bin/env bash
# Load Spark (base config), generate, and sample GPU clocks/power/utilization meanwhile.
cd /d/llama.cpp/pi-small || exit 1
source ../llama-cache.env
M=$(ls D:/llama-cache/models--sizzlebop--Spark-X2.5-4B-GGUF/snapshots/*/Spark-X2.5-4B-Q6_K.gguf | head -1)
taskkill //IM llama-server.exe //F >/dev/null 2>&1; sleep 3
/d/llama.cpp/llama-server.exe -m "$M" --jinja -c 16384 -ngl 999 --parallel 1 --api-key sk-bench --host 127.0.0.1 --port 8125 > .gpu-probe.log 2>&1 &
for i in $(seq 1 40); do sleep 3; curl -s -m 5 http://127.0.0.1:8125/health | grep -q '"ok"' && break; done
nvidia-smi --query-gpu=name,pcie.link.gen.current,pcie.link.width.current,clocks.max.sm,clocks.max.mem,power.limit --format=csv
( python workflow/freeform-bench/sweep-bench.py 8125 ) &
b=$!
for s in 1 2 3 4 5 6 7 8; do sleep 6; nvidia-smi --query-gpu=pstate,clocks.sm,clocks.mem,power.draw,utilization.gpu,utilization.memory,temperature.gpu,clocks_throttle_reasons.active --format=csv,noheader; done
wait $b
powercfg //getactivescheme; WMIC Path Win32_Battery Get BatteryStatus 2>/dev/null
taskkill //IM llama-server.exe //F >/dev/null 2>&1
