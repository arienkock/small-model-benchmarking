#!/usr/bin/env bash
#
# finalize-smallctl-arm.sh — merge the repeat passes, grade once, compare.
#
#   ./finalize-smallctl-arm.sh <rep1-run-dir> <rep2-run-dir> [pi-run-dir]
#
# The second repeat is run as a separate pass (BENCH_REP_START=2) and lands in
# its own run dir. Its workspaces are already named NN-r2-<model>, which is what
# grade-run.sh expects, so merging is a copy -- no renaming, no re-grading of
# the first pass.
#
# Grading happens ONCE, on the merged directory, so cross-repeat stability in
# STABILITY.txt actually sees both repeats. Grading the passes separately would
# report every component as n/1 and hide exactly the variance the repeats were
# run to measure.
set -uo pipefail

R1="${1:-}"; R2="${2:-}"; PI="${3:-bench-filter-20260914-203559}"
[[ -d "$R1" && -d "$R2" ]] || { echo "usage: $0 <rep1-dir> <rep2-dir> [pi-dir]" >&2; exit 2; }

MERGED="${R1%/}-merged"
rm -rf "$MERGED"; mkdir -p "$MERGED"

# Carry the run metadata from pass 1, then both passes' workspaces.
for f in "$R1"/*.txt "$R1"/*.json "$R1"/*.log; do
    [ -f "$f" ] && cp "$f" "$MERGED/" 2>/dev/null
done
n1=0; n2=0
for w in "$R1"/[0-9][0-9]-r*/; do [ -d "$w" ] && cp -r "$w" "$MERGED/" && n1=$((n1+1)); done
for w in "$R2"/[0-9][0-9]-r*/; do [ -d "$w" ] && cp -r "$w" "$MERGED/" && n2=$((n2+1)); done
echo "merged $n1 workspace(s) from $R1 and $n2 from $R2 -> $MERGED"

# A collision means both passes used the same repeat number, so one silently
# overwrote the other and the "two repeats" are really one.
total=$(ls -d "$MERGED"/[0-9][0-9]-r*/ 2>/dev/null | wc -l)
if [[ "$total" -ne $((n1+n2)) ]]; then
    echo "!! $((n1+n2)) workspaces copied but only $total present — the two passes share a repeat number." >&2
    echo "   Re-run the second pass with BENCH_REP_START=2 before trusting this." >&2
    exit 2
fi

echo "=== grading $MERGED ==="
./grade-run.sh "$MERGED" >/dev/null 2>&1 || { echo "grade-run.sh failed" >&2; exit 2; }
echo
cat "$MERGED/GRADES.txt"
echo
echo "=== cross-repeat stability ==="
cat "$MERGED/STABILITY.txt" 2>/dev/null
echo
if [[ -f "$PI/grades.tsv" ]]; then
    echo "=== pi vs smallctl ==="
    ./compare-harness.sh "$PI" "$MERGED"
else
    echo "(no pi arm at $PI — skipping the side-by-side)"
fi
