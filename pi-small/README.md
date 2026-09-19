# pi-small

An agent scaffold for the local 3B/4B models, built as a **pi plugin** rather
than a fork. `pi` itself (`@earendil-works/pi-coding-agent`) stays a stock npm
install and can be updated whenever; everything specific to this experiment
lives in this directory and moves on its own schedule.

    bin/pi-small        the entry point: pi with nothing of its own
    extensions/small.ts the plugin: model, server, sampler, tools
    roster.json         the models, and their per-model server flags
    templates/          chat templates, for models whose GGUF ships a bad one
    test/               stub llama-server + a test that drives the plugin

## What the entry point does

`bin/pi-small` starts pi as a blank slate:

    --no-builtin-tools      no read/write/edit/grep/find/ls
    --no-extensions         nothing auto-discovered from ~/.pi or .pi
    --no-skills             no skills
    --no-context-files      no AGENTS.md / CLAUDE.md
    --no-prompt-templates --no-themes
    --system-prompt " "     see below
    -e <this directory>     load the pi-small plugin, and only it

So the model's entire surface — its one tool, its system prompt, its sampler
settings and its context window — comes from the plugin, deliberately.

**The system prompt is one space plus one line.** pi replaces its default
prompt only when the replacement is non-empty (an empty string falls through to
the full coding-agent prompt — that is a real trap), and it always appends
`Current working directory: <cwd>`. What the model actually receives is:

    " \nCurrent working directory: /path/to/cwd\n"

That is the emptiest prompt reachable without patching pi. Override it with
`PI_SMALL_SYSTEM_PROMPT` when you want to put something there.

**The one tool is pi's own `bash`**, re-registered by the plugin rather than
inherited. Adding a tool is a line in `extensions/small.ts`; nothing arrives by
default.

## What the plugin owns

Normally pi decides which endpoint to talk to and what to send it. Here the
plugin does:

- **The server.** `llama-server` is started, health-checked, probed and killed
  by the pi process. It is not assumed to be running.
- **The model.** One of `roster.json`, served one at a time.
- **The context size.** Changing it restarts the server, and the provider is
  re-registered with the context the server *reports*, not the one requested —
  llama-server silently caps `-c` at the model's training context, and a window
  we only think we have makes compaction and `max_tokens` wrong.
- **The temperature.** Injected per request (`before_provider_request`), so it
  changes with no restart.

### Commands

    /sm-status    model, server, context, sampler, template, probe results
    /sm-model X   switch model (restarts the server)
    /sm-ctx N     set context size (restarts the server)
    /sm-temp T    set temperature (no restart)
    /sm-probe     re-run the template probes against the live server
    /sm-restart   restart with the current settings

### It will not kill a server it did not start

The GPU on the bench laptop is shared with 8-hour runs. If something is already
listening on the port:

- serving the model we want → adopt it, and leave it running on exit
- serving anything else → refuse, with an explanation, and touch nothing

## Per-model tool-call templates

Every model packages its tool-call channel differently, and some GGUFs package
it wrongly — which looks exactly like a stupid model once you are three turns
into a session. Three layers handle it:

1. **`--jinja` is always on**, so llama-server uses the template embedded in the
   GGUF. That is the right answer for every model on the roster except Apertus.
2. **Per-model overrides in `roster.json`** when it is not:
   - `chatTemplate` — a filename under `templates/` (or an absolute path),
     passed as `--chat-template-file`
   - `serverArgs` — raw llama-server flags for that model only, e.g.
     `["--reasoning-format", "deepseek"]` or
     `["--override-kv", "tokenizer.ggml.eos_token_id=int:107"]`
3. **Two probes at every server start**, the ones the benchmark learned to run
   before spending an hour on a model:
   - `turn_boundary` — does generation stop, and are control tokens kept out of
     visible text? (Apertus failed this and role-played both sides of the
     conversation.)
   - `tool_calls` — does a tool call come back in the OpenAI `tool_calls`
     field, using a tool shaped like the `bash` tool this scaffold serves?
     (VibeThinker failed this and invented `<script type="text/json">`.)

   Failures are reported at startup with a diagnosis, and `tool_calls` failures
   distinguish "tried in an unparseable format" — a template problem, fixable
   with the flags above — from "returned prose and never tried", which is
   usually the model.

## Roster

`roster.json` uses the same fields as `coding-bench/models.conf`: `repo` is a
Hugging Face repo id that llama-server downloads itself with `-hf`/`-hff`, or
the literal `local`, in which case `file` is a path on the serving machine.
`defaults` sets the port, API key, context, sampler and reasoning budget; any
model may override them.

`localFile` is the one addition: a copy already on the serving machine, used
with `-m` when it resolves, falling back to `repo`/`file` when it does not. It
may start with `~` and may contain `*` in a path segment, because the cache
hides the weights behind a snapshot hash. `/sm-status` prints which of the two
is in use.

### What is on the roster

Everything the benchmark has used, minus VibeThinker — which has no tool-calling
capability at all and so cannot drive an agent loop (see
`coding-bench/models.conf`). Spark is the default.

| model | note |
|---|---|
| `Spark-X2.5-4B-Q6_K` | default; best verification behaviour of the roster |
| `Granite-4.2-3B-Q8_0` | strong algorithms, thin on verification |
| `Nanbeige4.2-3B-Q6_K` | slowest of the three 3-4B models |
| `LFM2.5-2.6B-Q8_0` | smallest and fastest |
| `MiniCPM5-2B-Q8_0` | reaches for npm/npx and foreground servers |
| `Apertus-4B-Instruct-v1.1-Q8_0` | **expect `turn_boundary` to fail** — see below |

