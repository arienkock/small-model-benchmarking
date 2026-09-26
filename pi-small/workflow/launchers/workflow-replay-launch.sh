#!/usr/bin/env bash
# One-off launcher: replay implement-T1 of rotation-20260924-201405 from the
# workspace as it was after attempt 1, with the new check and feedback. One
# attempt per model, same limits as the rotation run (10 turns, 15 min).
cd /d/llama.cpp/pi-small || exit 1
stamp=$(date +%Y%m%d-%H%M%S)
for m in Granite-4.2-3B-Q8_0 Spark-X2.5-4B-Q6_K LFM2.5-2.6B-Q8_0 MiniCPM5-2B-Q8_0 Nanbeige4.2-3B-Q6_K; do
	d=workflow-runs/replay-T1-$stamp-$m
	cp -r workflow-runs/replay-T1-base "$d"
	echo "===== $m $(date +%H:%M:%S) $d"
	node workflow/run.ts --resume --run-dir "$d" --model "$m" --config workflow/configs/replay-T1.json --no-grade 2>&1
	echo "===== $m done $(date +%H:%M:%S) exit $?"
done
echo "===== ALL DONE"
