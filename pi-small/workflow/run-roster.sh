#!/usr/bin/env bash
#
# run-roster.sh — run one task through the workflow for several models in turn,
# inside a fixed time window.
#
#   workflow/run-roster.sh <deadline> <task-dir> <model> [<model> ...]
#   workflow/run-roster.sh "2026-09-24 18:45" workflow/tasks/books-api Granite-4.2-3B-Q8_0 Spark-X2.5-4B-Q6_K
#
# Each model gets an equal share of the time left when it starts (time a model
# does not use carries over to the ones after it), passed to run.ts as
# --deadline, so the whole batch ends by <deadline>. A model with under 10
# minutes to its name is skipped. Results go to workflow-runs/roster-<stamp>/
# with one run directory per model and summary.tsv.
#
# A multi-hour job on the laptop: launch it with schtasks (see CLAUDE.md).
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.."

deadline="$1"; task="$2"; shift 2
end=$(date -d "$deadline" +%s) || { echo "bad deadline: $deadline" >&2; exit 2; }
out="workflow-runs/roster-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$out"
printf 'model\tstatus\tminutes\tgrade\tfailure\n' > "$out/summary.tsv"
echo "roster run: $* — until $(date -d @"$end") — $out"

left_models=$#
for model in "$@"; do
	now=$(date +%s)
	left=$(( end - now ))
	if (( left < 600 )); then
		echo "$(date +%T) skip $model: only $(( left / 60 )) min left"
		printf '%s\tskipped\t0\t\t%s\n' "$model" "time window used up" >> "$out/summary.tsv"
		left_models=$(( left_models - 1 ))
		continue
	fi
	stop=$(( now + left / left_models ))
	echo "$(date +%T) $model until $(date -d @"$stop" +%T)"
	node workflow/run.ts --task "$task" --model "$model" --run-dir "$out/$model" --deadline "$(( stop * 1000 ))" > "$out/$model.log" 2>&1
	rc=$?
	# One line per model from its own state.json and grade.json.
	node -e '
	  const fs = require("fs"), p = require("path"), dir = process.argv[1], model = process.argv[2];
	  const read = (f) => { try { return fs.readFileSync(p.join(dir, f), "utf8"); } catch { return ""; } };
	  let st = {}; try { st = JSON.parse(read("state.json")); } catch {}
	  let minutes = ""; for (const l of read("events.jsonl").split("\n")) { try { const e = JSON.parse(l); if (e.type === "workflow_end") minutes = e.minutes; } catch {} }
	  let grade = ""; try { const g = JSON.parse(read("grade.json").trim().split("\n").pop()); grade = g.startup && !g.startup.ok ? "no server" : `${g.passed}/${g.total}`; } catch {}
	  process.stdout.write([model, st.status ?? "no state", minutes, grade, (st.failure ?? "").split("\n")[0].slice(0, 200)].join("\t") + "\n");
	' "$out/$model" "$model" >> "$out/summary.tsv"
	echo "$(date +%T) $model done (exit $rc): $(tail -1 "$out/summary.tsv" | cut -f2-4)"
	left_models=$(( left_models - 1 ))
done

node serve.mjs --stop || true
echo "$(date +%T) roster run finished"
column -t -s $'\t' "$out/summary.tsv" 2>/dev/null || cat "$out/summary.tsv"
