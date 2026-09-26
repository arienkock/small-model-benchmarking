#!/usr/bin/env bash
# Measure PREFILL SPEED, not just whether the model loads. At 32768 both models
# load fine and then prefill at 17.5 tok/s instead of ~250 -- the KV cache no
# longer fits in the 6 GiB card and spills. Loading is not the test; speed is.
cd /d/llama.cpp/coding-bench
# ~8000 tokens of filler, close to SmallCTL's real first prompt.
FILLER_FILE=./filler.txt
: > "$FILLER_FILE"
for _ in $(seq 1 1200); do printf 'the quick brown fox jumps over the lazy dog. ' >> "$FILLER_FILE"; done
echo "filler chars: $(wc -c < "$FILLER_FILE")"
for CTX in 16384 20480 24576; do
  for spec in "Granite-4.2-3B-Q8_0|ibm-granite/granite-4.2-3b-GGUF|granite-4.2-3b-Q8_0.gguf" \
              "Spark-X2.5-4B-Q6_K|sizzlebop/Spark-X2.5-4B-GGUF|Spark-X2.5-4B-Q6_K.gguf"; do
    IFS='|' read -r A R F <<< "$spec"
    taskkill //F //IM llama-server.exe >/dev/null 2>&1; sleep 2
    ../llama-server.exe -hf "$R" -hff "$F" --alias "$A" --jinja -c "$CTX" -ngl 999 \
      --parallel 1 --reasoning-budget 4096 --api-key sk-bench --host 127.0.0.1 --port 8123 \
      > "/tmp/sp-$A-$CTX.log" 2>&1 &
    ok=no
    for _ in $(seq 1 150); do
      curl -s -m 3 -H "Authorization: Bearer sk-bench" http://127.0.0.1:8123/health | grep -q '"status":"ok"' && { ok=yes; break; }
      sleep 2
    done
    if [ "$ok" != yes ]; then echo "$A ctx=$CTX: FAILED TO LOAD"; continue; fi
    # 54KB of JSON will not fit on a command line ("Argument list too long"),
    # so the body goes in a file and curl reads it with -d @.
    jq -n --arg m "$A" --rawfile c "$FILLER_FILE" \
       '{model:$m, messages:[{role:"user", content:$c}], max_tokens:8}' > body.json
    r=$(curl -s -m 600 -H "Authorization: Bearer sk-bench" -H "Content-Type: application/json" \
      -d @body.json http://127.0.0.1:8123/v1/chat/completions)
    pn=$(echo "$r" | jq -r '.timings.prompt_n // 0')
    ps=$(echo "$r" | jq -r '.timings.prompt_per_second // 0')
    printf "%-24s ctx=%-6s prefill %s tok/s over %s tokens\n" "$A" "$CTX" "$ps" "$pn"
    taskkill //F //IM llama-server.exe >/dev/null 2>&1; sleep 2
  done
done
echo SPEEDTEST_DONE
