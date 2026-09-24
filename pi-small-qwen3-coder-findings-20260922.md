# Qwen3-Coder-30B-A3B inside pi-small: speed, output quality, and the context floor (2026-09-22)

Follow-up to [`large-model-hybrid-inference-findings-20260922.md`](large-model-hybrid-inference-findings-20260922.md),
which measured five beyond-VRAM models with `llama-bench` and left Qwen3-Coder-30B-A3B
as one of two joint winners at **pp512 ≈ 71-78 t/s / tg128 ≈ 10-13 t/s**. The open
question was what that becomes inside the `pi-small` agent harness rather than a
synthetic benchmark.

Short answer: **the llama-bench numbers do not transfer.** Generation runs at
roughly half the benchmarked rate and prompt processing at a small fraction of
it, and the shortfall grows the *smaller* each agent turn is. The model does
complete the task, but its self-verification misses a defect in its own output.

Everything below ran on `benchlaptop` through `pi-small-docker.sh` — the normal
containerised path, model served on the Windows host, agent in the Linux
sandbox.

## What was added

`Qwen3-Coder-30B-A3B-Q4_K_M` is now on the pi-small roster:

```json
{
  "alias": "Qwen3-Coder-30B-A3B-Q4_K_M",
  "repo": "local",
  "file": "D:/models/qwen3-coder-30b-a3b/Qwen3-Coder-30B-A3B-Instruct-Q4_K_M.gguf",
  "serverArgs": ["--n-cpu-moe", "34", "-t", "8"]
}
```

No `ctx` or `ctxCandidates` override — the roster defaults (ctx 16384, ladder
`[16384, 12288, 8192]`) are measured-correct for it; see *Context headroom*
below.

`repo: "local"` rather than an `-hf` repo id, deliberately: the weights are an
18.56 GB manual download that lives outside `LLAMA_CACHE`, so a wrong path has
to fail loudly instead of quietly starting the download again. `check-roster.mjs`
reports such a model as `MISSING` rather than `DOWNLOAD` — it previously printed
`-hf local`, naming a repo that does not exist.

## The context floor: pi cannot use a 4096-token window

This is the most reusable finding, and it is not about this model at all.

The first instinct was to serve at **ctx 4096**, because that is the size the
`--n-cpu-moe 34` config was validated at in llama-bench, and because VRAM is
already maxed. Doing so produces a session that writes nothing at all. pi's
`clampMaxTokensToContext`:

```js
CONTEXT_SAFETY_TOKENS = 4096, MIN_MAX_TOKENS = 1
available = model.contextWindow - estimateContextTokens(context) - 4096
return Math.min(maxTokens, Math.max(1, available))
```

The margin is a **constant**. At `contextWindow` 4096 the subtraction is
negative before the prompt is counted, `max_tokens` clamps to **1**, and every
request returns a single token with `finish_reason: "length"`. Nothing raises;
the agent just emits one character and stops. Reproduced twice, and isolated by
pointing `curl` at the same server — which answered normally, so llama-server
was never at fault.

The trap is specifically that **4096 is the number the benchmark hands you**.

Fixed in code rather than written down as a caveat:

- `defaults.ctxCandidates` is now `[16384, 12288, 8192]`. The 4096 rung traded a
  server that refuses to start for a session that silently does nothing.
- `ctxUsabilityWarning()` (`lib/roster.ts`) is emitted by both the plugin and
  `serve.mjs` at every start, including the remote-mode attach where the context
  comes from whatever the host already had running.
- Adopting a live server now compares the **context**, not just the alias. A
  leftover at a smaller window is the wrong server: `serve.mjs` restarts it when
  it owns it, and refuses with an explanation when it does not.

Apertus keeps `ctx: 4096` — its *training* context is 4096 and it cannot go
higher — and now starts with the warning attached. That is the honest position:
it is not usable through pi for real work.

At ctx 8192 the model loads with VRAM at **6037 MiB of 6144**, and runs.

## Throughput: measured, and well short of llama-bench