Being on this roster is not an endorsement: Granite is dropped from the *graded*
benchmark roster and Apertus is packaged wrongly. This is the set the scaffold
can serve, which is a different question from what a round should score.

Apertus is worth keeping precisely because it is broken: its `special_eos_id` is
not in `special_eog_ids`, so it never stops and role-plays both sides of the
conversation. It is the one model on the roster that demonstrates what a failed
`turn_boundary` probe looks like before you waste a session on it.

**There is no guard extension here.** The benchmark wraps its agent in
`bench-guard.ts`, which confines writes to the workspace, protects the task
file, and blocks package installs. pi-small has only `bash`, unguarded, by
design — so run it in a scratch directory. LFM2.5 overwrote the task prompt in
two separate benchmark tasks, and MiniCPM5 went looking for `npm install`.

### Where the weights actually live

Verified on the bench laptop 2026-09-19, because this is easy to get wrong —
`coding-bench/models.conf` documented the older behaviour until this was
checked:

**There is one copy of each model, not two.** This llama.cpp build (`0.4.0-dev`,
build 10896) downloads `-hf` models into the **Hugging Face hub cache layout**
itself — `models--<org>--<repo>/{blobs,refs,snapshots}` — and reads from it on
later runs. The `models--` path is a literal inside `llama-common.dll`; no
`huggingface_hub`, `hf` CLI or Python HF tooling is installed on that machine.
There is no `~/.cache/llama.cpp` and no GGUF outside the cache.

**The cache lives at `D:/llama-cache`, and `LLAMA_CACHE` must be set to it.**
The root is `$LLAMA_CACHE`, else `$HF_HOME/hub`, else
`$XDG_CACHE_HOME/huggingface/hub`, else `~/.cache/huggingface/hub` — that last
one is on `C:`, which was at 93% before the roster was moved off it.
[`../llama-cache.env`](../llama-cache.env) is the single source of truth for the
shell side; this plugin sets `LLAMA_CACHE` explicitly on the process it spawns,
from `defaults.llamaCache` in `roster.json`, with an inherited `LLAMA_CACHE`
winning over it. `/sm-status` prints the root in use. It must be a **Windows**
path: this goes through the environment, and MSYS does not translate
environment variables the way it translates arguments.

So `-hf` on an already-cached model does **not** re-download: in
`bench-filter-20260914-203559` llama-server was listening 6.4 s after start with
`-hf sizzlebop/Spark-X2.5-4B-GGUF`.

`localFile` therefore does not save a download. What it does buy is worth
keeping anyway: it skips the Hugging Face API round-trip that resolves a repo's
current `main`, and it pins the run to the exact snapshot already on disk, so a
third-party quant being re-uploaded mid-experiment cannot silently swap the
weights under a comparison.

Known ways weights get re-fetched despite being "already downloaded":

- **The cache root moves.** Anything that changes the server process's
  environment — a scheduled task under a different account, a container,
  cmd.exe vs MSYS, or simply an unset `LLAMA_CACHE` — points it at a different
  root and it downloads everything again, leaving the old copy on disk. Two
  roots have been in use on the laptop at different times; this is the
  mechanism behind the re-downloads, and why `LLAMA_CACHE` is now set from one
  file rather than assumed.
- **A llama.cpp upgrade that changes the scheme.** Older builds used flat files
  under `~/.cache/llama.cpp`; this one uses the HF layout. Crossing that change
  re-downloads every model once and orphans the old directory.
- **The quant file itself is re-uploaded.** Snapshots are keyed by commit and
  blobs by etag, so a README-only commit re-links the existing blob, but a
  re-uploaded `.gguf` is a genuine new download. Third-party quants
  (`sizzlebop`, `bartowski`) do get re-cut.
- **Disk-pressure cleanup.** `C:` has ~8.5 GB free with 24 GB of models on it.

## Running it

On the bench laptop, where `llama-server.exe` and the GPU are:

    ssh benchlaptop
    cd /d/llama.cpp/pi-small && ./bin/pi-small

The server binary defaults to `../llama-server[.exe]` (next to the harness
directories, the same place `run-filter-bench.sh` looks). Environment:

    PI_SMALL_MODEL          roster alias to start with
    PI_SMALL_ROSTER         alternative roster file
    PI_SMALL_SYSTEM_PROMPT  replace the near-empty system prompt
    PI_SMALL_PI_BIN         pi executable (default: pi on PATH)
    PI_SMALL_LLAMA_BIN      llama-server executable
    PI_SMALL_PORT / _HOST / _API_KEY
    LLAMA_CACHE             model cache root; wins over roster defaults.llamaCache
    PI_SMALL_LOG_DIR        where llama-server logs go (default: tmp/pi-small)
    PI_SMALL_START_TIMEOUT  seconds to wait for a load (default 900; the first
                            use of a model also downloads it)

## Developing without a GPU

`test/stub-server.mjs` is a fake llama-server: it accepts llama-server's flags,
records them, and answers `/health`, `/v1/models`, `/props` and
`/v1/chat/completions` (streaming and not). It replies with the sampler settings
the request carried, so `/sm-temp` is visible in the answer itself, and a
message starting with `!` comes back as a `bash` tool call.

    npm install                                     # dev deps for tests/typecheck
    npm test                                        # drives the plugin end to end
    npm run typecheck

A live session against the stub:

    PI_SMALL_LLAMA_BIN=$PWD/test/stub-server.mjs ./bin/pi-small
