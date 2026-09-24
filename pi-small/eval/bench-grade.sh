#!/usr/bin/env bash
#
# bench-grade.sh — grade pi-small workspaces with coding-bench's OWN grader,
# unchanged, so a pi-small result is directly comparable to the 3-4B rounds.
#
#   eval/bench-grade.sh <task> <label>=<workspace> [<label>=<workspace> ...]
#
#   eval/bench-grade.sh 1 Qwen3.6=runs/d1 Qwen3.8=runs/d2     # debounce
#
# <task> is the coding-bench filter task number (1 debounce, 2 throttle +
# rate-limited server, 3 books server). coding-bench/grade-run.sh wants
# <run dir>/<task>-r<rep>-<model>/<files>; this builds that layout in a scratch
# directory from copies — it never touches the workspaces — runs the grader
# there, and prints grades.tsv. Repeats of the same label become r1, r2, ...
#
# Grading is by EXECUTION: the grader imports the exported function (task 1:
# graders/debounce.grader.ts, one assertion per seeded bug) and runs the
# model's own file separately to classify its self-test. Never grade a model by
# what it says it did.
#
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
BENCH="$(cd "$HERE/../../coding-bench" && pwd)" || { echo "coding-bench not found next to pi-small" >&2; exit 2; }

TASK="${1:-}"
shift || true
[[ "$TASK" =~ ^[0-9]+$ && $# -gt 0 ]] || { sed -n '4,9p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2; }

OUT="$(mktemp -d "${TMPDIR:-/tmp}/bench-grade-XXXXXX")"
NN="$(printf '%02d' "$TASK")"
for pair in "$@"; do
	label="${pair%%=*}"; ws="${pair#*=}"
	[[ -d "$ws" ]] || { echo "not a directory: $ws" >&2; exit 2; }
	# Repeat number = how many of this label are already laid out, plus one.
	# Counted from the directories rather than an associative array: macOS still
	# ships bash 3.2, which has none, and this runs on the analysis Mac too.
	rep=1
	while [[ -d "$OUT/$NN-r$rep-$label" ]]; do rep=$((rep + 1)); done
	dest="$OUT/$NN-r$rep-$label"
	mkdir -p "$dest"
	# Copy the deliverables, not the agent's home or its caches.
	find "$ws" -maxdepth 1 -type f -exec cp {} "$dest/" \;
done

"$BENCH/grade-run.sh" "$OUT" >/dev/null 2>&1
if [[ -f "$OUT/grades.tsv" ]]; then
	cut -f2- "$OUT/grades.tsv"
	echo "(graded copies in $OUT)" >&2
else
	echo "grade-run.sh produced no grades.tsv — see $OUT" >&2
	exit 1
fi