Aggregated from `llama-server`'s own `print_timing` lines across **two complete
agent sessions** on the same task (ctx 8192, `--n-cpu-moe 34 -t 8`):

| | llama-bench (ctx 4096) | pi-small run 1 | pi-small run 2 | ratio |
|---|---:|---:|---:|---:|
| prompt processing | 71-78 t/s (pp512) | **2.87 t/s** (1224 tok / 426 s) | **3.08 t/s** (1490 tok / 484 s) | ~25x slower |
| generation | 10-13 t/s (tg128) | **5.78 t/s** (868 tok / 150 s) | **6.52 t/s** (977 tok / 150 s) | ~2x slower |

The two runs agree closely — well inside the ~20% run-to-run variance the
llama-bench round already documented for this model — so these are stable
figures, not one bad session.

Prompt processing, not generation, is where the time goes: **426 s of 576 s** in
run 1 and **484 s of 633 s** in run 2 of server-side compute.

Per request, the prompt-processing rate tracks how many tokens that turn had to
ingest:

| new prompt tokens | ms/token | t/s |
|---:|---:|---:|
| 455 | 96 | 10.41 |
| 310 | 277 | 3.61 |
| 296 | 532 | 1.88 |
| 55 | 534 | 1.87 |
| 42 | 599 | 1.67 |
| 36 | 605 | 1.65 |
| 17 | 273 | 3.66 |

**Small turns are dramatically slower per token than large ones** — the
signature of a fixed per-batch cost rather than per-token compute. The most
likely mechanism (inferred, not directly instrumented) is the MoE offload
itself: with `--n-cpu-moe 34` most expert weights sit in system RAM, and a batch
touching many different experts has to stream a large share of them regardless
of whether that batch holds 512 tokens or 36. `llama-bench`'s `pp512` amortises
that cost over a full 512-token batch; an agent turn adding a few dozen tokens
to a cached prefix pays almost the same cost for a fraction of the work. The
455-token turn — the closest thing to a full batch in the session — is also the
fastest at 10.41 t/s, and still 7x below `pp512`.

This was **not** caused by running at 8192 instead of 4096. A direct `curl`
against the ctx-4096 server measured 2.95 t/s prompt / 3.65 t/s generation, in
the same range. Nor was it Docker: the Linux VM held only 0.87 GB.

### Wall clock

Taken from `llama-server`'s own elapsed-time stamps (server ready at 2m03,
last slot activity at 11m42 in run 1):

- Model load: **~2 minutes** (18.56 GB).
- Agent session: **~9.5 minutes** for the task below.
- **11m54s and 12m27s** end to end.

**The session dominates, not the load** — which is the opposite of the usual
shape for a model this size, and follows directly from the prompt-processing
cost above. Loading 18.56 GB is the cheap part.

## Context headroom: available, free, and not the problem

Follow-up question: the card is at 6037 MiB of 6144 at ctx 8192, so can the
context go up at all — and would more "head space" improve the output?

**Yes to the first, no to the second**, and the two answers come from different
evidence.

### The card being full is not a context ceiling

`nvidia-smi` reads 6037 MiB at ctx 8192, 16384 *and* 32768 — the same number
every time. CUDA reports `VMM: yes`, so llama.cpp oversubscribes into system
RAM instead of failing, and that reading is the allocation ceiling rather than
real demand. Swept with f16 KV, `--n-cpu-moe 34 -t 8`, on a 2659-token prompt
plus a 34-token incremental turn:

| ctx | KV | big-prompt pp t/s | generation t/s | incremental-turn t/s |
|---:|---|---:|---:|---:|
| 8192 | f16 | 9.64 | 2.22 | 4.89 |
| 16384 | f16 | 8.82 | **2.45** | **4.89** |
| 32768 | f16 | 8.75 | **2.58** | 4.66 |
| 65536 | f16 | 6.16 | 1.14 | 3.11 |
| 16384 | q8_0 | 8.77 | 1.80 | 3.00 |
| 32768 | q8_0 | 8.77 | 1.81 | 2.64 |

