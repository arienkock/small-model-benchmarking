#!/usr/bin/env bash
# Stage F — follow-up to E1-E3, forced by Stage A's result.
#
# Stage A measured Nanbeige Q6_K at pp512 = 128.3 t/s, only 2.0x slower than
# Granite Q8_0 (256.9) — exactly what nanbeige.num_loops=2 predicts. But the
# ROUND-3 SERVER logs show Nanbeige prefilling at 15.7 t/s against Granite's
# 218 t/s, a ~14x gap. Both cannot be intrinsic. The difference between the two
# settings is CONTEXT SIZE (llama-bench used ~640 tokens; the harness used
# -c 16384 with llama.cpp's default 4 slots).
#
# Hypothesis: at 16384 ctx Nanbeige no longer fits the 6 GiB card and spills,
# and its round-3 collapse is a VRAM/context configuration fault, not a model
# property. If true, the whole Nanbeige verdict changes again.
#
# F1  -v load lines: buffer sizes, offload, KV + compute buffers (E2, which
#     llama-bench suppresses without -v and the server suppresses at -lv 3)
# F2  depth sweep: find the depth at which Nanbeige's prefill collapses
# F3  reproduce the harness configuration exactly under llama-server -c 16384
set -u
cd /d/llama.cpp || exit 1

OUT="coding-bench/quant-probe-f3-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
LB=./llama-bench.exe
# The model cache lives on D:, not C:. Single source of truth — see the file
# itself for why this must be set explicitly.
source "/d/llama.cpp/llama-cache.env"

LS=./llama-server.exe
HUB=/c/Users/zenfi/.cache/huggingface/hub
export LLAMA_CACHE=/d/llama-cache
log(){ echo "[$(date +%H:%M:%S)] $*" | tee -a "$OUT/run.log"; }

LOCK=coding-bench/.bench-lock
if [[ -d "$LOCK" ]]; then
    p="$(cat "$LOCK/pid" 2>/dev/null || true)"
    if [[ -n "$p" ]] && kill -0 "$p" 2>/dev/null; then
        echo "bench lock held by pid $p; refusing" >&2; exit 1
    fi
    rm -rf "$LOCK"
fi
mkdir "$LOCK" || exit 1; echo "$$" > "$LOCK/pid"
echo "Stage F context/VRAM probe -> $OUT" > "$LOCK/info"

( while true; do echo "$(date +%H:%M:%S) $(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits)"; sleep 3; done ) > "$OUT/vram.log" 2>&1 &
SMI=$!
SRV=""
cleanup(){ kill "$SMI" 2>/dev/null; [[ -n "$SRV" ]] && kill "$SRV" 2>/dev/null; rm -rf "$LOCK"; log "lock released"; }
trap cleanup EXIT

res(){ ls $1 2>/dev/null | head -1; }
NAN6=$(res "$HUB/models--bartowski--Nanbeige_Nanbeige4.2-3B-GGUF/snapshots/*/Nanbeige_Nanbeige4.2-3B-Q6_K.gguf")
GRA=$(res "$HUB/models--ibm-granite--granite-4.2-3b-GGUF/snapshots/*/granite-4.2-3b-Q8_0.gguf")
SPK=$(res "$HUB/models--sizzlebop--Spark-X2.5-4B-GGUF/snapshots/*/Spark-X2.5-4B-Q6_K.gguf")

