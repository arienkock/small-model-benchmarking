# Coding Benchmark — small local models as coding agents (agent runs via pi)

Non-interactive coding-agent benchmark. Each model runs web-app exercises
through pi (print/JSON mode) against a local `llama-server`, in an isolated
Docker workspace per run.

Two rounds:

| Round | Script | Roster | Tasks | Budget |
|---|---|---|---|---|
| **Filter** | `run-filter-bench.sh` | `models.conf` (7 models) | 3 (`prompts-filter.txt`) | ~2-3 h, 5.25 h worst case |
| **Full** | `run-coding-bench.sh` | 2 hardcoded incumbents | 12 (`prompts.txt`) | ~8-10 h |

Run the **filter round** first to eliminate models that obviously cannot do
agentic coding, then spend the full suite only on the survivors.

## Files

| File | Purpose |
|---|---|
| `models.conf` | **the roster** — alias, HF repo id, GGUF glob. Add a model here, not in code |
| `prompts.txt` | 12 coding exercises (Python + TypeScript web apps), `===PROMPT===` separated |
| `prompts-filter.txt` | the 3 most discriminating of those 12 (full-suite tasks 5, 7, 12) |
| `provider-extension.ts` | pi extension registering the `bench-local` provider (one model per run, from `$BENCH_MODEL`) |
| `bench-guard.ts` | in-container guard: path discipline, denylist, timeout clamping |
| `run-filter-bench.sh` | filter round: roster preflight, per-model context probe, run loop, triage report |
| `run-coding-bench.sh` | full 12-task round (two incumbents) |
| `bench-findings.md` | analysis of the 2026-09-11 12:xx runs |
| `bench-findings-143308.md` | analysis of the 2026-09-11 14:33 run (the tournament that chose the 3 filter tasks) |

## Filter round

```bash
cd coding-bench
./run-filter-bench.sh --check-models   # verify the roster resolves; runs nothing
./run-filter-bench.sh                  # results in ./bench-filter-<timestamp>/
```

`--check-models` resolves every entry in `models.conf` (cache hit, or
`hf download`) and prints a PASS/FAIL table without starting the benchmark. The
full run refuses to start unless all models resolve, so a wrong repo id costs
two minutes rather than a night.

All repo ids and GGUF filenames in `models.conf` were verified against the
Hugging Face API on 2026-09-12. Two of the new models have no official GGUF
(Spark-X2.5-4B has no official Q6_K; Nanbeige publish none at all), so those
entries point at third-party builds — see the notes in `models.conf`. Four of
the five are recent architectures; if your llama.cpp build predates support for
one, it is recorded in `SKIPPED.txt` and the run continues.

### Why these 3 tasks

Chosen by score spread in run `20260911-143308` (see `bench-findings-143308.md`):

| Task | What it isolates | Spread | Why it earns a slot |
|---|---|---|---|
| 5 — debounce bugfix | TS reasoning + self-test | 1.0 vs 8.0 | No HTTP at all, so it is immune to environment problems — the cleanest signal in the suite |
| 7 — rate limiter | Python server + TS module, stateful logic | 3.0 vs 9.5 | The "can it actually build and verify something" task |
| 12 — average speed | Simplest full build + prompt injection | 1.5 vs 7.5 | Fastest task; also the only injection-resistance check |

Together: TS debug | complex build | simple build | injection resistance.

### Outputs

- `SUMMARY.txt` — per-model context actually used, then one line per run
- `FILTER-REPORT.txt` — triage table (exit, duration, tool calls, node/curl
  invocations, test-pass strings, guard blocks) sorted by model
- `SKIPPED.txt` — models that could not load at any context size
- `models.conf` — a copy of the exact roster used
- `NN-<alias>/` — per-run workspace: `prompt.txt`, deliverables, `meta.txt`,
  `transcript.jsonl`

`FILTER-REPORT.txt` signals are for triage, not grading — grade from the
transcripts.

## Harness fixes (2026-09-12)

Applied after the `143308` post-mortem. All are model-agnostic.

1. **URL mangling fixed** — the guard's Windows-path regex `[A-Za-z]:[\/]`
   matched the `p://` inside `http://`, rewriting every URL-bearing command:
   `curl -s http://localhost:8000/api/todos` became `curl -s htt.`. This
   produced the `Could not resolve host: htt.` seen throughout run 143308 and
   is why almost no HTTP verification succeeded, **for both models**. URLs are
   now masked out before any path rewriting and restored after, and the
   drive-letter rule requires a real single-letter drive.
2. **Per-model context** — each model runs at the highest context it can load
   rather than the minimum across the whole roster (one VRAM-hungry 4B would
   otherwise pin all seven models to 8192). Recorded per model in the outputs.
   Compaction settings scale with the window (reserve 3/8, keep-recent 1/4),
   which reproduces the old hand-tuned 6144/4096 at 16384.
3. **Per-task cap 1800s → 900s** — every timeout in run 143308 was a degenerate
   loop or a foreground-server hang, never a nearly-finished task.
4. **Bash timeouts clamped to [30s, 120s]** — a foreground server never returns
   and used to consume the entire per-task budget. Now it costs 2 minutes and
   the model gets a timeout it can react to.
5. **`prompt.txt` is read-only** — LFM2.5 overwrote the task description in two
   separate tasks, destroying the grading baseline.
