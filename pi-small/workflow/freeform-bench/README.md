# Free-form speed bench (Qwen3.6, books-api)

The scripts behind the 2026-09-25/26 overnight speed work on the free-form Qwen3.6 run
(see `../../../pi-small-qwen-freeform-speed-20260926.md`). They run on the bench laptop from
`/d/llama.cpp/pi-small`, as scheduled tasks (never `nohup`).

| script | what it does |
|---|---|
| `ff-batch3.sh <prefix> <count> <cap-min>` | Loads Qwen3.6 once (one proxy for the batch), then runs N graded free-form sessions back to back. Before each run it waits for a one-token completion; if that fails, it restarts the proxy (the server was killed by a commit-limit exhaustion twice). `PI_SMALL_STYLE`, `THINKING=on/off` pass through. |
| `ff-summary.py <run-dir>...` | One line per run: end, minutes, turns, tool calls, compactions, output tokens, grade. |
| `ff-calls.py <run-dir>...` | Each tool call: time, output tokens, thinking chars, call size, start of the command. Shows full-file rewrites at a glance. |
| `ff-timeline.py <run-dir>` | Where a run's time went: model responses, tools, compactions. |
| `sweep.sh "<label>|<args>"...` + `sweep-bench.py` | llama-server config comparison at 32k: cold ~1.2k-token prompt and 256 generated tokens, three times. |
| `spec-bench.py` | Generation speed on a rewrite (repetitive) and a new file (novel), for speculative decoding. |
| `after-task.sh <task> <launcher>` | Wait for a scheduled task to finish, then run the next launcher (queues batches). |
| `style-v2/v3/v4.txt` | The `PI_SMALL_STYLE` texts tried. v2 became `SESSION_STYLE` in `lib/workflow.ts`. |
