#!/usr/bin/env bash
#
# persona/ctl.sh — the persona as an always-on service on the bench laptop.
#
#   ctl.sh install     register PersonaServer to start at boot, as you, logged in
#                      or not. No password: S4U logon (see install_task). Needs
#                      an elevated shell, which ssh to this laptop is.
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

# What the task runs: Git Bash, login shell, start.sh.
BASH_EXE='C:\Program Files\Git\bin\bash.exe'
START_SH="$(cd "$HERE" && pwd)/start.sh"

# Registered through PowerShell, not schtasks, because schtasks cannot set what
# an always-on service needs, and its defaults quietly break one:
#   - it kills a task after 3 days (ExecutionTimeLimit 72h)   -> no limit
#   - it will not start on battery, and stops when unplugged  -> both off
#   - it runs the task at priority 7, below normal, and with it llama-server,
#     whose memory Windows then pages out first            -> 4 (normal)
#   - "run whether logged on or not" needs a stored password, and its password
#     prompt does not work in Git Bash (it echoed the password and hung)
#     -> S4U logon: the user's own account, no password stored, no login needed.
#        It has no network CREDENTIALS (no shares); internet access is unaffected.
# $1 = trigger: "boot" (at startup, after 1 minute) or "none" (run on demand).
install_task() {
	local trigger="$1"
	powershell -NoProfile -Command "
		\$ErrorActionPreference = 'Stop'
		\$action = New-ScheduledTaskAction -Execute '$BASH_EXE' -Argument '-lc $START_SH'
		\$principal = New-ScheduledTaskPrincipal -UserId \$env:USERNAME -LogonType S4U -RunLevel Limited
		\$settings = New-ScheduledTaskSettingsSet -Priority 4 -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
		\$args = @{ TaskName = '$TASK'; Action = \$action; Principal = \$principal; Settings = \$settings; Force = \$true }
		if ('$trigger' -eq 'boot') { \$t = New-ScheduledTaskTrigger -AtStartup; \$t.Delay = 'PT1M'; \$args.Trigger = \$t }
		Register-ScheduledTask @args | Out-Null
	"
}

case "${1:-status}" in
install)
	install_task boot
	echo "Installed $TASK: at boot (after 1 minute), as $(whoami), logged in or not; no time limit, runs on battery."
	echo "It starts at the next boot; 'ctl.sh start' starts it now. A running instance is not affected."
	;;
start)
	if [[ -f "$HERE/../../coding-bench/.bench-lock/info" ]]; then
		echo "a bench run holds the GPU (coding-bench/.bench-lock); not starting" >&2
		exit 1
	fi
	schtasks //query //tn "$TASK" >/dev/null 2>&1 || {
		echo "no $TASK task; creating an on-demand one (run 'ctl.sh install' for the boot service)"
		install_task none
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
