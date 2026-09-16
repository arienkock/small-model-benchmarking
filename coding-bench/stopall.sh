#!/usr/bin/env bash
# Stop every piece of the bench cleanly. schtasks //end kills the task's own
# shell but NOT the run-smallctl-bench.sh child, so orphaned arms pile up and
# fight over port 8123 and the GPU. Kill by command line instead.
schtasks //end //tn SmallctlArm >/dev/null 2>&1
sleep 1
for pid in $(powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='bash.exe'\" | Where-Object { \$_.CommandLine -match 'run-smallctl-bench|launch-smallctl-arm' } | ForEach-Object { \$_.ProcessId }" 2>/dev/null | tr -d '\r'); do
  taskkill //F //PID "$pid" >/dev/null 2>&1 && echo "killed bash $pid"
done
for c in $(docker ps -q --filter ancestor=smallctl:pinned); do docker rm -f "$c" >/dev/null 2>&1 && echo "removed container $c"; done
taskkill //F //IM llama-server.exe >/dev/null 2>&1 && echo "killed llama-server"
sleep 2
echo "bash left: $(powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \"Name='bash.exe'\" | Where-Object { \$_.CommandLine -match 'run-smallctl-bench' }).Count" 2>/dev/null | tr -d '\r')"
echo "server: $(tasklist //FI "IMAGENAME eq llama-server.exe" | tail -1)"
echo STOPALL_DONE
