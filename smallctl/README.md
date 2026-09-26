# SmallCTL in a container

[SmallCTL](https://github.com/lowspeclabs/SmallCTL) is an agent harness aimed at
4B-9B models: staged phases, evidence tracking, context compression and loop
guards around an OpenAI-compatible endpoint. It needs no GPU and no weights of
its own — it is purely a client of `llama-server`, so the container is small
(370 MB) and the model stays where it already is.

## Where this runs

**On the benchmark laptop, not on the Mac.** Two reasons, both found the hard
way:

- Docker Hub pulls stall indefinitely on the Mac (`docker pull python:3.12-slim`
  produced no output in 20 minutes; the same pull on the laptop finished in
  under a minute). The base image simply cannot be fetched here.
- The GPU, the weights and the existing `host.docker.internal` route to
  `llama-server` are all on the laptop anyway, which is what the pi agent
  already relies on.

## Layout

    Dockerfile        pinned build (SmallCTL @ 1ce1cb5)
    run.sh            docker run wrapper; passes its args to smallctl
    start-server.sh   llama-server launcher, same conventions as
                      run-filter-bench.sh (port 8123, api key sk-bench)

On the laptop they run from the repo checkout, `/d/llama.cpp/smallctl/`
(until 2026-09-26 from a separate deployed copy, `smallctl-container/`). The
scratch workspace `ws/` and `*.log` there are gitignored.

## The model cache

`start-server.sh` sources `../llama-cache.env`, which sets `LLAMA_CACHE` to the
cache on `D:`. Do not start `llama-server` for this experiment without it — with
`LLAMA_CACHE` unset, llama.cpp uses `~/.cache/huggingface/hub` on `C:` instead
and re-downloads the model. See the repo `AGENTS.md`.

## Running it

Long steps must outlive the SSH session, so build and multi-turn runs go through
`schtasks`, exactly like a bench run (see the repo CLAUDE.md). Note `/tr` is
capped at 261 characters — put the command in a script and schedule the script,
not the command.

Start the server:

    ssh benchlaptop 'schtasks //create //tn SmallctlServer //sc once //st 00:00 //f //tr "\"C:\Program Files\Git\bin\bash.exe\" -lc \"cd /d/llama.cpp/smallctl && ./start-server.sh > server.log 2>&1\""
    schtasks //run //tn SmallctlServer'

Then run a task:

    ssh benchlaptop 'cd /d/llama.cpp/smallctl && WORKSPACE=D:/llama.cpp/smallctl/ws ./run.sh --preset coding-local --task "..."'

`WORKSPACE` is mounted at `/work` and is the only thing the agent can touch.
Point it at a scratch copy — smallctl writes files. It also drops its run logs
in `$WORKSPACE/logs/<run-id>/`, which is where the useful detail is:
`task_summary.json` gives the verdict, `tools.jsonl` every tool call.

Changes reach the laptop like any other code: commit, then `git push bench master`.

## Status: works

Verified end to end on 2026-09-16 against `Spark-X2.5-4B-Q6_K`:

- the container reaches `llama-server` on `host.docker.internal:8123`
- llama.cpp's `reasoning_content` is picked up as thinking tokens, so a
  reasoning model needs no `--reasoning-mode` override
- with all three settings below in place, the fix-the-median task ran clean:
  `final_task_status: completed`, `deliverable_verified: true`, 9 tool calls,
  0 guard trips, exit 0. The model's patch was correct and its own `pytest`
  verdict was confirmed independently (3 passed):

      def median(values):
          ordered = sorted(values)
          mid = len(ordered) // 2
          if len(ordered) % 2 == 0:
              return (ordered[mid - 1] + ordered[mid]) / 2
          return ordered[mid]

### Three settings it will not work without

Each of these produced a distinct, confusing failure before being fixed. They
are all now defaults in `start-server.sh` / `run.sh`:

1. **Context must be 16384, not 8192.** SmallCTL's system prompt alone is ~3370
   tokens. At 8192 the run died with `PROMPT BUDGET OVERFLOW: 3677 tokens
   assembled, which exceeds the max prompt limit of 3414`. Note 16384 is also
   what `run-filter-bench.sh` probes to for every model on the roster — its
   `CTX_CANDIDATES` ladder starts there. Do not carry SmallCTL's own 8192
   default over; it is not sized for this harness's prompt.
2. **`--reasoning-budget` must be below the completion reserve.** With the
   bench's 2048 budget against SmallCTL's default 1024-token completion
   reserve, every stream was cut off mid-thought and the run ended
   `reasoning_only_stream_stall` — the model never emitted content or a tool
   call, just 96 `log_note` calls. Now: 512 budget, 2048 reserve.
   Do *not* "fix" this with `--reasoning-budget 0`; that makes the model leak a
   raw `</think>` into visible text (`"PONG</think>PONG"`).
3. **pytest must be in the image.** Without it the model does exactly the right
   thing — runs pytest, sees it missing, tries `pip install pytest` — and that
   fails as non-root, so the run stalls with the fix applied but unverified.

## Cost, and why that matters here

The model is the bottleneck, not the harness. At 8192 ctx this model runs ~14
tok/s decode and ~250 tok/s prefill, and SmallCTL's prompts reach ~5.5k tokens
within a few turns, so each turn costs roughly 25 s of prefill before any
output. A 16-step run took about 20 minutes. Budget accordingly before pointing
it at anything large, and keep `--run-mode tool_plan` in mind for read-only
work — it bounds the number of model calls.

## Cleaning up

    ssh benchlaptop 'schtasks //delete //tn SmallctlServer //f; schtasks //delete //tn SmallctlBuild //f'
