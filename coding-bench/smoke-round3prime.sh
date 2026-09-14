#!/usr/bin/env bash
# Round-3' smoke test: settles the ONE question that gates the whole round —
# does VibeThinker emit a parseable tool call with the Qwen2.5 tools template?
#
# Rounds 1-3 spent, between them, several hours proving it does not with the
# stock template. This costs minutes. Run it and read PREFLIGHT.txt BEFORE
# launching round3prime.sh.
#
#   VibeThinker tool_calls=OK    -> the attempt worked; run the real round.
#   VibeThinker tool_calls=FAIL  -> if the sample shows <think>-wrapped prose,
#                                   add --reasoning-format deepseek to its
#                                   server_args and run this again. If it still
#                                   fails, the one attempt round 3 granted is
#                                   spent: drop it and run the round with the
#                                   two incumbents.
#
# Also verifies, for all three: the model loads with its per-model server_args,
# both preflight probes pass, and measure_tok_s returns a NUMBER (the round-3
# defect that put Nanbeige on a third of its peers' budget).
#
# AND the new ESM write-block in bench-guard.ts. The task-1 smoke prompt is the
# debounce bugfix, which is exactly where round 4 saw require.main/__filename,
# so Granite is likely to trip it here. What to check afterwards:
#   grep -c . <run>/*/meta.txt signal_guard_blocks   -> corrections are counted
#   the transcript after a block                     -> the model must move on,
#     not re-issue the same write. 13 of 13 blocks in rounds 1-4 were followed
#     by a different action; if a model loops on this one instead, the block
#     message is wrong and must be fixed before the real round.
set -u
cd /d/llama.cpp/coding-bench || exit 1
export BENCH_MODELS=/d/llama.cpp/coding-bench/models-round3prime.conf
export BENCH_PROMPTS=/d/llama.cpp/coding-bench/prompts-smoke.txt
export BENCH_REPEATS=1
export BENCH_TOKEN_BUDGET=1500
export BENCH_MIN_RUN_SEC=240
export BENCH_MAX_RUN_SEC=420
export BENCH_DEADLINE="${BENCH_DEADLINE:-tomorrow 07:00}"
exec ./run-filter-bench.sh