6. **Package installs blocked** — `npm/pnpm/yarn install`, `npx`, `pip install`
   are refused with an explanation. MiniCPM5 ran `npm install typescript` and
   npx `ts-node`/`tsx`/`esbuild`, breaking the stated rule and hiding its real
   TypeScript ability behind a toolchain.
7. **Levelled system prompt** — Node 24 type-stripping rules (explicit `.ts` on
   local imports, ESM only, no enums/namespaces, `node:assert` instead of jest
   globals), the background-server + log-reading pattern, and
   `allow_reuse_address`. Both incumbents lost points on nearly every TS
   deliverable to the same three ESM errors — a knowledge gap that masks the
   coding ability being measured. Identical text for every model.
8. **`grep -c ... || echo 0` fixed** — `grep -c` prints `0` *and* exits 1 on no
   match, so that idiom wrote the two-line value `0\n0` into `meta.txt`. Also
   present in `run-coding-bench.sh`.

## Design decisions

### Context size: 16384 tokens (probe-verified)

Derived from measured constraints, not guessed:

- **GPU budget**: GTX 970M 6GB. Q8_0 weights ≈ 2.9 GB (LFM2.5) / 2.8 GB (MiniCPM5).
- **KV cache** (from GGUF metadata):
  - LFM2.5: 30 blocks but only **10 attention layers** × 8 KV heads × 64 head dim
    → ≈ 20 KB/token → 16k ≈ 0.33 GB
  - MiniCPM5: **42 layers** × 2 KV heads × 128-dim KV → ≈ 43 KB/token → 16k ≈ 0.7 GB
  - 32k would push MiniCPM to ~4.6 GB total — risky on a 6 GB card with WDDM overhead.
- **Both models natively support 131072**, so 16k is a fair subset for both.
- **Agentic fit**: pi's system prompt + tool definitions ≈ 4–6k tokens; 16k leaves
  ~10k of headroom for multi-turn tool traffic before compaction engages.

The script probes candidates `16384 → 12288 → 8192` per model at startup and uses
the **highest context both models actually load with**, so a VRAM quirk on one
model can't silently shrink only that model's context.

### Equal reasoning budget

`llama-server --reasoning-budget 4096` is the single enforcement point (a
server-side default applied to every request). pi's provider config sends no
per-request thinking controls, so it cannot skew one model vs the other. Both
models think via their native chat templates (`--jinja`) under the same cap.

### Compaction (tuned per workspace)

pi auto-compacts when `contextTokens > contextWindow - reserveTokens` (checked
after each tool batch) and recovers from hard context-overflow errors by
compacting and retrying once (llama.cpp's overflow message is a recognized
pattern). Defaults (`reserveTokens: 16384`, `keepRecentTokens: 20000`) are
tuned for 100k+ frontier contexts and are degenerate at 16k (trigger threshold
would be ≤ 0, keep-recent exceeds the whole window).

Each workspace therefore gets a project-local `.pi/settings.json`:

```json
{
  "compaction": {
    "enabled": true,
    "reserveTokens": 6144,
    "keepRecentTokens": 4096
  }
}
```

- compact when context exceeds **10240** (leaves room for one thinking-budget-sized response)
- keep the last **4096** tokens verbatim; summarize everything older
- loaded via `-a` (project trust for one run); the global `~/.pi/agent/settings.json` is never modified

Expect multiple compactions per task — that is the realistic operating condition
for a 2.6B model on agentic coding, and it is part of what is being measured.

### Runs

- Non-interactive: `pi --mode json` → full event stream (tool calls, results,
  responses) captured as JSONL per run for grading. `meta.txt` per run also
  records total input/output tokens and tool-call counts.
- Provider URL: the script exports `LLAMA_BASE_URL` (with `/v1`); the extension
  normalizes it (idempotent `/v1` handling) because pi-ai uses `baseUrl`
  directly as the OpenAI SDK `baseURL`. The extension also reads `BENCH_CTX`
  so its declared `contextWindow` always matches the server's actual `-c`.
- Isolation: fresh empty workspace per (model, prompt); no sessions saved;
  prompt passed as `@prompt.txt` to dodge `.cmd` quoting issues.
- pi runs inside a plain `cmd.exe` (`$OUT/run-pi.cmd`, generated by the script)
  so the agent process sees a pure Windows environment (MSYS vars cleared,
  `HOME=%USERPROFILE%`), even though the harness itself is bash. stdin is
  `</dev/null`: in non-interactive modes pi reads stdin until EOF, and under
  mintty stdin never EOFs, so pi would block forever before its first output.
  GNU timeout can only kill `cmd.exe`, so after each run any orphaned bench
  pi node is killed by command line match.
- Shared rules via `--append-system-prompt`: stdlib-only Python, `node file.ts`
  for TypeScript (Node 24 runs .ts natively), verify before finishing, stop when done.
- `meta.txt` per run: exit code, duration, created files. `SUMMARY.txt` aggregates.
- Per-run wall clock limit: 30 min (timeout; transcript kept even if partial).

## Grading hook

Every prompt is self-verifying: each task instructs the agent to run its own
code (`curl` the endpoints, `node file.ts` the TS tests) before finishing.
Grading can therefore combine: file presence, transcript-observed verification
(server started, expected HTTP responses), and manual inspection of the JSONL.

## Usage

```bash
cd coding-bench
./run-coding-bench.sh
# results in ./bench-coding-<timestamp>/
```