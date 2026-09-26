#!/usr/bin/env bash
# Free-form books-api batches for Spark-X2.5-4B: <prefix>:<quant> pairs, run in order.
# A quant other than Q6_K is a TEMPORARY roster edit (Spark's localFile pointed at
# D:/models/spark-x2.5-4b/), restored after each batch.
#   spark-ff-launch.sh <count> <cap-min> sparkq6:Q6_K sparkq4:Q4_K_M ...
cd /d/llama.cpp/pi-small || exit 1
count=$1; cap=$2; shift 2
cp roster.json .roster.committed.json
for pair in "$@"; do
  prefix=${pair%%:*}; quant=${pair#*:}
  if [ "$quant" != Q6_K ]; then
    QUANT=$quant python - <<'PY'
import json, os
r = json.load(open("roster.json"))
s = [m for m in r["models"] if m["alias"] == "Spark-X2.5-4B-Q6_K"][0]
s["localFile"] = f"D:/models/spark-x2.5-4b/Spark-X2.5-4B-{os.environ['QUANT']}.gguf"
json.dump(r, open("roster.json", "w"), indent="\t")
PY
  fi
  echo "=== $prefix ($quant) $(date -u +%H:%M:%S)"
  MODEL=Spark-X2.5-4B-Q6_K ./workflow/freeform-bench/ff-batch3.sh $prefix $count $cap
  cp .roster.committed.json roster.json
done