log "===== F3 — reproduce the harness config: llama-server -c 16384, -lv 4 ====="
# The harness launches with -c 16384 -ngl 999 and never sets --parallel, so
# llama.cpp defaults to 4 slots sharing a unified KV cache. Run both that and
# --parallel 1 to price §4.4 directly.
probe_server(){            # probe_server <tag> <model> <extra args...>
    local tag="$1" model="$2"; shift 2
    log "F3 $tag"
    "$LS" -m "$model" -c 16384 -ngl 999 -lv 4 \
        --host 127.0.0.1 --port 8127 "$@" > "$OUT/F3-$tag-server.log" 2>&1 &
    SRV=$!
    # /health returns 503 + a JSON body while the model is still loading, and
    # `curl -s` exits 0 regardless of HTTP status — so the status code must be
    # read explicitly or the probe "passes" before the model exists.
    local ok=0 code=""
    for _ in $(seq 1 150); do
        sleep 2
        code="$(curl -s -o /dev/null -w '%{http_code}' -m 3 http://127.0.0.1:8127/health 2>/dev/null || true)"
        [[ "$code" == "200" ]] && { ok=1; break; }
        kill -0 "$SRV" 2>/dev/null || { log "  $tag server exited during load"; break; }
    done
    if (( ! ok )); then log "  $tag FAILED to become healthy (last code=${code:-none})"; kill "$SRV" 2>/dev/null; SRV=""; return; fi
    log "  $tag healthy; VRAM now $(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits) MiB"
    # A ~7000-token prompt, which is what measure_tok_s sends and what the agent
    # actually accumulates by mid-run. No -m cap, so it cannot time out silently.
    awk 'BEGIN{split("lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim",w," ");for(i=0;i<5000;i++)printf "%s ",w[(i%20)+1]}' > "$OUT/.p.txt"
    jq -n --rawfile p "$OUT/.p.txt" '{prompt:$p,n_predict:64,ignore_eos:true,cache_prompt:false,temperature:0}' > "$OUT/.b.json"
    curl -s -H 'Content-Type: application/json' -d "@$OUT/.b.json" \
         http://127.0.0.1:8127/completion > "$OUT/F3-$tag-completion.json" 2>&1
    python - "$OUT/F3-$tag-completion.json" <<'PY' | tee -a "$OUT/run.log"
import json,sys
try:
    t=json.load(open(sys.argv[1])).get("timings",{})
    print(f"  timings: prompt_n={t.get('prompt_n')} prompt_per_second={t.get('prompt_per_second')} "
          f"predicted_n={t.get('predicted_n')} predicted_per_second={t.get('predicted_per_second')}")
except Exception as e: print(f"  timings: UNREADABLE ({e})")
PY
    log "  $tag VRAM at load+7k ctx: $(nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits) MiB"
    grep -iE "load_tensors|offloaded|buffer size|KV self|n_slots|kv_unified|compute buffer|failed|warn" \
        "$OUT/F3-$tag-server.log" | head -30 | tee -a "$OUT/run.log"
    kill "$SRV" 2>/dev/null; wait "$SRV" 2>/dev/null; SRV=""
    sleep 5
}

# Baselines: exactly what round 3 ran (4 slots, f16 KV), and the --parallel 1 fix.
probe_server nanbeige-4slot "$NAN6"
probe_server nanbeige-1slot "$NAN6" --parallel 1
probe_server granite-4slot  "$GRA"
probe_server granite-1slot  "$GRA" --parallel 1
probe_server spark-1slot    "$SPK" --parallel 1

# Per-model optimum: does q8_0 KV buy back the headroom that causes the cliff?
# Nanbeige needs it (301 MiB headroom at 16k f16). Spark does not need it, but
# if it frees enough room to afford Q8_0 WEIGHTS later, the trade may pay —
# which is the whole argument for tuning per model rather than uniformly.
probe_server nanbeige-kvq8 "$NAN6" --parallel 1 -ctk q8_0 -ctv q8_0
probe_server spark-kvq8    "$SPK" --parallel 1 -ctk q8_0 -ctv q8_0

log "===== Collating ====="
{
  echo "# Stage F — context/VRAM probe, $(date)"
  echo; echo "## F1 load facts"
  for f in "$OUT"/F1-*.stderr; do echo; echo "### $(basename "$f" .stderr)"
    grep -iE "load_tensors|offloaded|buffer size|KV self|model size|model params" "$f" | head -20; done
  echo; echo "## F2 depth sweep"
  for f in "$OUT"/F2-*.md; do echo "### $(basename "$f" .md)"; grep -E '^\| *(nanbeige|granite|spark)' "$f"; done
  echo; echo "## F3 harness-config reproduction"
  grep -E "F3|timings|VRAM" "$OUT/run.log"
  echo; echo "## VRAM peak: $(awk '{print $2}' "$OUT/vram.log" | sort -n | tail -1) MiB"
} > "$OUT/RESULTS.md"
log "STAGE F DONE -> $OUT/RESULTS.md"
