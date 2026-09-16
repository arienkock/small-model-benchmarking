#!/usr/bin/env bash
# Run the SmallCTL harness in a container against one of our llama-server
# models. Intended to be run ON the benchmark laptop (that is where the GPU,
# the weights and a working Docker Hub route all are):
#
#   ssh benchlaptop '/d/llama.cpp/smallctl-container/run.sh --task "..."'
#
# Everything after the script name is passed straight through to smallctl.
#
# Environment:
#   SMALLCTL_ENDPOINT  OpenAI-compatible base URL. Default reaches llama-server
#                      on the container host, matching run-filter-bench.sh's
#                      port and the pi agent's host.docker.internal route.
#   SMALLCTL_MODEL     llama-server --alias of the loaded model.
#   WORKSPACE          host directory the agent may read/write, mounted at
#                      /work. Default: $PWD. Point this at a scratch copy —
#                      smallctl can mutate files.
set -euo pipefail

IMAGE="${IMAGE:-smallctl:pinned}"
ENDPOINT="${SMALLCTL_ENDPOINT:-http://host.docker.internal:8123/v1}"
MODEL="${SMALLCTL_MODEL:-Spark-X2.5-4B-Q6_K}"
API_KEY="${SMALLCTL_API_KEY:-sk-bench}"
WORKSPACE="${WORKSPACE:-$PWD}"

# -t only when stdin really is a terminal, so the same script works over a
# non-interactive `ssh benchlaptop '...'` as well as by hand.
TTY_ARGS=(-i)
[ -t 0 ] && TTY_ARGS=(-it)

exec docker run --rm "${TTY_ARGS[@]}" \
  --add-host host.docker.internal:host-gateway \
  -e SMALLCTL_ENDPOINT="$ENDPOINT" \
  -e SMALLCTL_MODEL="$MODEL" \
  -e SMALLCTL_API_KEY="$API_KEY" \
  -e SMALLCTL_PROVIDER_PROFILE="${SMALLCTL_PROVIDER_PROFILE:-llamacpp}" \
  -e SMALLCTL_CONTEXT_LIMIT="${SMALLCTL_CONTEXT_LIMIT:-16384}" \
  -e SMALLCTL_RESERVE_COMPLETION_TOKENS="${SMALLCTL_RESERVE_COMPLETION_TOKENS:-2048}" \
  -v "$WORKSPACE":/work \
  "$IMAGE" "$@"
