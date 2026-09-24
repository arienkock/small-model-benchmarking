#!/bin/bash
# $1 = shard i/n, $2 = Laya URL
cd "$(dirname "$0")"
tag=${1/\//of}
python3 replay.py laya systemone $2 --laya --part finals --conds TE --generic-only --shard $1 > out/replay-laya-fteg-$tag.log 2>&1
python3 replay.py laya systemone $2 --laya --part finals --conds T,TE --max-k 3 --shard $1 > out/replay-laya-fgen-$tag.log 2>&1
python3 replay.py laya systemone $2 --laya --part invariants --max-k 3 --shard $1 > out/replay-laya-igen-$tag.log 2>&1
echo "LAYA_SHARD_DONE $1"
