#!/usr/bin/env bash
#
# persona/ctl.sh — the persona as an always-on service on the bench laptop.
#
#   ctl.sh install     register PersonaServer to start at boot, as you, logged in
#                      or not. Asks for your Windows password once: run it with
#                      `ssh -t benchlaptop /d/llama.cpp/pi-small/persona/ctl.sh install`
#   ctl.sh start       start it now (runs the same task)
#   ctl.sh stop        stop it and free the GPU; it stays down until start or reboot
#   ctl.sh status      server state, model, and the task
#   ctl.sh url         the base URL and API key for clients
#   ctl.sh uninstall   remove the boot task (stops nothing)
#
# Before a bench run or a coding session on another model: ctl.sh stop.
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TASK=PersonaServer
HOME_DIR="${PI_SMALL_PERSONA_HOME:-D:/persona}"
PORT="${PERSONA_PORT:-8130}"
KEY() { cat "$HOME_DIR/api-key" 2>/dev/null; }
api() { curl -s -m 10 -H "Authorization: Bearer $(KEY)" "$@"; }

# The task's command, short enough for /tr (261 characters).
BASH_EXE='C:\Program Files\Git\bin\bash.exe'
START_SH="$(cd "$HERE" && pwd)/start.sh"
TR="\"$BASH_EXE\" -lc $START_SH"

case "${1:-status}" in
install)
	user="$(whoami)"
	echo "Registering $TASK: at boot, as $user, whether or not anyone is logged in."
	echo "Windows needs $user's password for that; schtasks asks for it now."
	# /delay: let the disks and the network settle after boot.
	schtasks //create //tn "$TASK" //sc onstart //delay 0001:00 //ru "$user" //rp //f //tr "$TR"
	echo "Installed. It starts at the next boot; 'ctl.sh start' starts it now."
	;;
start)
	if [[ -f "$HERE/../../coding-bench/.bench-lock/info" ]]; then
		echo "a bench run holds the GPU (coding-bench/.bench-lock); not starting" >&2
		exit 1
	fi
	schtasks //query //tn "$TASK" >/dev/null 2>&1 || {
		echo "no $TASK task; creating a one-off (run 'ctl.sh install' for the boot service)"
		schtasks //create //tn "$TASK" //sc once //st 00:00 //f //tr "$TR" >/dev/null 2>&1
	}
	rm -f "$HOME_DIR/stopped"
	schtasks //run //tn "$TASK" >/dev/null
	echo "started; the model takes about 3 minutes to load and probe ('ctl.sh status')"
	;;
stop)
	touch "$HOME_DIR/stopped"
	if api -X POST "http://127.0.0.1:$PORT/persona/shutdown" >/dev/null; then
		for _ in $(seq 60); do
			tasklist //FI "IMAGENAME eq llama-server.exe" | grep -q llama-server || break
			sleep 1
		done
	fi
	schtasks //end //tn "$TASK" >/dev/null 2>&1 || true
	if tasklist //FI "IMAGENAME eq llama-server.exe" | grep -q llama-server; then
		echo "stopped the persona, but a llama-server is still running — check 'tasklist' before killing it" >&2
		exit 1
	fi
	echo "stopped; the GPU is free. It stays down until 'ctl.sh start' or the next boot."
	;;
status)
	echo "task:   $(schtasks //query //tn "$TASK" //fo LIST 2>/dev/null | awk -F': *' '/^Status/{print $2}' || echo 'not installed')"
	echo "health: $(curl -s -m 5 "http://127.0.0.1:$PORT/health" || echo 'not answering')"
	api "http://127.0.0.1:$PORT/persona/status" && echo
	;;
url)
	ip="$(powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { \$_.PrefixOrigin -eq 'Dhcp' } | Select-Object -First 1).IPAddress" | tr -d '\r')"
	echo "base URL: http://$ip:$PORT/v1"
	echo "API key:  $(KEY)"
	;;
uninstall)
	schtasks //delete //tn "$TASK" //f
	;;
*)
	sed -n '3,16p' "$0"
	exit 2
	;;
esac
