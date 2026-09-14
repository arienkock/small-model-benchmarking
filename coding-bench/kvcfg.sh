#!/usr/bin/env bash
# Decide per-model KV cache precision at the benchmark's real context depth.
# Nanbeige hits a VRAM cliff at ~15k with f16 KV (12.4 t/s vs a ~42 t/s trend).
# Question: does q8_0 KV buy back enough headroom to clear it, and does it cost
# the models that already have headroom anything?
set -u
cd /d/llama.cpp || exit 1
OUT="coding-bench/kvcfg-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$OUT"
HUB=/c/Users/zenfi/.cache/huggingface/hub
LOCK=coding-bench/.bench-lock
[[ -d "$LOCK" ]] && rm -rf "$LOCK"; mkdir "$LOCK"; echo "$$" > "$LOCK/pid"
echo "kv-config probe -> $OUT" > "$LOCK/info"
trap 'rm -rf "$LOCK"' EXIT
log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$OUT/run.log"; }
res(){ ls $1 2>/dev/null | head -1; }
NAN=$(res "$HUB/models--bartowski--Nanbeige_Nanbeige4.2-3B-GGUF/snapshots/*/Nanbeige_Nanbeige4.2-3B-Q6_K.gguf")
GRA=$(res "$HUB/models--ibm-granite--granite-4.2-3b-GGUF/snapshots/*/granite-4.2-3b-Q8_0.gguf")
SPK=$(res "$HUB/models--sizzlebop--Spark-X2.5-4B-GGUF/snapshots/*/Spark-X2.5-4B-Q6_K.gguf")
run(){ # run <tag> <model> <kv> ; measured at d15360, the benchmark's real regime
  local tag="$1" m="$2" kv="$3"; shift 3
  log "START $tag (kv=$kv)"
  local extra=(); [[ "$kv" != f16 ]] && extra=(-ctk "$kv" -ctv "$kv")
  ./llama-bench.exe -m "$m" -ngl 999 -p 512 -n 64 -d 15360 -r 2 "${extra[@]}" \
      -o md > "$OUT/$tag.md" 2> "$OUT/$tag.stderr"
  log "DONE $tag rc=$?"
  grep -E '^\| *(nanbeige|granite|spark)' "$OUT/$tag.md" | tee -a "$OUT/run.log"
}
run nanbeige-f16  "$NAN" f16
run nanbeige-q8kv "$NAN" q8_0
run spark-f16     "$SPK" f16
run spark-q8kv    "$SPK" q8_0
run granite-f16   "$GRA" f16
log "KVCFG DONE"
