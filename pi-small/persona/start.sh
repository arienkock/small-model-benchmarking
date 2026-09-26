#!/usr/bin/env bash
#
# persona/start.sh — start the persona server (and, through pi, its
# llama-server). The target of the PersonaServer scheduled task: /tr is capped
# at 261 characters, so the task runs this script rather than the command.
#
#   schtasks //create //tn PersonaServer //sc once //st 00:00 //f \
#     //tr "\"C:\Program Files\Git\bin\bash.exe\" -lc /d/llama.cpp/pi-small/persona/start.sh"
#   schtasks //run //tn PersonaServer
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

KEY_FILE="$PI_SMALL_PERSONA_HOME/api-key"
if [[ ! -s "$KEY_FILE" ]]; then
	node -e 'process.stdout.write("sk-persona-" + require("node:crypto").randomBytes(18).toString("base64url"))' > "$KEY_FILE"
fi
export PERSONA_API_KEY="${PERSONA_API_KEY:-$(cat "$KEY_FILE")}"

cd "$HERE/.."
exec node persona/server.mjs >> "$PI_SMALL_PERSONA_HOME/logs/server-stdout.log" 2>&1
