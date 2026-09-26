#!/usr/bin/env bash
# Stop the overnight run: task, containers, runner, and every llama-server.
schtasks //end //tn WorkflowOvernight >/dev/null 2>&1
docker ps --format "{{.Names}}" | grep "^wf-" | xargs -r docker kill >/dev/null
sleep 5
taskkill //IM llama-server.exe //F >/dev/null 2>&1
sleep 2
tasklist //FI "IMAGENAME eq llama-server.exe" | tail -1
