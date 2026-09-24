#!/usr/bin/env bash
#
# preflight.sh — before committing hours of agent sessions to a model, prove on
# the serving machine that it:
#
#   1. starts at a context pi can use, and what it costs in load time, VRAM and
#      free system RAM;
#   2. is serving the sampler and thinking mode the roster says (serve.mjs now
#      verifies this itself and exits 3 if not — this script stops there);
#   3. processes a realistic ~1000-token prompt and generates at a rate that
#      makes a session finishable — measured from llama-server's own timings;
#   4. emits a real tool call through the OpenAI `tool_calls` field.
#
# Every one of those failed silently at least once on the bench laptop. Two of
# the three configuration faults of 2026-09-22 were caught by this preflight,
# not by the runs.
#
#   eval/preflight.sh Qwen3.6-35B-A3B-Q4_K_M Qwen3.8-27B-UD-IQ4_XS
#   PI_SMALL_THINKING=off eval/preflight.sh Qwen3.6-35B-A3B-Q4_K_M
#
# Stops each model afterwards. Loads take minutes for the beyond-VRAM models;
# on the laptop run this under schtasks (see the repo CLAUDE.md), not a bare ssh.
#
set -uo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE" || exit 1
[[ -f ../llama-cache.env ]] && source ../llama-cache.env

[[ $# -gt 0 ]] || { sed -n '2,23p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

PORT="${PI_SMALL_PORT:-8123}"
KEY="${PI_SMALL_API_KEY:-sk-bench}"
URL="http://127.0.0.1:$PORT"

# ~1000 tokens of prose and a two-sentence answer: large enough to measure
# prompt processing the way a real first turn pays for it, small enough to stay
# quick. Built here rather than read from a file so the script is self-contained.
summary_body() {
	node -e '
	  const para = "A word-frequency tool reads a file, normalises each token to lower case, strips punctuation from the edges, counts the remaining tokens, and reports the most common ones. The interesting part is not the counting but the reporting: the caller decides whether the count or the word comes first, and a mismatch there is invisible to every test that only checks that ten lines came out.\n\n";
	  process.stdout.write(JSON.stringify({
	    messages: [{ role: "user", content: "The following is a short technical note.\n\n" + para.repeat(12) + "\nSummarise the note above in exactly two sentences." }],
	    max_tokens: 160,
	  }));'
}
tool_body() {
	node -e '
	  process.stdout.write(JSON.stringify({
	    messages: [{ role: "user", content: "List the files in the current directory. Use the bash tool to do it." }],
	    tools: [{ type: "function", function: { name: "bash", description: "Run a bash command and return its output.",
	      parameters: { type: "object", properties: { command: { type: "string", description: "the command to run" } }, required: ["command"] } } }],
	    max_tokens: 400,
	  }));'
}

# One request; print what the SERVER measured (timings), not wall clock.
ask() {
	local body="$1"
	printf '%s' "$body" | curl -s -m 3600 "$URL/v1/chat/completions" \
		-H "Authorization: Bearer $KEY" -H "Content-Type: application/json" --data-binary @- |
		node -e '
		  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
		    let j; try { j = JSON.parse(s); } catch { console.log("  UNPARSEABLE: " + s.slice(0, 300)); return; }
		    if (j.error) { console.log("  ERROR: " + JSON.stringify(j.error).slice(0, 300)); return; }
		    const c = j.choices?.[0] ?? {}, m = c.message ?? {}, t = j.timings ?? {};
		    const rate = (n, ms) => (n && ms ? (n / (ms / 1000)).toFixed(2) : "?");
		    console.log(`  finish=${c.finish_reason}  prompt ${t.prompt_n ?? "?"} tok @ ${rate(t.prompt_n, t.prompt_ms)} t/s  generated ${t.predicted_n ?? "?"} tok @ ${rate(t.predicted_n, t.predicted_ms)} t/s`);
		    console.log(`  tool_calls=${(m.tool_calls ?? []).map((x) => x.function?.name).join(",") || "none"}  reasoning=${m.reasoning_content ? m.reasoning_content.length + " chars" : "none"}`);
		    console.log("  content: " + JSON.stringify(String(m.content ?? "").slice(0, 200)));
		  });'
}

for MODEL in "$@"; do
	echo "================================================================"
	echo "=== $MODEL   $(date "+%Y-%m-%dT%H:%M:%S%z")   thinking override: ${PI_SMALL_THINKING:-none}"
	node serve.mjs --stop >/dev/null 2>&1
	sleep 3
	T0=$(date +%s)
	node serve.mjs "$MODEL" --host 127.0.0.1
	rc=$?
	if [[ $rc -ne 0 ]]; then
		echo "!!! serve.mjs exited $rc for $MODEL — $([[ $rc -eq 3 ]] && echo "it is running but does NOT match the roster (see VERIFY FAIL above)" || echo "it did not start")"
		node serve.mjs --stop >/dev/null 2>&1
		continue
	fi
	echo "load_seconds=$(( $(date +%s) - T0 ))"
	command -v nvidia-smi >/dev/null && nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader | sed 's/^/vram: /'
	command -v wmic >/dev/null && wmic OS get FreePhysicalMemory //value 2>/dev/null | tr -d '\r' | grep = | sed 's/^/ram: /'
	echo "-- ~1000-token prompt, short answer"
	ask "$(summary_body)"
	echo "-- tool call"
	ask "$(tool_body)"
	echo "=== done $MODEL $(date "+%Y-%m-%dT%H:%M:%S%z")"
done

node serve.mjs --stop >/dev/null 2>&1
echo "ALL PREFLIGHTS DONE $(date "+%Y-%m-%dT%H:%M:%S%z")"
