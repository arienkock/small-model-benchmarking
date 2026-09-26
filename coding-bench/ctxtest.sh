#!/usr/bin/env bash
# Can these models serve 32768 on the 6 GiB card? The bench ladder never asked:
# CTX_CANDIDATES starts at 16384, so 32768 has simply never been tried.
cd /d/llama.cpp/coding-bench
for spec in "Granite-4.2-3B-Q8_0|ibm-granite/granite-4.2-3b-GGUF|granite-4.2-3b-Q8_0.gguf" \
            "Spark-X2.5-4B-Q6_K|sizzlebop/Spark-X2.5-4B-GGUF|Spark-X2.5-4B-Q6_K.gguf"; do
  IFS='|' read -r A R F <<< "$spec"
  taskkill //F //IM llama-server.exe >/dev/null 2>&1; sleep 2
  ../llama-server.exe -hf "$R" -hff "$F" --alias "$A" --jinja -c 32768 -ngl 999 \
    --parallel 1 --reasoning-budget 4096 --api-key sk-bench --host 127.0.0.1 --port 8123 \
    > "/tmp/ctx32-$A.log" 2>&1 &
  ok=no
  for _ in $(seq 1 120); do
    curl -s -m 3 -H "Authorization: Bearer sk-bench" http://127.0.0.1:8123/health | grep -q '"status":"ok"' && { ok=yes; break; }
    grep -qi "out of memory\|failed to allocate\|cuda error" "/tmp/ctx32-$A.log" && break
    sleep 2
  done
  if [ "$ok" = yes ]; then
    n=$(curl -s -H "Authorization: Bearer sk-bench" http://127.0.0.1:8123/props | jq -r '.default_generation_settings.n_ctx')
    echo "$A: LOADED n_ctx=$n"
  else
    echo "$A: FAILED  $(grep -io 'out of memory\|failed to allocate[^\n]*\|cuda error[^\n]*' "/tmp/ctx32-$A.log" | head -1)"
  fi
  taskkill //F //IM llama-server.exe >/dev/null 2>&1; sleep 2
done
echo CTXTEST_DONE