**Context up to 32768 is free** — 4x the window at identical throughput. That
follows from the bottleneck identified above: this model is limited by
streaming expert weights per batch, not by KV cache, so growing the KV changes
nothing until 65536, where it finally costs about half the generation speed.

Two things fell out of the sweep that are worth keeping:

- **Do not quantize the KV cache here.** `-ctk/-ctv q8_0` saves nothing (it
  spills to system RAM either way) and costs real throughput at every size —
  1.80 t/s against f16's 2.45 at ctx 16384.
- **`-fa` is already on.** Its default is `auto`, which resolves to on;
  passing `-fa on` explicitly changed neither VRAM nor speed.

The roster entry therefore carries **no `ctx` or `ctxCandidates` override at
all** any more. The defaults — ctx 16384, ladder `[16384, 12288, 8192]` — are
measured-correct for this model, and every rung clears pi's 4096 floor. Pass
`--ctx 32768` for a genuinely long task; it is measured-safe.

Confirmed end to end: a third full agent session at **ctx 16384** ran at
**3.13 t/s prompt / 6.23 t/s generation** — indistinguishable from the 8192
runs — in 10m33s.

### But headroom was never the binding constraint

Peak prompt context actually reached, measured from pi's own session records:

| run | ctx served | peak context used |
|---|---:|---:|
| run 1 | 8192 | 1561 |
| run 3 | 16384 | **1138 of 16384 (7%)** |

The task never came close to filling even the smaller window, and the longest
single response was 372 tokens against a cap of roughly 2500. Nothing was
truncated and compaction never ran.

Accordingly, **doubling the context did not change the output**: run 3 produced
the *same* swapped-variable bug as runs 1 and 2, character for character, and
again reported it verified. Three sessions, two context sizes, one identical
defect.

So more head space is worth having for longer tasks — bigger files, more tool
output, more turns before compaction — and it is genuinely free up to 32768.
It is not a fix for this failure, which is a reasoning-and-checking failure at
1.1k tokens of context, not a capacity one.

## Sampling: three of four values were llama.cpp's, not Qwen's

The roster served this model at `temp 0.7 / top_p 0.95 / top_k 40`, with
`repeat_penalty` and `min_p` never passed at all. Qwen's own
`generation_config.json` asks for something else:

| parameter | Qwen specifies | originally sent | where ours came from |
|---|---:|---:|---|
| temperature | 0.7 | 0.7 ✓ | roster |
| top_p | 0.8 | 0.95 ✗ | llama.cpp default |
| top_k | 20 | 40 ✗ | llama.cpp default |
| repetition_penalty | 1.05 | 1.0 ✗ | never passed |
| min_p | 0 (Qwen3 family) | 0.05 ✗ | never passed |

Only temperature matched. The trap is that the roster's `top_p 0.95` and
`top_k 40` are *exactly* llama.cpp's built-in defaults, so a config that had
never been chosen looked deliberate, and the two unset parameters were invisible
— nothing in `/sm-status` printed them.

