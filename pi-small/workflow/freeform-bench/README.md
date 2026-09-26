# Free-form speed bench (Qwen3.6, books-api; Spark-X2.5-4B)

The scripts behind the 2026-09-25/26 overnight speed work on the free-form Qwen3.6 run
(see `../../../pi-small-qwen-freeform-speed-20260926.md`). They run on the bench laptop from
`/d/llama.cpp/pi-small`, as scheduled tasks (never `nohup`).

| script | what it does |
|---|---|
| `ff-batch3.sh <prefix> <count> <cap-min>` | Loads the model (`MODEL=<alias>`, default Qwen3.6) once (one proxy for the batch), then runs N graded free-form sessions back to back. Before each run it waits for a one-token completion; if that fails, it restarts the proxy (the server was killed by a commit-limit exhaustion twice). `PI_SMALL_STYLE`, `THINKING=on/off` pass through. |
| `ff-summary.py <run-dir>...` | One line per run: end, minutes, turns, tool calls, compactions, output tokens, grade. |
| `ff-calls.py <run-dir>...` | Each tool call: time, output tokens, thinking chars, call size, start of the command. Shows full-file rewrites at a glance. |
| `ff-timeline.py <run-dir>` | Where a run's time went: model responses, tools, compactions. |
| `sweep.sh "<label>|<args>"...` + `sweep-bench.py` | llama-server config comparison at 32k: cold ~1.2k-token prompt and 256 generated tokens, three times. |
| `spec-bench.py` | Generation speed on a rewrite (repetitive) and a new file (novel), for speculative decoding. |
| `after-task.sh <task> <launcher>` | Wait for a scheduled task to finish, then run the next launcher (queues batches). |
| `spec-sweep.sh` | Like `sweep.sh`, but runs `spec-bench.py` per config (speculative-decoding types). |
| `speed.py [port]` + `load32k.sh` | Prompt and generation t/s for two ~1k-token completions; `load32k.sh` loads Qwen3.6 via `serve.mjs` and reports free RAM and GPU memory around it. |
| `spark-sweep.sh "<label>|<args>"...` + `spark-bench.py` | Spark-X2.5-4B config comparison at 16k: cold ~1.2k- and ~6k-token prompts, 256 generated tokens, two each. `M=<gguf>` benches another quant. See `../../../pi-small-spark-speed-20260926.md`. |
| `gpu-probe.sh` | Loads Spark, generates, and samples GPU clocks, power, utilization and throttle reasons meanwhile. |
| `style-v2/v3/v4.txt` | The `PI_SMALL_STYLE` texts tried. v2 became `SESSION_STYLE` in `lib/workflow.ts`. |

`launchers/` holds the exact launcher each batch or sweep ran from (the scheduled task's command),
and `results/` their output: `ff-batch-<prefix>.txt` is the `ff-summary.py` table per batch,
`.out` the batch log; `sweep.out` and `spec-sweep.out` the two server sweeps. The run dirs
themselves, pi session transcripts included, are in `pi-small/workflow-runs/<prefix>-<n>/`.
