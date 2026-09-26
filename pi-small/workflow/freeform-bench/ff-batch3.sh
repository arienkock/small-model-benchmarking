#!/usr/bin/env bash
# Free-form batch: load Qwen3.6 once (one proxy for the whole batch), then run
# N graded free-form sessions on books-api back to back.
#   ff-batch3.sh <prefix> <count> <cap-min>
# Extra env passes through: PI_SMALL_STYLE (style text), THINKING=on/off.
# Before each run a one-token completion must succeed; if it does not within
# ~3 minutes the proxy and server are restarted (base32k-4 hit a server that
# had vanished: ECONNREFUSED on its first request).
# Each run: workflow-runs/<prefix>-<i>; one summary line per run in ff-batch-<prefix>.txt.
cd /d/llama.cpp/pi-small || exit 1
prefix=$1; count=$2; cap=$3
MODEL=Qwen3.6-35B-A3B-Q4_K_M
out=ff-batch-$prefix.txt
AUTH="Authorization: Bearer sk-bench"
start_proxy() {
  taskkill //IM llama-server.exe //F >/dev/null 2>&1
  [ -n "$proxy" ] && kill $proxy 2>/dev/null
  sleep 3
  PI_SMALL_PORT=8123 PI_SMALL_API_KEY=sk-bench node proxy.mjs --model $MODEL ${THINKING:+--thinking $THINKING} >> ff-batch-$prefix.proxy.log 2>&1 &
  proxy=$!
  for i in $(seq 1 240); do sleep 5; curl -s -m 5 -H "$AUTH" http://127.0.0.1:8123/pi-small/status | grep -q "\"state\":\"ready\"" && break; done
  echo "proxy ready after $((i*5)) s ($(date -u +%H:%M:%S))" | tee -a $out
}
warm() {
  for w in $(seq 1 6); do
    curl -s -m 30 -H "$AUTH" -H "Content-Type: application/json" http://127.0.0.1:8125/completion -d "{\"prompt\":\"hi\",\"n_predict\":1}" | grep -q "\"content\"" && return 0
    sleep 10
  done
  return 1
}
node serve.mjs --stop >/dev/null 2>&1
proxy=""
start_proxy
for i in $(seq 1 $count); do
  rd=workflow-runs/$prefix-$i
  if ! warm; then echo "warm-up failed before run $i: restarting ($(date -u +%H:%M:%S))" | tee -a $out; start_proxy; warm; fi
  node workflow/run.ts --task workflow/tasks/books-api --model $MODEL --freeform --cap-min $cap ${THINKING:+--thinking $THINKING} --run-dir $rd > $rd.log 2>&1
  python workflow/freeform-bench/ff-summary.py "$rd" | tee -a $out
done
kill $proxy; sleep 3; taskkill //IM llama-server.exe //F >/dev/null 2>&1
echo "batch done $(date -u +%H:%M:%S)" | tee -a $out
