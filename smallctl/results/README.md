# SmallCTL arm — results, 2026-09-17

Graded output of `run-smallctl-bench.sh` over `prompts-filter.txt`. The full run
dirs stay on the benchmark laptop (untracked, as all result dirs are); these are
the report files.

Run: `bench-smallctl-20260917-000958-merged` — rep 1 and rep 2 merged, then
graded once so `STABILITY.txt` sees both repeats.

## READ THIS BEFORE COMPARING TO THE PI ARM

These numbers are **not** directly comparable to `bench-filter-20260914-203559`.
Two settings differ, and both were forced rather than chosen:

| | pi arm | this arm | why |
|---|---|---|---|
| context | 16384 | 24576 | SmallCTL cannot assemble a first prompt at 16384 |
| reasoning budget | 4096 | 512 | at 4096 and 1024 the stream ends before any tool call |

Both are recoverable in one job: re-run pi at 24576/512 and the two arms match
on every axis. That job is the prerequisite for any claim about which harness is
better, and it has not been run.

What this arm *does* establish on its own is that SmallCTL drives Granite and
Spark to real, gradable deliverables on all three tasks.

## Coverage

    Granite-4.2-3B-Q8_0   n=2 on every task
    Spark-X2.5-4B-Q6_K    n=2 on every task
    Nanbeige4.2-3B-Q6_K   n=1, and every cell MISSING — see below

Nanbeige produced nothing, for a hardware reason rather than a harness one. At
24576 its server died mid-run:

    CUDA error: the launch timed out and was terminated

which is the Windows TDR watchdog resetting the driver. It was prefilling at
9.7-12 tok/s at the time. Measured over a 12k-token prompt:

    ctx     Granite      Spark        Nanbeige
    16384   148.8 tok/s  167.8 tok/s  17-23 tok/s
    24576   147.7        167.4        crashes (TDR)

Nanbeige is ~8x slower than the other two at the same context, so one SmallCTL
turn costs roughly 9 minutes, and 16384 is below the prompt size SmallCTL needs
anyway. It is squeezed from both sides on a 6 GiB card. Its three MISSING cells
are an infrastructure result; do not read them as a model or harness score.

## Files

    GRADES.txt      per-cell verdicts, produced by executing deliverables
    grades.tsv      the same, machine-readable — input to compare-harness.sh
    SPLIT.txt       per-model algo vs pkg totals
    STABILITY.txt   PASS count per component across repeats
    SUMMARY.txt     run configuration and per-cell timings
