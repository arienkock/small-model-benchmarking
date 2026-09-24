#!/bin/bash
# On the laptop: run every planned probe command. One container per run (coding-bench-agent, the
# image the agents ran in), no network; inside it every command gets a fresh workspace copy.
#   ./run-probes-laptop.sh /d/sup-bakeoff/probe-jobs
set -u
JOBS=$1
IMG=coding-bench-agent:latest
for d in "$JOBS"/*/; do
  rid=$(basename "$d")
  [ -f "$d/done" ] && continue
  src=$(python -c "import json,sys; print(json.load(open(sys.argv[1]))[sys.argv[2]]['src'])" "$JOBS/index.json" "$rid")
  mkdir -p "$d/out"
  MSYS_NO_PATHCONV=1 docker run --rm --network none \
    -v "$(cygpath -w "$src"):/src:ro" -v "$(cygpath -w "$d"):/probe" \
    "$IMG" bash -c '
      for f in $(ls /probe/cmds | sort -n); do
        rm -rf /workspace; cp -a /src /workspace; cd /workspace
        rm -f meta.txt stderr.log transcript.jsonl
        setsid bash -c "$(cat /probe/cmds/$f)" > /probe/out/$f.out 2>&1 < /dev/null &
        pid=$!
        ( sleep 10; kill -KILL -- -$pid 2>/dev/null ) & killer=$!
        wait $pid; rc=$?
        kill $killer 2>/dev/null; wait $killer 2>/dev/null
        kill -KILL -- -$pid 2>/dev/null
        pkill -KILL -f "^(python3|node) " 2>/dev/null
        echo $rc > /probe/out/$f.rc
      done'
  touch "$d/done"
  echo "$(date +%T) $rid"
done
echo ALL_DONE
