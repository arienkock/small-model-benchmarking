#!/usr/bin/env bash
#
# pi-small-docker.sh — run pi-small in a container, against a model served on
# the host. This is the convenient way to use the scaffold.
#
#   ./pi-small-docker.sh                          # roster default, interactive
#   ./pi-small-docker.sh --model LFM2.5-2.6B-Q8_0
#   ./pi-small-docker.sh --ws ./scratch           # a different workspace
#   ./pi-small-docker.sh -- -p "list the files"   # one-shot, args after -- go to pi
#   ./pi-small-docker.sh --model Qwen3.6-35B-A3B-Q4_K_M --thinking off
#
# WHY A CONTAINER. The models get bash with no guard extension, and two of the
# ones on the roster have history: LFM2.5 overwrote the task prompt in two
# benchmark tasks, MiniCPM5 went looking for `npm install`. The benchmark
# answers this by running pi in a Linux sandbox whose only writable host path is
# the workspace; this does the same.
#
# WHAT RUNS WHERE.
#
#   host       llama-server.exe + the GPU + the weights. Started by serve.mjs,
#              bound to 0.0.0.0 so the container can reach it.
#   container  pi + the plugin + bash. Reaches the server through
#              host.docker.internal. Cannot start, stop or switch the model —
#              the plugin runs in remote mode and says so.
#
# The workspace persists between runs: it is a host directory, mounted rw. The
# plugin is mounted READ-ONLY, so a model cannot edit the thing that constrains
# it.
#
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

IMAGE="${PI_SMALL_IMAGE:-pi-small-agent:latest}"
WS="${PI_SMALL_WS:-$HERE/workspace}"
MODEL="${PI_SMALL_MODEL:-}"
THINKING="${PI_SMALL_THINKING:-}"
PORT="${PI_SMALL_PORT:-8123}"
API_KEY="${PI_SMALL_API_KEY:-sk-bench}"
SERVE=1

PI_ARGS=()
while [[ $# -gt 0 ]]; do
	case "$1" in
		--model) MODEL="${2:-}"; shift 2 ;;
		--thinking) THINKING="${2:-}"; shift 2 ;;
		--ws)    WS="${2:-}";    shift 2 ;;
		--image) IMAGE="${2:-}"; shift 2 ;;
		--no-serve) SERVE=0; shift ;;
		--help|-h)
			sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
			exit 0 ;;
		--) shift; PI_ARGS=("$@"); break ;;
		*)  PI_ARGS+=("$1"); shift ;;
	esac
done

command -v docker >/dev/null 2>&1 || { echo "pi-small-docker: docker not found" >&2; exit 1; }
docker info >/dev/null 2>&1 || {
	echo "pi-small-docker: docker daemon not reachable — start Docker Desktop" >&2
	exit 1
}

# --------------------------------------------------------------- the image --
# Every run, not just the first: Dockerfile edits (a new language toolchain,
# say) take effect on the next invocation instead of needing a manual rmi.
# Docker's layer cache makes the common case — nothing changed — fast.
echo "pi-small-docker: building $IMAGE ..."
docker build -t "$IMAGE" "$HERE/docker" || { echo "pi-small-docker: build failed" >&2; exit 1; }

# ----------------------------------------------------------- the workspace --
# A real host directory, so everything the model writes survives the container.
mkdir -p "$WS" || { echo "pi-small-docker: cannot create workspace $WS" >&2; exit 1; }
# pi's own state (sessions, history) lives in the workspace too, so a session can
# be resumed after the container is gone.
mkdir -p "$WS/.home"

# --------------------------------------------------------------- the model --
if (( SERVE )); then
	echo "pi-small-docker: ensuring llama-server on the host ..."
	if ! ( cd "$HERE" && node serve.mjs ${MODEL:+"$MODEL"} ${THINKING:+--thinking "$THINKING"} ); then
		echo "pi-small-docker: could not start the model server — not launching the container" >&2
		exit 1
	fi
fi

# ------------------------------------------------------------ the container --
# MSYS_NO_PATHCONV stops Git Bash rewriting the container-side paths; cygpath
# turns the host paths into the Windows form docker expects.
towin() { cygpath -w "$1" 2>/dev/null || echo "$1"; }

# Invoked through `bash` rather than directly: the entry point comes in over a
# bind mount from a Windows filesystem, which has no execute bit to honour.

# PI_SMALL_SYSTEM_PROMPT is the roster-wide system-prompt fallback bin/pi-small
# reads (a model with its own roster.json `systemPrompt` still overrides it, per
# turn, in the plugin). Without this pass-through it simply does not exist in the
# containerised path: the env var is set on the host, the agent runs in the
# container, and the session silently gets the near-empty default instead — which
# is indistinguishable from a prompt that had no effect. Passed only when set, so
# an unset one does not become the empty string, which pi treats as "no override"
# anyway but for a different reason.
PROMPT_ARGS=()
if [[ -n "${PI_SMALL_SYSTEM_PROMPT:-}" ]]; then
	PROMPT_ARGS=(-e "PI_SMALL_SYSTEM_PROMPT=$PI_SMALL_SYSTEM_PROMPT")
fi

# The model and the thinking mode, for the same reason. Without PI_SMALL_MODEL
# the container's bin/pi-small fell back to the roster default for pi's own
# --model, so every session record said "Spark-X2.5-4B" whatever the host was
# serving (the plugin itself followed the real server, so the sampler was
# right; the record was not). Without PI_SMALL_THINKING the plugin's per-request
# switch and sampler would follow the roster default mode while serve.mjs had
# started the other one.
MODEL_ARGS=()
[[ -n "$MODEL" ]] && MODEL_ARGS+=(-e "PI_SMALL_MODEL=$MODEL")
[[ -n "$THINKING" ]] && MODEL_ARGS+=(-e "PI_SMALL_THINKING=$THINKING")

# -it only when there really is a terminal. Under schtasks, CI, or any pipe
# there is not, and `docker run -it` fails outright with "the input device is
# not a TTY" — so a one-shot `-- -p "..."` would break for the least obvious
# reason. Without a TTY, stdin is /dev/null so pi gets EOF instead of blocking.
TTY_ARGS=()
if [[ -t 0 && -t 1 ]]; then
	TTY_ARGS=(-it)
else
	exec < /dev/null
fi

exec env MSYS_NO_PATHCONV=1 docker run --rm ${TTY_ARGS[@]+"${TTY_ARGS[@]}"} \
	--name "pi-small-$$" \
	-v "$(towin "$WS"):/workspace" \
	-v "$(towin "$HERE"):/opt/pi-small:ro" \
	-w /workspace \
	-e HOME=/workspace/.home \
	-e PI_SMALL_REMOTE=1 \
	-e PI_SMALL_HOST=host.docker.internal \
	-e PI_SMALL_PORT="$PORT" \
	-e PI_SMALL_API_KEY="$API_KEY" \
	${PROMPT_ARGS[@]+"${PROMPT_ARGS[@]}"} \
	${MODEL_ARGS[@]+"${MODEL_ARGS[@]}"} \
	--add-host=host.docker.internal:host-gateway \
	"$IMAGE" \
	bash /opt/pi-small/bin/pi-small ${PI_ARGS[@]+"${PI_ARGS[@]}"}
