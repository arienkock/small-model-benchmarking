#!/usr/bin/env bash
set -u; cd /d/llama.cpp || exit 1
OUT="coding-bench/kv1-$(date +%H%M%S)"; mkdir -p "$OUT"
L=coding-bench/.bench-lock; rm -rf $L; mkdir $L; echo $$ > $L/pid; echo "kv1 probe" > $L/info
trap "rm -rf $L" EXIT
N=$(ls /c/Users/zenfi/.cache/huggingface/hub/models--bartowski--Nanbeige_Nanbeige4.2-3B-GGUF/snapshots/*/Nanbeige_Nanbeige4.2-3B-Q6_K.gguf | head -1)
echo "[$(date +%H:%M:%S)] nanbeige q8_0 KV @ d15360 (f16 baseline was 12.42 t/s)"
./llama-bench.exe -m "$N" -ngl 999 -p 512 -n 64 -d 15360 -r 1 -ctk q8_0 -ctv q8_0 -o md 2> "$OUT/err.log" | tee "$OUT/res.md"
echo "[$(date +%H:%M:%S)] KV1 DONE"
