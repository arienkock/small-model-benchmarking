# supervisor/ — replaying the corpus through a decision-model supervisor

The bake-off behind `../../../pi-small-supervisor-bakeoff-findings-20260923.md`: could a small
Jev-style decision model watch a 3B agent and inject "capsules" when a requirement is not met?
Nothing here runs an agent. It replays the 129 graded filter-round transcripts in
`coding-bench/bench-filter-*` (Apertus and VibeThinker excluded) and asks judges about them.

| file | does |
|---|---|
| `corpus.py` | the runs, their grader labels (run-level PASS = every graded component passes), their transcripts as turns |
| `render.py` | the text state a judge sees: TASK / ACTIONS / EVIDENCE, task-agnostic, ~14k chars of actions max |
| `questions.py` | the two question sources: the fixed generic bank (G1–G11) and the prompt the 3B model gets to write its own checks |
| `gen_checks.py`, `gen_all.sh` | have each model write checklists from the task prompt alone, on its roster sampler |
| `probes.py`, `run-probes-laptop.sh` | evidence: files read back, the last code command re-run, every generated command run — in `coding-bench-agent`, no network, fresh workspace per command, 10 s |
| `judges.py` | readout (P(Yes) vs P(No) on llama-server, both option orders) and `/v1/systemone` (Kev, Laya) clients |
| `step0.py` | judge latency on the laptop CPU while the GPU serves a 3B model |
| `replay.py` | step 1: finals (at yield, conditions T and TE) and invariants (every turn boundary); resumable, shardable |
| `invariants.py` | the boundary sample and its labels (mechanical G2/G4/G5; hand G1/G3 in `labels/`) |
| `coverage.py` | did the model's own checklist aim at the requirement its failing run missed; capsule attribution |
| `score.py` | AUROC / fire rates / baselines → `out/scores.json` |
| `judges/laya/` | Laya behind `/v1/systemone` (Node, ONNX Runtime) |

`labels/` is hand work, done before any judge ran: `invariants-hand.json` (G1/G3 on 40
boundaries) and `check-targets.json` (which graded requirement each generated check aims at).
`out/` holds generated data and is not meant to be committed wholesale.

## Traps these tools already handle

- **`llama-server -hf` re-downloads a cached model when upstream `main` moved.** It rewrites
  `refs/main` and starts a multi-GB fetch into `D:` (100% full). Start ad-hoc servers with `-m`
  and the snapshot path.
- **`serve.mjs` over ssh never returns** once it has spawned a server: Windows sshd holds the
  session while the detached child lives. `gen_all.sh` waits for the model to answer on the
  tunnel, then drops the ssh client.
- **Nanbeige's chat template breaks llama.cpp's `json_schema` grammar** ("Unexpected empty grammar
  stack after accepting piece: assistant"). `gen_checks.py --no-schema` adds one format line and
  repairs stray backslashes instead.
- **Qwen3.5 (hybrid) re-processes ~one micro-batch per question** even on a warm cache; `-ub 128`
  cuts the per-question cost ~3x on CPU.
- **Kev on the GTX 970M hits the Windows GPU watchdog** (TDR, ~2 s per kernel) on states over ~4k
  tokens, which kills the CUDA context. `replay.py --long-url` routes long states to a CPU instance.
- **Laya's Node process grows by GBs** over thousands of requests; `LAYA_MAX_REQUESTS` recycles it
  and `judges._post` retries through the restart.
- **Waiting on a process with `pgrep -f <pattern>`** matches the waiting shell's own command line.
  Wait on PIDs.
