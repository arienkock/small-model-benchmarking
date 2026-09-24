#!/bin/bash
cd "$(dirname "$0")"

python3 replay.py laya systemone http://127.0.0.1:18011 --laya --part finals --conds TE --generic-only > out/replay-laya-finals-TE-generic.log 2>&1
python3 replay.py laya systemone http://127.0.0.1:18011 --laya --part finals --conds T,TE --max-k 3 > out/replay-laya-finals-gen.log 2>&1
python3 replay.py laya systemone http://127.0.0.1:18011 --laya --part invariants --max-k 3 > out/replay-laya-inv-gen.log 2>&1
echo LAYA_DONE
