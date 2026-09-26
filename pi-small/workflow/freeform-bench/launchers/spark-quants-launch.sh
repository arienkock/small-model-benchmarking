#!/usr/bin/env bash
# Download Spark Q4_K_M and Q8_0 outside LLAMA_CACHE (no -hf, so the cached Q6_K's
# refs are untouched), then run the same server bench on each.
cd /d/llama.cpp/pi-small || exit 1
D=/d/models/spark-x2.5-4b; mkdir -p $D
for q in Q4_K_M Q8_0; do
  [ -s $D/Spark-X2.5-4B-$q.gguf ] || curl -sL --fail -o $D/Spark-X2.5-4B-$q.gguf https://huggingface.co/sizzlebop/Spark-X2.5-4B-GGUF/resolve/main/Spark-X2.5-4B-$q.gguf || { echo "download $q failed"; continue; }
  ls -la $D/Spark-X2.5-4B-$q.gguf
  M=D:/models/spark-x2.5-4b/Spark-X2.5-4B-$q.gguf ./workflow/freeform-bench/spark-sweep.sh "$q|"
done
