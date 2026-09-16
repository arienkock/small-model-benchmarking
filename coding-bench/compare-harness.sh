#!/usr/bin/env bash
#
# compare-harness.sh — put two graded runs side by side, per (task, model).
#
#   ./compare-harness.sh <pi-run-dir> <smallctl-run-dir>
#
# Both arguments must already have been graded by grade-run.sh (it writes
# grades.tsv into the run dir). Nothing here re-grades or re-runs anything: the
# verdicts come only from those files, so this script cannot disagree with the
# grader.
#
# The .algo/.pkg split is preserved rather than collapsed to a pass count: a
# correct algorithm killed by its own scaffolding is a different failure from a
# wrong algorithm, and for a harness comparison that distinction is the whole
# point — scaffolding is exactly what a harness is supposed to get right.
set -uo pipefail

PI="${1:-}"; SC="${2:-}"
for d in "$PI" "$SC"; do
    [[ -n "$d" && -f "$d/grades.tsv" ]] || {
        echo "usage: $0 <pi-run-dir> <smallctl-run-dir>   (both must contain grades.tsv)" >&2
        exit 2
    }
done

# Pre-round-3 runs wrote a different grades.tsv layout, and feeding one in here
# does not fail -- it silently parses verdict text as model names and prints
# rows like "LOGIC_FAIL  1  0/41". Check the shape before trusting anything.
check_format() {
    local tsv="$1" label="$2" bad
    bad="$(awk -F'\t' 'NR>1 && ($3 ~ /:/ || $3=="" || $4 !~ /:/) {c++} END{print c+0}' "$tsv")"
    if [[ "$bad" -gt 0 ]]; then
        echo "!! $label ($tsv) is not in the current grades.tsv format:" >&2
        echo "   $bad row(s) have a verdict where the model name should be." >&2
        echo "   Re-grade that run with the current ./grade-run.sh before comparing." >&2
        exit 2
    fi
}
check_format "$PI/grades.tsv" "pi arm"
check_format "$SC/grades.tsv" "smallctl arm"

echo "pi arm:       $PI"
echo "smallctl arm: $SC"
echo

# component verdicts look like "debounce.algo:PASS debounce.pkg:FAIL"
summarise() {  # <tsv> -> "model<TAB>task<TAB>algo_pass/algo_n<TAB>pkg_pass/pkg_n"
    awk -F'\t' 'NR>1 {
        task=$1; model=$3; verdict=$4
        n=split(verdict, parts, / /)
        for (i=1; i<=n; i++) {
            split(parts[i], kv, ":")
            key=kv[1]; val=kv[2]
            if (key ~ /\.algo$/) { at[model,task]++; if (val=="PASS") ap[model,task]++ }
            else if (key ~ /\.pkg$/) { pt[model,task]++; if (val=="PASS") pp[model,task]++ }
            else { ot[model,task]++; if (val=="PASS") op[model,task]++ }
        }
        seen[model SUBSEP task]=1
    }
    END {
        for (k in seen) {
            split(k, a, SUBSEP); m=a[1]; t=a[2]
            printf "%s\t%s\t%d/%d\t%d/%d\t%d/%d\n", m, t,
                   ap[m,t]+0, at[m,t]+0, pp[m,t]+0, pt[m,t]+0, op[m,t]+0, ot[m,t]+0
        }
    }' "$1" | sort
}

PI_T=$(mktemp); SC_T=$(mktemp)
trap 'rm -f "$PI_T" "$SC_T"' EXIT
summarise "$PI/grades.tsv"  > "$PI_T"
summarise "$SC/grades.tsv"  > "$SC_T"

# Merge with awk rather than join: join needs both inputs collated the same way
# as the shell's sort, and model names full of '-' and '.' make that a silent
# locale trap that yields zero rows instead of an error.
awk -F'\t' '
    FNR==NR { pa[$1 SUBSEP $2]=$3; pp[$1 SUBSEP $2]=$4; po[$1 SUBSEP $2]=$5; seen[$1 SUBSEP $2]=1; next }
    { sa[$1 SUBSEP $2]=$3; sp[$1 SUBSEP $2]=$4; so[$1 SUBSEP $2]=$5; seen[$1 SUBSEP $2]=1 }
    END {
        printf "%-26s %-5s | %-9s %-9s %-9s | %-9s %-9s %-9s\n", "MODEL", "TASK", "pi algo", "pi pkg", "pi other", "sctl algo", "sctl pkg", "sctl other"
        for (i=0;i<110;i++) printf "-"; printf "\n"
        n=0; for (k in seen) keys[n++]=k
        for (i=0;i<n;i++) for (j=i+1;j<n;j++) if (keys[j]<keys[i]) { t=keys[i]; keys[i]=keys[j]; keys[j]=t }
        for (i=0;i<n;i++) {
            k=keys[i]; split(k, a, SUBSEP); m=a[1]; t=a[2]
            # "other" holds every component with no algo/pkg split: the server
            # check in task 2, and all of task 3. Folding it into algo hid a
            # PASSING rate-limited server behind an algo count of 0/1.
            pav = (pa[k]=="0/0" || pa[k]=="") ? "-" : pa[k]
            ppv = (pp[k]=="0/0" || pp[k]=="") ? "-" : pp[k]
            pov = (po[k]=="0/0" || po[k]=="") ? "-" : po[k]
            sav = (sa[k]=="0/0" || sa[k]=="") ? "-" : sa[k]
            spv = (sp[k]=="0/0" || sp[k]=="") ? "-" : sp[k]
            sov = (so[k]=="0/0" || so[k]=="") ? "-" : so[k]
            printf "%-26s %-5s | %-9s %-9s %-9s | %-9s %-9s %-9s\n", m, t, pav, ppv, pov, sav, spv, sov
        }
    }' "$PI_T" "$SC_T"

echo
echo "other = components with no algo/pkg split: the task 2 server check, and all of task 3."
echo "algo = the exported function with the model's own self-test stripped: can it write the code?"
echo "pkg  = the file exactly as shipped: does it load and run?"
echo "A model with algo:PASS pkg:FAIL wrote working logic and broke it with its own scaffolding."
echo
echo "n differs per cell where the deadline guard skipped a repeat — check SKIPPED-DEADLINE.txt"
echo "in each run dir before reading any difference as a harness effect."
