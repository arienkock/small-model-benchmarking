#!/usr/bin/env bash

# Head-to-head re-run: LFM2.5 vs MiniCPM5 with a higher reasoning budget.
# Fixes two issues from run-tests.sh:
#   1. -n 1024 starved MiniCPM's thinking -> answers truncated. Now -n 2048.
#   2. Context bumped to 8192 so 2048 generated tokens never crowd the prompt.

set -u

OUT="benchmark-h2h-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"

PROMPTS=()
CURRENT=""

while IFS= read -r LINE || [[ -n "$LINE" ]]; do
    LINE="${LINE%$'\r'}"
    if [[ "$LINE" == "===PROMPT===" ]]; then
        PROMPTS+=("$CURRENT")
        CURRENT=""
    else
        if [[ -n "$CURRENT" ]]; then
            CURRENT+=$'\n'
        fi
        CURRENT+="$LINE"
    fi
done < prompts.txt

if [[ -n "$CURRENT" ]]; then
    PROMPTS+=("$CURRENT")
fi

echo "Found ${#PROMPTS[@]} prompts."

if [[ ${#PROMPTS[@]} -ne 12 ]]; then
    echo "ERROR: Expected 12 prompts but found ${#PROMPTS[@]}."
    exit 1
fi

run_test () {
    NAME="$1"
    PROMPT_NUM="$2"
    PROMPT="$3"
    shift 3

    FILE="$OUT/$(printf '%02d' "$PROMPT_NUM")-$NAME.txt"

    echo
    echo "============================================================"
    echo "Prompt $PROMPT_NUM / ${#PROMPTS[@]} — $NAME"
    echo "============================================================"
    printf '%s\n' "$PROMPT"
    echo "============================================================"

    {
        echo "MODEL CONFIG: $NAME"
        echo
        echo "PROMPT:"
        printf '%s\n' "$PROMPT"
        echo
        echo "OUTPUT:"
        echo

        ./llama-cli.exe \
            "$@" \
            -ngl all \
            -c 8192 \
            -n 2048 \
            -st \
            --simple-io \
            --show-timings \
            -p "$PROMPT"

    } 2>&1 | tee "$FILE"
}

NUM=0

for PROMPT in "${PROMPTS[@]}"; do
    ((NUM+=1))

    run_test "lfm-q8" "$NUM" "$PROMPT" \
        -hf LiquidAI/LFM2.5-2.6B-GGUF:Q8_0

    run_test "minicpm-q8-unlimited" "$NUM" "$PROMPT" \
        -hf openbmb/MiniCPM5-2B-GGUF:Q8_0 \
        --reasoning on \
        --reasoning-budget -1
done

echo
echo "Finished."
echo "Results: $OUT"