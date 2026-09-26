#!/usr/bin/env bash
#
# persona/start.sh — start the persona server (and, through pi, its
# llama-server), and keep it up. The target of the PersonaServer scheduled
# task (/tr is capped at 261 characters, so the task runs this script). Use
# persona/ctl.sh rather than running it by hand: over ssh it would die with
# the session.
#
# The API key is read from $PI_SMALL_PERSONA_HOME/api-key, and generated there
# on first start. Logs: $PI_SMALL_PERSONA_HOME/logs/.
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "${PI_SMALL_PERSONA_HOME:-}" ]]; then
	if [[ -d /d ]]; then PI_SMALL_PERSONA_HOME="D:/persona"; else PI_SMALL_PERSONA_HOME="$HOME/.sm-persona"; fi
fi
export PI_SMALL_PERSONA_HOME
mkdir -p "$PI_SMALL_PERSONA_HOME/logs"

# The model cache root: the one file that defines it (see the repo CLAUDE.md).
# shellcheck disable=SC1091
source "$HERE/../../llama-cache.env"

if [[ -f "$HERE/../../coding-bench/.bench-lock/info" ]]; then
	echo "persona: a bench run holds the GPU (coding-bench/.bench-lock); not starting" >&2
	exit 1
fi

# keepwarm.exe (see keepwarm.cs) keeps the model in RAM while the persona is
# idle. Built with the C# compiler every Windows 10 ships (.NET Framework 4).
CSC=/c/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe
if [[ -x "$CSC" && ( ! -f "$HERE/keepwarm.exe" || "$HERE/keepwarm.cs" -nt "$HERE/keepwarm.exe" ) ]]; then
	"$CSC" -nologo -optimize -platform:x64 -out:"$(cygpath -w "$HERE/keepwarm.exe")" "$(cygpath -w "$HERE/keepwarm.cs")" \
		|| echo "persona: could not build keepwarm.exe; the model may be paged out while idle" >&2
fi

KEY_FILE="$PI_SMALL_PERSONA_HOME/api-key"
if [[ ! -s "$KEY_FILE" ]]; then
	node -e 'process.stdout.write("sk-persona-" + require("node:crypto").randomBytes(18).toString("base64url"))' > "$KEY_FILE"
fi
export PERSONA_API_KEY="${PERSONA_API_KEY:-$(cat "$KEY_FILE")}"

cd "$HERE/.."
OUT="$PI_SMALL_PERSONA_HOME/logs/server-stdout.log"
STOPPED="$PI_SMALL_PERSONA_HOME/stopped"
rm -f "$STOPPED"   # a start is a start, whatever stopped it last time

# Restart loop: the server restarts its own pi child, and this restarts the
# server. `ctl.sh stop` writes $STOPPED first, so a deliberate stop stays down.
# Backs off, and gives up after 5 crashes within an hour.
crashes=()
while :; do
	echo "[start.sh $(date -Is)] starting persona/server.mjs" >> "$OUT"
	node persona/server.mjs >> "$OUT" 2>&1 && code=0 || code=$?
	[[ -e "$STOPPED" ]] && { echo "[start.sh $(date -Is)] stopped on purpose (exit $code)" >> "$OUT"; exit 0; }
	now=$(date +%s)
	recent=()
	for t in "${crashes[@]}"; do (( now - t < 3600 )) && recent+=("$t"); done
	crashes=("${recent[@]}" "$now")
	if (( ${#crashes[@]} > 5 )); then
		echo "[start.sh $(date -Is)] exit $code; 5 crashes within an hour, giving up" >> "$OUT"
		exit 1
	fi
	echo "[start.sh $(date -Is)] exit $code; restarting in $(( 10 * ${#crashes[@]} ))s" >> "$OUT"
	sleep $(( 10 * ${#crashes[@]} ))
done
