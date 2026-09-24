#!/bin/bash
# Runs each command in /probe/cmds (one per file, NUL-safe) against a FRESH copy of /src at
# /workspace, 10 s limit, then kills its whole process group (servers started with & included).
# Writes /probe/out/<n>.out and /probe/out/<n>.rc
for f in $(ls /probe/cmds | sort -n); do
  rm -rf /workspace; cp -a /src /workspace; cd /workspace
  setsid bash -c "$(cat /probe/cmds/$f)" > /probe/out/$f.out 2>&1 < /dev/null &
  pid=$!
  ( sleep 10; kill -KILL -- -$pid 2>/dev/null ) & killer=$!
  wait $pid; rc=$?
  kill $killer 2>/dev/null; wait $killer 2>/dev/null
  kill -KILL -- -$pid 2>/dev/null
  pkill -KILL -f 'python3|node ' 2>/dev/null
  echo $rc > /probe/out/$f.rc
done