Fixed: `repeatPenalty` and `minP` are now first-class roster fields, passed on
the command line **and** injected per request (in remote mode the container
never starts the server, so request-level params are the only ones the plugin
controls — omitting them there reinstated llama.cpp's defaults). Every model on
the roster now states its full sampler explicitly, taken from its vendor's
`generation_config.json`; where a vendor omits a field, transformers'
`GenerationConfig` default is recorded, since that is what the vendor's own
reference implementation runs. A test asserts the values on the actual argv,
because several of them coincide with engine defaults and "it looks right" is
not evidence.

Wiring this up immediately caught a second instance of the same class of bug:
`serve.mjs` built its sampler object without the two new fields, so they reached
the command line as `String(undefined)` and llama.cpp fell back to its defaults
anyway. Caught by the argv assertion, not by inspection.

The audit found every other roster model off-spec too — most sharply LFM2.5,
whose card asks for **temperature 0.1** against the 0.7 it was getting. See the
roster and README for the full table. Note this is deliberately the *opposite*
of `coding-bench/models.conf`, which serves every model identically for
cross-model comparability; pi-small is a scaffold for using these models, not a
measurement instrument, so here the model card wins.

**It did not change the outcome.** A fourth session at the corrected sampler
(verified live via `/props`: 0.7 / 0.8 / 20 / 1.05 / 0.0) ran at 3.52 t/s
prompt / 6.00 t/s generation, peak context 1032, in 9m24s — and produced the
same swapped-variable bug for the fourth time.

## Output quality: task completed, self-verification failed

The task: write a standalone `wordfreq.py` taking one file argument and printing
the 10 most frequent words as `"<count> <word>"`, most frequent first,
case-insensitive, punctuation stripped, stdlib only — then create a test file
and run it.

It produced a clean, correct-shaped script: `argparse`-free `sys.argv` handling
with a usage message, `FileNotFoundError` and generic exception handling,
`str.maketrans` punctuation stripping, `collections.Counter`, stdlib only. It
created a test file and ran it.

It also shipped a real defect:

```python
for count, word in word_counts.most_common(10):
    print(f"{count} {word}")
```

`Counter.most_common()` yields `(word, count)`. The loop variables are swapped,
so `count` holds the word and `word` holds the count, and the output is
`<word> <count>` — the reverse of what was asked:

```
file 5
this 4
word 4
```

Everything else about the script is right.

**All four runs produced this same bug, character for character** — the
identical swapped-variable loop, across three different configurations:

| run | ctx | sampler | result |
|---|---:|---|---|
| 1 | 8192 | roster (off-spec) | same bug |
| 2 | 8192 | roster (off-spec) | same bug |
| 3 | 16384 | roster (off-spec) | same bug |
| 4 | 16384 | **Qwen's own** | same bug |

Doubling the context did not change it. Correcting the sampler to the vendor's
own values did not change it. It is a reproducible property of this model on
this task — not a sampling accident, not a context limit, and not a
misconfiguration.

The verification step is what matters here. In run 1 the model ran the script,
saw `file 5`, and reported it "works correctly, producing the expected output",
then listed `"file 5" (appears 5 times)` in its own summary. Run 2 went further
and restated the requirement as satisfied:

> Prints the 10 most frequent words in the format "<count> <word>", most
> frequent first
> […] Verified the script works correctly by running it on the test file, which
> produced the expected output

— immediately after its own test printed `this 4`. It had the contradicting
evidence on screen, quoted the spec correctly, and still did not compare the
two. That is the same thin-verification failure the 3-4B roster models show, at
10x the parameter count.

## Bottom line

- **It runs, and it is usable** — ctx 8192, `--n-cpu-moe 34 -t 8`, ~12 min from
  cold for a small task.
- **Do not plan against the llama-bench figures.** In an agent loop expect
  ~6 t/s generation and ~3 t/s prompt processing, not 10-13 and 71-78. The
  gap is structural: agent turns are small batches, and small batches lose the
  amortisation that `pp512` is built to capture.
- **Prompt processing is the bottleneck**, at roughly 3x the cost of generation
  over a whole session. Anything that grows the per-turn prompt — more tools,
  bigger system prompts, larger tool outputs — is more expensive here than the
  generation-speed numbers suggest.
- **Its code is good and its checking is not.** All four runs shipped the same
  defect and declared it verified — across two context sizes and two samplers.
  Budget for review of what it produces; its own "I tested it and it works" is
  not evidence.
- **State samplers explicitly.** Three of this model's four recommended values
  silently disagreed with its card because the roster's numbers happened to
  equal llama.cpp's defaults. Assert them against the wire, not the config.

## Open questions

- Does `-b`/`-ub` batch tuning help the small-batch case, or is the expert
  streaming cost irreducible per batch?
- Would a lower `--n-cpu-moe` (more experts on GPU) trade its pp512 optimum for
  better small-batch behaviour? The sweep that chose 34 measured only `pp512`,
  which this session suggests is the wrong target for agent use.
- Qwen3.6-35B-A3B has not been run through pi-small at all; its llama-bench
  numbers are close enough that it likely behaves the same way, but that is an
  assumption.
