#!/usr/bin/env bash

set -u

OUT="benchmark-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"

PROMPTS=()
CURRENT=""

while IFS= read -r LINE || [[ -n "$LINE" ]]; do
    # Remove Windows CR from CRLF line endings
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

# Add the final prompt
if [[ -n "$CURRENT" ]]; then
    PROMPTS+=("$CURRENT")
fi

echo "Found ${#PROMPTS[@]} prompts."

# Safety check — should say 12
if [[ ${#PROMPTS[@]} -ne 12 ]]; then
    echo "ERROR: Expected 12 prompts but found ${#PROMPTS[@]}."
    echo "Not running benchmarks."
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
            -c 4096 \
            -n 1024 \
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

    run_test "minicpm-q8-no-reasoning" "$NUM" "$PROMPT" \
        -hf openbmb/MiniCPM5-2B-GGUF:Q8_0 \
        --reasoning off

    run_test "minicpm-q8-r64" "$NUM" "$PROMPT" \
        -hf openbmb/MiniCPM5-2B-GGUF:Q8_0 \
        --reasoning on \
        --reasoning-budget 64

    run_test "minicpm-q8-r128" "$NUM" "$PROMPT" \
        -hf openbmb/MiniCPM5-2B-GGUF:Q8_0 \
        --reasoning on \
        --reasoning-budget 128

    run_test "minicpm-q8-unlimited" "$NUM" "$PROMPT" \
        -hf openbmb/MiniCPM5-2B-GGUF:Q8_0 \
        --reasoning on \
        --reasoning-budget -1
done

echo
echo "Finished."
echo "Results: $OUT"
