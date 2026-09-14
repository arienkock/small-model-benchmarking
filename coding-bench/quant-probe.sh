#!/usr/bin/env bash
# E1-E3 from coding-bench/round3-recommendation.md §9.
#   E1  quant policy: same-model K-quant vs Q8_0 (MiniCPM5 Q8_0/Q4_K_M, Nanbeige Q6_K/Q8_0)
#   E2  hardware facts: load_tensors buffers + offload + resident VRAM, recorded permanently
#   E3  Nanbeige prefill isolation: does the residual penalty scale with batch?
# Uses llama-bench, which reports prefill (pp) and decode (tg) separately — the
# distinction the harness's own probe conflates.
set -u
cd /d/llama.cpp || exit 1

OUT="coding-bench/quant-probe-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
LB=./llama-bench.exe
HUB=/c/Users/zenfi/.cache/huggingface/hub
export LLAMA_CACHE=/d/llama-cache   # C: has only ~9 GB free; stage downloads on D:
mkdir -p "$LLAMA_CACHE"

log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$OUT/run.log"; }

# Hold the bench lock so no scored run starts underneath this.
LOCK=coding-bench/.bench-lock
if [[ -d "$LOCK" ]]; then
    p="$(cat "$LOCK/pid" 2>/dev/null || true)"
    if [[ -n "$p" ]] && kill -0 "$p" 2>/dev/null; then
        echo "another bench run is active (pid $p); refusing to start" >&2; exit 1
    fi
    rm -rf "$LOCK"
fi
mkdir "$LOCK" || exit 1
echo "$$" > "$LOCK/pid"
echo "E1-E3 quant/prefill probe (llama-bench, no scored run) -> $OUT" > "$LOCK/info"

# Sample resident VRAM throughout — E2. Nobody has ever captured memory.used live.
( while true; do
    echo "$(date +%H:%M:%S) $(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits)"
    sleep 5
  done ) > "$OUT/vram.log" 2>&1 &
SMI=$!
cleanup(){ kill "$SMI" 2>/dev/null; rm -rf "$LOCK"; log "lock released"; }
trap cleanup EXIT

res(){ ls $1 2>/dev/null | head -1; }
LFM=$(res "$HUB/models--LiquidAI--LFM2.5-2.6B-GGUF/snapshots/*/LFM2.5-2.6B-Q8_0.gguf")
MCP8=$(res "$HUB/models--openbmb--MiniCPM5-2B-GGUF/snapshots/*/MiniCPM5-2B-Q8_0.gguf")
MCP4=$(res "$HUB/models--openbmb--MiniCPM5-2B-GGUF/snapshots/*/MiniCPM5-2B-Q4_K_M.gguf")
GRA=$(res "$HUB/models--ibm-granite--granite-4.2-3b-GGUF/snapshots/*/granite-4.2-3b-Q8_0.gguf")
SPK=$(res "$HUB/models--sizzlebop--Spark-X2.5-4B-GGUF/snapshots/*/Spark-X2.5-4B-Q6_K.gguf")
NAN6=$(res "$HUB/models--bartowski--Nanbeige_Nanbeige4.2-3B-GGUF/snapshots/*/Nanbeige_Nanbeige4.2-3B-Q6_K.gguf")
for v in LFM MCP8 MCP4 GRA SPK NAN6; do
    [[ -n "${!v}" ]] || { log "FATAL: $v did not resolve"; exit 1; }
    log "$v = ${!v}"
done

bench(){            # bench <tag> <llama-bench args...>
    local tag="$1"; shift
    log "START $tag"
    $LB "$@" -o md > "$OUT/$tag.md" 2> "$OUT/$tag.stderr"
    local rc=$?
    log "DONE  $tag rc=$rc"
    grep -E '^\|' "$OUT/$tag.md" 2>/dev/null | tee -a "$OUT/run.log"
}

log "===== Stage A — E1/E2 main table: pp512 / tg128, all on-disk models ====="
bench A-minicpm5-q8_0   -m "$MCP8" -ngl 999 -p 512 -n 128 -r 3
bench A-minicpm5-q4_k_m -m "$MCP4" -ngl 999 -p 512 -n 128 -r 3
bench A-lfm2.5-q8_0     -m "$LFM"  -ngl 999 -p 512 -n 128 -r 3
bench A-granite-q8_0    -m "$GRA"  -ngl 999 -p 512 -n 128 -r 3
bench A-spark-q6_k      -m "$SPK"  -ngl 999 -p 512 -n 128 -r 3
bench A-nanbeige-q6_k   -m "$NAN6" -ngl 999 -p 512 -n 128 -r 3

log "===== Stage B — E3 prefill scaling: does the penalty scale with batch? ====="
bench B-sweep-nanbeige-q6_k -m "$NAN6" -ngl 999 -p 128,512,2048 -n 128 -r 3
bench B-sweep-spark-q6_k    -m "$SPK"  -ngl 999 -p 128,512,2048 -n 128 -r 3
bench B-sweep-granite-q8_0  -m "$GRA"  -ngl 999 -p 128,512,2048 -n 128 -r 3

log "===== Stage C — E3 CPU baseline: confirm GPU offload is real ====="
bench C-cpu-nanbeige-q6_k -m "$NAN6" -ngl 0 -p 256 -n 16 -r 2
bench C-cpu-granite-q8_0  -m "$GRA"  -ngl 0 -p 256 -n 16 -r 2

log "===== Stage D — at depth, comparable to decode-measure @depth ====="
bench D-depth-minicpm5-q8_0   -m "$MCP8" -ngl 999 -p 512 -n 128 -d 2048 -r 2
bench D-depth-minicpm5-q4_k_m -m "$MCP4" -ngl 999 -p 512 -n 128 -d 2048 -r 2
bench D-depth-granite-q8_0    -m "$GRA"  -ngl 999 -p 512 -n 128 -d 2048 -r 2
bench D-depth-spark-q6_k      -m "$SPK"  -ngl 999 -p 512 -n 128 -d 2048 -r 2
bench D-depth-nanbeige-q6_k   -m "$NAN6" -ngl 999 -p 512 -n 128 -d 2048 -r 2

log "===== Stage E — E1 arm B: Nanbeige Q8_0 (downloads ~3.6 GB to D:) ====="
bench E-nanbeige-q8_0 -hf bartowski/Nanbeige_Nanbeige4.2-3B-GGUF \
                      -hff Nanbeige_Nanbeige4.2-3B-Q8_0.gguf \
                      -ngl 999 -p 128,512,2048 -n 128 -r 3

log "===== Collating ====="
{
  echo "# E1-E3 results — $(date)"
  echo
  echo "## llama-bench rows (model | size | params | backend | ngl | test | t/s)"
  for f in "$OUT"/*.md; do
      echo; echo "### $(basename "$f" .md)"; cat "$f"
  done
  echo
  echo "## Resident VRAM (MiB) observed during the probe"
  awk '{print $2}' "$OUT/vram.log" | sort -n | uniq -c | tail -20
  echo "peak: $(awk '{print $2}' "$OUT/vram.log" | sort -n | tail -1) MiB"
  echo
  echo "## Offload / buffer lines (E2 — absent from every server log at verbosity 3)"
  for f in "$OUT"/*.stderr; do
      echo; echo "### $(basename "$f" .stderr)"
      grep -iE "load_tensors|offload|buffer size|model size|model params|flash_attn|n_ctx" "$f" | head -25
  done
} > "$OUT/RESULTS.md"

log "ALL DONE -> $OUT/RESULTS.md"
