#!/usr/bin/env bash
# .after-task.sh <task-name> <launcher> — wait for that scheduled task to finish, then run the launcher.
cd /d/llama.cpp/pi-small || exit 1
t=$1; shift
while schtasks //query //tn "$t" //fo LIST | grep -qi "Running"; do sleep 30; done
sleep 10
exec "$@"
