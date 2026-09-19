#!/usr/bin/env bash
#
# smoke.sh — prove pi-small works against the real llama-server.
#
# Run on the serving machine (the bench laptop). It brings up the roster's
# default model through the plugin and asks the model to read a nonce that only
# exists on disk: a model cannot answer this without a tool call that really
# executed, so a matching answer is proof of the whole path — server start,
# template, tool_calls channel, bash execution, result round-trip.
#
# Long enough to outlive an SSH session, so launch it through schtasks:
#
#   schtasks //create //tn PiSmallSmoke //sc once //st 00:00 //f //tr \
#     "\"C:\Program Files\Git\bin\bash.exe\" -lc \"cd /d/llama.cpp/pi-small && ./smoke.sh > smoke.log 2>&1\""
#   schtasks //run //tn PiSmallSmoke
#
set -uo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PI_SMALL_LOG_DIR="${PI_SMALL_LOG_DIR:-$PLUGIN_DIR/.logs}"
mkdir -p "$PI_SMALL_LOG_DIR"

WS="$PLUGIN_DIR/.smoke-ws"
rm -rf "$WS" && mkdir -p "$WS"
NONCE="pismall-$(date +%s)-$RANDOM"
echo "$NONCE" > "$WS/secret.txt"

echo "=== pi-small smoke $(date) ==="
echo "model:     ${PI_SMALL_MODEL:-<roster default>}"
echo "workspace: $WS"
echo "nonce:     $NONCE"
echo

PROMPT="There is a file called secret.txt in the current directory. Use the bash tool to read it, then reply with its exact contents and nothing else."

OUT="$WS/pi-output.txt"
( cd "$WS" && "$PLUGIN_DIR/bin/pi-small" -p "$PROMPT" ) > "$OUT" 2>&1
rc=$?

echo "--- pi output -----------------------------------------------------------"
cat "$OUT"
echo "-------------------------------------------------------------------------"
echo "pi exit: $rc"

if grep -q "$NONCE" "$OUT"; then
	echo "RESULT: PASS — the model returned the nonce, so bash really ran"
	exit 0
fi
echo "RESULT: FAIL — the nonce never came back. Check the llama-server log in $PI_SMALL_LOG_DIR"
exit 1
