# pi-small

An agent scaffold for the local 3B/4B models, built as a **pi plugin** rather
than a fork. `pi` itself (`@earendil-works/pi-coding-agent`) stays a stock npm
install and can be updated whenever; everything specific to this experiment
lives in this directory and moves on its own schedule.

    bin/pi-small        the entry point: pi with nothing of its own
    pi-small-docker.sh  the same thing, sandboxed  <- use this one
    serve.mjs           starts llama-server on the host, for the container
    proxy.mjs           or: a host daemon in front of llama-server that switches models on request
    extensions/small.ts the plugin: model, server, sampler, tools
    lib/roster.ts       roster + path/flag logic, with no dependency on pi
    lib/tools.ts         tool kinds (bash, read, write, …) and per-model guards
    roster.json         the models, and their per-model server/tool/prompt config
    docker/             the sandbox image
    templates/          chat templates, for models whose GGUF ships a bad one
    test/               stub llama-server + a test that drives the plugin

## Running it in a container (the normal way)

The models get `bash` with no guard extension. Two of the ones on the roster
have form — LFM2.5 overwrote the task prompt in two benchmark tasks, MiniCPM5
went looking for `npm install` — so the benchmark's answer applies here too: run
pi in a Linux sandbox whose only writable host path is the workspace.

    ./pi-small-docker.sh                          # roster default, interactive
    ./pi-small-docker.sh --model LFM2.5-2.6B-Q8_0
    ./pi-small-docker.sh --ws ./scratch           # a different workspace
    ./pi-small-docker.sh -- -p "list the files"   # args after -- go to pi
    ./pi-small-docker.sh --model Qwen3.6-35B-A3B-Q4_K_M --thinking off

It builds the image on first use, makes sure the model is served on the host,
and drops you into a session. The **workspace persists** — it is a host
directory mounted read-write at `/workspace`, and pi's own state (sessions,
history) lives in `workspace/.home`, so a session survives the container. The
plugin itself is mounted **read-only**, so a model cannot edit the thing that
constrains it.

### What runs where

| | host | container |
|---|---|---|
| llama-server, GPU, weights | yes | no |
| pi, the plugin, `bash` | no | yes |
| who picks the model | `serve.mjs` | follows the host |

`llama-server` cannot run in the container — it needs the GPU and the weights,
both on the Windows host — so the container reaches it over
`host.docker.internal`, exactly as the benchmark does. `serve.mjs` starts it
with the *same* `buildServerArgs` the plugin uses, so a containerised session is
served precisely what a local one would be.

    node serve.mjs                        # the roster default
    node serve.mjs Granite-4.2-3B-Q8_0    # a specific model
    node serve.mjs LFM2.5-2.6B-Q8_0 --ctx 8192
    node serve.mjs Qwen3.6-35B-A3B-Q4_K_M --thinking off
    node serve.mjs --status | --restart | --stop

It binds `0.0.0.0`, because `host.docker.internal` does not arrive on loopback.
That exposes the endpoint to the LAN, which is why the API key is always set;
pass `--host 127.0.0.1` for a local-only server. Like the plugin, it refuses to
kill a server it did not start — a benchmark run may own it.

**It checks the server it hands over.** After every start or adopt, `serve.mjs`
reads `/props` and compares the live sampler against the roster. For a model in
thinking-off mode it also sends one tiny request and confirms no
`reasoning_content` comes back. That is the check `--reasoning-budget 0` would
have failed silently on three models. A mismatch on a server it started itself
exits **3** and leaves the server running for inspection, so
`pi-small-docker.sh` never starts a session on it. On an adopted server a
mismatch is a loud warning instead, because the plugin injects the sampler per
request anyway. `--no-verify` skips the check.

A server serving the right model in the **wrong thinking mode** counts as the
wrong server: it is restarted if `serve.mjs` started it, and never silently
adopted. `serve.mjs` records the mode it started in a state file next to its
pidfile, because `/props` does not report template kwargs.

`pi-small-docker.sh` forwards the model name, `PI_SMALL_THINKING` and
`PI_SMALL_SYSTEM_PROMPT` into the container. Without the model name, pi's
session record inside the container named the roster default
(`Spark-X2.5-4B`) whatever the host was actually serving.

### Remote mode

Inside the container the plugin cannot own the `llama-server` *process*, so it
says so rather than failing oddly. It keeps everything request-level and gives
up everything process-level:

| | local | in the container |
|---|---|---|
| model, context, start/stop | plugin | **host** (`serve.mjs`) |
| temperature, probes, tools, prompt | plugin | plugin |

It attaches to whatever the host is serving — taking the alias from
`/v1/models` and the real context from `/props`, so the host is the source of
truth — and still runs both template probes. `/sm-temp` and `/sm-probe` work
normally. `/sm-model`, `/sm-ctx` and `/sm-restart` print the exact host command
to run instead. Remote mode turns on with `PI_SMALL_REMOTE=1`, or whenever the
configured host is not loopback.

### The host proxy: switching models from inside the container

`serve.mjs` fixes the model at launch, so a containerised pi could only change
models by exiting. `proxy.mjs` removes that. It listens on the roster port
instead of llama-server, runs llama-server behind it on a loopback-only port
(`PI_SMALL_BACKEND_PORT`, default 8125), and adds two endpoints:

    GET  /pi-small/status     { alias, thinking, ctx, state: ready|switching|down, error }
    POST /pi-small/model      { alias, thinking? }  -> switches, then answers with the status

    node proxy.mjs --model Granite-4.2-3B-Q8_0      # instead of node serve.mjs Granite-…

Everything else is passed through unchanged, including streaming. A switch
runs `serve.mjs` against the backend port, so the command line, context ladder,
sampler check and the refusal to kill someone else's server are all the same.
Requests that arrive during a switch wait for it (`PI_SMALL_PROXY_WAIT`,
default 900 s). Switches are serialised, the API key is required, and unknown
aliases are rejected.

The plugin finds the proxy through `/pi-small/status`. When it is there,
remote mode gets model switching back: `/sm-model` and pi's `/model` ask the
proxy, and a session that starts with a `PI_SMALL_MODEL` the host is not
serving asks for it. Without a proxy nothing changes. The staged workflow's
model rotation (`workflow/README.md`) depends on this.

### Running it uncontained

`./bin/pi-small` still works and is the right thing when you are iterating on
the plugin itself: the model stays under its own management, `/sm-model` works,
and there is no image to rebuild. Just do not point it at a directory you care
about.

## What the entry point does

`bin/pi-small` starts pi as a blank slate:

    --no-builtin-tools      no read/write/edit/grep/find/ls
    --no-extensions         nothing auto-discovered from ~/.pi or .pi
    --no-skills             no skills
    --no-context-files      no AGENTS.md / CLAUDE.md
    --no-prompt-templates --no-themes
    --system-prompt " "     see below
    -e <this directory>     load the pi-small plugin, and only it

So the model's entire surface — its tools, its system prompt, its sampler
settings and its context window — comes from the plugin, deliberately, and
(as of the fields below) can be tuned per model without touching any other
model's config.

**The system prompt is one space plus one line**, unless a model's roster.json
`systemPrompt` says otherwise (see "Per-model tools, parameters and system
prompt" below). pi replaces its default prompt only when the replacement is
non-empty (an empty string falls through to the full coding-agent prompt —
that is a real trap), and it always appends `Current working directory: <cwd>`.
What a model with no override actually receives is:

    " \nCurrent working directory: /path/to/cwd\n"

That is the emptiest prompt reachable without patching pi. Override it globally
with `PI_SMALL_SYSTEM_PROMPT`, or per model with roster.json `systemPrompt`.

**The tools default to pi's own `bash`**, re-registered by the plugin rather
than inherited, but a model's roster.json `tools` can ask for any combination
of pi's built-ins (`bash`, `read`, `write`, `edit`, `grep`, `find`, `ls`) — see
below. Nothing arrives by default beyond what roster.json's `defaults.tools`
lists.

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
- **The tools and the system prompt.** Which of pi's built-in tools a model
  gets, how each is configured, and what replaces the near-empty system prompt
  — all resolved per model from roster.json on every `/sm-model` switch.

### Commands

    /sm-status    model, server, context, sampler, tools, prompt, template, probe results
    /sm-model X   switch model (restarts the server; also switches its tools and prompt)
    /sm-ctx N     set context size (restarts the server)
    /sm-temp T    set temperature (no restart; kept across /sm-model — the ONLY
                  sampler value that is)
    /sm-thinking on|off   switch a model's thinking mode (restarts; the sampler
                  moves with the mode)
    /sm-probe     re-run the probes against the live server
    /sm-restart   restart with the current settings
    /workflow run <run-spec.json>   drive the staged workflow in this process
                  (sent by workflow/run.ts; see workflow/README.md)

**A model switch serves the new model's own sampler.** It used to carry the
whole sampler across as "session state", which served one model's card to the
next: Spark's `top_k 0` to Granite, whose card asks for 50, or Spark's temp 1.0
to LFM2.5, whose card asks for 0.1. Now only a temperature set deliberately
with `/sm-temp` survives a switch.

### Probes, and where their results go

Four checks run at every start, attach and `/sm-probe`:

| probe | catches |
|---|---|
| `turn_boundary` | generation that never stops (Apertus's EOS bug) or leaks chat control tokens |
| `tool_calls` | a template whose tool calls do not come back through `tool_calls` |
| `sampler` | a live server whose `/props` sampler differs from what the session intends |
| `thinking` | (thinking off only) a model that still returns `reasoning_content` |

The two template probes run **with thinking off** on a model that has modes.
They test the template, which does not depend on the mode, and a thinking model
reasoning about "Reply with exactly: OK" turns a seconds-long check into
minutes. Their timeout is `PI_SMALL_PROBE_TIMEOUT` (default 600 s). The old
fixed 120/180 s timeouts cancelled a working model's tool-call probe
mid-generation on Qwen3.6, which cost about 3 minutes of GPU per session and
reported a false `FAIL`.

When there is no interactive UI (`-p` one-shot mode, every scripted and
containerised run), probe results and every other pi-small warning **also go
to stderr**, which lands in the run log. pi's notifications go nowhere in that
mode, which is how a probe FAIL on every session of one round went unseen.

### The session log

Each pi process writes one JSONL file: `.home/.pi-small/session-*.jsonl` in the
container workspace, or the log directory otherwise (override with
`PI_SMALL_SESSION_LOG_DIR`). It records:

- the settings the session actually ran with: model, thinking mode, full
  sampler, context, `maxTokens`, probe results;
- the **effective system prompt's length and sha256**. pi does not persist the
  prompt itself, and before this the only proof a prompt had arrived was a
  difference in prompt-token counts;
- every assistant response: stop reason, token usage, characters of thinking,
  and wall time. Use `thoughtChars` for thinking volume, not `usage.reasoning`:
  llama-server does not break reasoning tokens out, so pi records 0 there even
  for a response that thought (verified live: 292 chars of thinking, reported
  `reasoning: 0`).

A response that stops at `max_tokens` is also reported as it happens, and
named explicitly when it stopped with **no answer at all**. That is what an
unrestricted think running into the cap looks like, and it is otherwise
indistinguishable from a model that gave up.

To analyse runs afterwards, see [`eval/`](eval/README.md).

### `/model` works too, not just `/sm-model`

The whole roster is registered under the `small-local` provider, so pi's own
`/model` (and Ctrl+P cycling) lists every alias, not just whichever one is
currently being served — a real provider's models are all reachable at once,
and `/model` expects that. Picking a different one there fires the same
restart `/sm-model` does, through pi's `model_select` event; `/sm-model` is
just a thin, scriptable way to trigger the identical path. **It cannot be
instant the way it is for a real hosted provider** — llama-server only ever
serves one model, so the first message after a `/model` switch pays for the
restart (server relaunch + health check + probes) before it streams.

`/model`'s "set as default" writes `defaultProvider`/`defaultModel` to
`~/.pi/agent/settings.json`, same as for any other provider. `bin/pi-small`
reads that back at startup (unless `PI_SMALL_MODEL` is set) — pi itself does
not consult it for a session that always passes an explicit `--model`, which
this one does, so without this the saved default silently did nothing.

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

## Per-model tools, parameters and system prompt

Everything the roster lets you tune per model, so fixing one model's problem
never touches another's config:

| what | roster.json field | default (roster.json `defaults`) | restart needed |
|---|---|---|---|
| sampler / context / reasoning budget | `temp`, `topP`, `topK`, `repeatPenalty`, `minP`, `presencePenalty`, `ctx`, `reasoningBudget` | yes | ctx: yes; sampler: no |
| thinking mode, and one sampler per mode | `thinking` (`on`/`off`), `samplers.thinking` / `samplers.instruct` | — (no mode) | yes (`/sm-thinking`) |
| largest single response (thinking + answer) | `maxTokens` | `defaults.maxTokens` (4096) | model switch |
| GPU layers | `ngl` | `defaults.ngl` (999) | yes |
| context fallback if `ctx` does not fit | `ctxCandidates` | `defaults.ctxCandidates` (`[16384, 12288, 8192]`) | — (probed automatically at start) |
| server flags | `serverArgs` | yes | yes |
| chat template | `chatTemplate` | — | yes |
| tool set | `tools` | `defaults.tools` (`["bash"]`) | model switch |
| tool config / guards | `toolOptions` | `defaults.toolOptions` (`{}`) | model switch |
| system prompt | `systemPrompt` | `defaults.systemPrompt` (unset) | takes effect next turn |

A model that sets none of these just inherits `defaults`, which is why most
roster.json entries only mention weights and notes.

**`tools`** lists which of pi's built-in tool kinds this model gets —
`bash`, `read`, `write`, `edit`, `grep`, `find`, `ls` (see `lib/tools.ts`).
It replaces `defaults.tools` outright for that model; it is not merged with it.
Most models want `["bash"]`, same as today, but nothing stops one model from
getting `["bash", "read", "grep"]` while the rest stay bash-only.

**`toolOptions`** carries that model's config for one tool kind, keyed by kind
name, e.g. `{ "bash": { "commandGuards": [...] } }`. Each kind's options fully
replace `defaults.toolOptions` for that same kind; kinds you do not mention
still fall back to the default. This is where a guard, a narrower option, or a
different error message for ONE model's tool lives. bash gets one addition
beyond pi's own bash options: `commandGuards`, a list of
`{ pattern, message, flags? }` checked against the command line before it
runs — a match refuses the command and shows `message` on stderr instead of
running it. roster.json's MiniCPM5 entry uses this for real:

    "toolOptions": {
      "bash": {
        "commandGuards": [
          { "pattern": "\\bnpm\\s+(install|i|ci)\\b", "message": "npm install is disabled for this model: …" },
          { "pattern": "\\bnpx\\b", "message": "npx is disabled for this model for the same reason …" }
        ]
      }
    }

MiniCPM5 reached for `npm install` and `npx ts-node` in an earlier run and
burned its time budget on it (see the roster note); this refuses the call
instead of letting the model try, and tells it why, without touching bash for
any other model.

**`systemPrompt`** replaces the near-empty prompt for this model only,
re-resolved on every turn (`before_agent_start`) so it follows `/sm-model`. A
model with no `systemPrompt` of its own and no `defaults.systemPrompt` leaves
pi's prompt exactly as `PI_SMALL_SYSTEM_PROMPT` / the CLI set it — nothing
changes for models that do not opt in. roster.json's LFM2.5 entry uses this for
a documented failure mode: it overwrote a file it had been given to read from,
twice, in an earlier benchmark run, so its `systemPrompt` tells it to read a
file before writing near it.

`/sm-status` prints the resolved tool list and whether the system prompt is a
roster override or the default.

For a prompt that should apply to **whatever model a run happens to serve** —
an A/B where the prompt is the variable and the model is not — set
`PI_SMALL_SYSTEM_PROMPT` instead of editing the roster. `pi-small-docker.sh`
forwards it into the container when it is set; without that it silently did not
exist on the containerised path, since the variable was set on the host and the
agent runs in the container, and the session came up with the near-empty
default. A model's own roster `systemPrompt` still wins over it.

## Context that fits the GPU

There is no reliable way to know ahead of time whether a model's KV cache at a
given context fits in whatever VRAM happens to be free on a shared card — the
only way to find out is to actually try starting the server at that size.
`ServerManager.start()` mirrors `coding-bench/run-filter-bench.sh`'s per-model
context probe for exactly this reason: it tries `ctx` (or whatever a specific
`/sm-model` / `/sm-ctx` call asked for) first, and on failure falls back
through `ctxCandidates` — the model's own, else `defaults.ctxCandidates`
(`[16384, 12288, 8192]`, the ladder the benchmark validated on this
laptop's 6 GB card) — largest to smallest, keeping the first size that comes
up healthy. `/sm-status` and the startup notices say which one it landed on
and whether it had to fall back at all.

A "did not fit" fallback is different from llama-server capping `-c` at a
model's *training* context (Apertus's `ctx: 4096`, say) — that one is not a
failure, just a smaller number reported back, and is unaffected by this. The
two can combine: a candidate can load successfully but get capped smaller by
the training context, in which case pi-small restarts once more at the real
served size, so `--reasoning-budget` (derived from the context) is not
computed against a window bigger than what the model is actually getting.

This is also what makes a GPU-memory crash fail fast instead of hanging:
`waitHealthy` used to poll `/health` for the full `PI_SMALL_START_TIMEOUT`
(900s default) even after the spawned process had already exited — fine for a
single attempt, but multiplied across a whole ladder of failed candidates it
would have made the fallback nearly unusable. It now gives up the moment the
process is confirmed dead instead.

If a model does not fit at ANY of its candidates, pi-small says so and gives
up cleanly rather than leaving something half-started — same as the benchmark
recording `SKIPPED.txt` and moving on rather than sinking the whole run.

### The floor: pi cannot use a 4096-token window

The ladder stops at **8192, not 4096**, and that is a property of pi rather
than of any model or of llama-server. `clampMaxTokensToContext` in pi's bundle
reads:

    CONTEXT_SAFETY_TOKENS = 4096, MIN_MAX_TOKENS = 1
    available = model.contextWindow - estimateContextTokens(context) - 4096
    return Math.min(maxTokens, Math.max(1, available))

The margin is a constant and does not scale with the window. At
`contextWindow` 4096 the subtraction is already negative before the prompt is
counted, so `max_tokens` is clamped to **1** and every request comes back as a
single token with `finish_reason: "length"`. Nothing errors. The session simply
produces one character per turn, which reads exactly like a broken model.

Observed twice against Qwen3-Coder at ctx 4096 on 2026-09-22, and pinned down
by pointing `curl` at the same server: llama-server answered normally, so the
server was never the problem. The costly part is that llama-bench had validated
that model's config *at* 4096, which makes 4096 the natural number to reach for
— and it is the one size pi cannot use.

Consequences, all of them enforced in code rather than left as a note:

- `defaults.ctxCandidates` is `[16384, 12288, 8192]`. Offering 4096 as the last
  rung would trade a server that refuses to start for a session that silently
  does nothing, which is strictly worse.
- `ctxUsabilityWarning()` in `lib/roster.ts` is reported by both halves at
  every start — including the remote-mode attach, where the context comes from
  whatever the host is already serving and nothing in the container chose it.
- Adopting an already-running server compares the **context**, not just the
  alias. A leftover at a smaller window is the wrong server; `serve.mjs`
  restarts it when it owns it, and refuses with an explanation when it does
  not.
- Apertus keeps `ctx: 4096` because its *training* context is 4096 and it
  cannot go higher. It now starts with the warning attached, which is the
  honest answer: that model is not usable through pi for real work.

**`serve.mjs` walks the same ladder**, and that is the one the container path
depends on. Under `pi-small-docker.sh` the plugin is in remote mode and starts
nothing: the host half picks the context, and for a long time it got a single
attempt with no fallback and no fail-fast, so a size the local plugin would
have recovered from killed the containerised session outright. The two are
separate processes and cannot share a call stack, so `test/serve-test.ts`
covers the host half specifically — the ladder, the give-up, and the
`repo: "local"` weights check — rather than trusting that the two
implementations stay in step on their own.

Three things the two halves have to agree on, each learned by the host half
being wrong about it:

- **`shell: true` for a `.cmd`/`.bat` binary.** Node refuses to spawn one
  directly (`EINVAL`). Only `PI_SMALL_LLAMA_BIN` pointing at a wrapper hits
  this, which is exactly what the tests do on Windows.
- **`taskkill /T` rather than `process.kill`** when stopping on Windows. The
  latter reaches only the process `spawn()` created; with a `.cmd` that is
  `cmd.exe`, and the real server survives as a grandchild still holding the
  port — after which the next start reports "already serving" and, correctly,
  refuses to kill what now looks like someone else's server.
- **A missing `repo: "local"` file is checked before the ladder,** not inside
  it. The weights path does not depend on the context, so every candidate
  would fail identically, and `buildServerArgs`' error would surface as an
  unhandled rejection with a stack trace instead of one readable line.

Every server `serve.mjs` starts is detached, so it outlives its launcher by
design — including a test run or an ssh session killed partway through. A
leftover then answers on the port and the next run reports "already serving".
`serve.mjs --stop` clears it; `test/serve-test.ts` does that as a preflight and
otherwise stops with a message saying so, because refusing to kill a server it
did not start is the one safety property `serve.mjs` has.

## Its own pi config directory

`bin/pi-small` runs with `PI_CODING_AGENT_DIR` pointed at `pi-small/.pi-home`
(uncontained mode) instead of the real `~/.pi/agent` — sessions, trust
decisions, and one setting in particular all live there, isolated from every
other pi session on this machine:

**`compaction.reserveTokens`/`keepRecentTokens`** default to `16384`/`20000`
— sized for frontier models with 100k+ token context windows. At this
roster's 4k-16k windows, the "should I compact" check
(`contextTokens > contextWindow - reserveTokens`) trips almost immediately,
but the compaction itself silently no-ops every single time: there is never
anything older than `keepRecentTokens` (bigger than any window here) to
actually cut. Auto-compaction never does anything; context grows
unconstrained until the model runs out of real room mid-response — surfacing
as **"Response was truncated before completion"**, not as a compaction
failure. Manual `/compact` hits the identical wall, just as a visible
**"session too small to compact"** error instead of a silent no-op.

pi-small seeds `.pi-home/settings.json` with `reserveTokens: 6144` /
`keepRecentTokens: 1024` — flat numbers, not scaled with `ctx`, because nothing
here CAN scale with `ctx` reliably: the context ladder above means the same
roster entry can end up served at 16384 or 4096 depending on what actually
fit, and pi has no extension API or CLI flag to set these per-request or
per-model, only this one static settings file read once at startup. The
values have to work across the roster's whole range at once. They pair with
each model's `maxTokens` (roster, default `4096`, also flat). That cap is sized
for **reasoning + answer combined**, not just the answer: this provider does
not set `compat.thinkingTokenBudgetField`, so nothing tells llama-server to
track thinking tokens separately from `max_tokens`, and an unrestricted think
can consume the whole cap. `reserveTokens` must stay comfortably above the
largest `maxTokens`. That gap is what actually keeps room free, by triggering
compaction before the window fills, so widening one without the other reopens
the exact mismatch this whole mechanism exists to close. **`bin/pi-small` now
enforces it**: at every launch it raises `reserveTokens` to
`requiredReserveTokens(roster)` (largest `maxTokens` + 2048, never below 6144)
if the file holds less, and it never lowers a value set higher on purpose. Apertus's fixed 4096 window is
inherently too tight for this to fully rescue regardless of tuning, same as
its context-ladder situation above.

The directory is seeded once (never overwritten on a later launch, so
`/model`'s "set as default" survives), and a `small-local` default already
saved in the REAL global settings is migrated in automatically the first time
`.pi-home` is created, so switching to this stays a one-time no-op rather than
a lost preference.

**Containerised mode is different.** `PI_SMALL_REMOTE=1` (set by
`pi-small-docker.sh`) already runs with `HOME` redirected to the workspace, so
pi's own default resolution (`HOME/.pi/agent`) is already isolated there — and
the plugin directory is bind-mounted read-only inside the container, so
nothing could be created under it anyway. `bin/pi-small` detects
`PI_SMALL_REMOTE=1` and seeds `HOME/.pi/agent/settings.json` directly instead
of exporting `PI_CODING_AGENT_DIR` a second time.

Override the directory entirely with `PI_SMALL_PI_HOME`.

## Roster

`roster.json` uses the same fields as `coding-bench/models.conf`: `repo` is a
Hugging Face repo id that llama-server downloads itself with `-hf`/`-hff`, or
the literal `local`, in which case `file` is a path on the serving machine.
`defaults` sets the port, API key, context, sampler, reasoning budget, tools
and system prompt; any model may override them — see "Per-model tools,
parameters and system prompt" above for `tools`/`toolOptions`/`systemPrompt`
specifically.

`localFile` is the one addition: a copy already on the serving machine, used
with `-m` when it resolves, falling back to `repo`/`file` when it does not. It
may start with `~` and may contain `*` in a path segment, because the cache
hides the weights behind a snapshot hash. `/sm-status` prints which of the two
is in use.

### What is on the roster

Everything the benchmark has used, minus VibeThinker — which has no tool-calling
capability at all and so cannot drive an agent loop (see
`coding-bench/models.conf`) — plus one model far outside the size class the
scaffold was built for. Spark is the default.

| model | note |
|---|---|
| `Spark-X2.5-4B-Q6_K` | default; best verification behaviour of the roster |
| `Granite-4.2-3B-Q8_0` | strong algorithms, thin on verification |
| `Nanbeige4.2-3B-Q6_K` | slowest of the three 3-4B models |
| `LFM2.5-2.6B-Q8_0` | smallest and fastest; roster `systemPrompt` warns it about overwriting files, see below |
| `MiniCPM5-2B-Q8_0` | reaches for npm/npx and foreground servers; roster `toolOptions` guards `npm`/`npx` in bash, see below |
| `Qwen3-Coder-30B-A3B-Q4_K_M` | **beyond VRAM, NOT RECOMMENDED** — 17.28 GiB MoE; the only failure across both beyond-VRAM rounds (same bug five times, reported verified), and no faster than Qwen3.6 in a session |
| `Qwen3.6-35B-A3B-Q4_K_M` | **beyond VRAM** — 19.0 GiB MoE, `--n-cpu-moe 32`; thinking on by default; passed the debounce task in 17 min |
| `Qwen3.8-27B-UD-IQ4_XS` | **beyond VRAM, dense** — 13.26 GiB, `ngl 20`; thinking on by default; fast prompts, ~1.2 t/s generation, so thinking makes it slow (85 min for debounce) |
| `Granite-4.2-30B-Q4_K_M` | **beyond VRAM, dense** — 16.50 GiB, `ngl 10`, pinned to ctx 8192; thinking on by default; the slowest model here |
| `Apertus-4B-Instruct-v1.1-Q8_0` | **expect `turn_boundary` to fail** — see below |

The four beyond-VRAM entries carry configurations that were **measured**, not
guessed — `--n-cpu-moe` for the MoE pair, `ngl` for the dense pair — in
[`../large-model-hybrid-inference-findings-20260922.md`](../large-model-hybrid-inference-findings-20260922.md).
Do not round them off: for the dense models one layer too many on the GPU is a
CUDA OOM at load, and for the MoE pair the curve is not monotonic, so a
"safer-looking" neighbouring value can be several times slower.

`ngl` is a per-model field rather than a `serverArgs` entry on purpose. In
`serverArgs` it would appear as a *second* `-ngl` after `defaults.ngl` (999) on
the same command line, leaving llama.cpp's last-one-wins parsing as the only
thing deciding which of the two applies.

Being on this roster is not an endorsement: Granite is dropped from the *graded*
benchmark roster and Apertus is packaged wrongly. This is the set the scaffold
can serve, which is a different question from what a round should score.

### Samplers come from the vendor, explicitly

Every model states its **full** sampler in `roster.json` — `temp`, `topP`,
`topK`, `repeatPenalty`, `minP`, `presencePenalty` — taken from that vendor's
own `generation_config.json` and model card. None of them are inherited, and
that is the point.

The failure this prevents: the roster used to serve everything at
`temp 0.7 / top_p 0.95 / top_k 40` and never passed `--repeat-penalty` or
`--min-p` at all. `0.95` and `40` are *exactly* llama.cpp's built-in defaults,
so a setting nobody had chosen was indistinguishable from a deliberate one, and
the two unset parameters were invisible. Qwen3-Coder's card asks for
`0.7 / 0.8 / 20 / 1.05`, and three of the four silently did not apply.

Where a vendor omits a field, transformers' `GenerationConfig` default is
recorded (`top_k 50`, `top_p 1.0`, `repetition_penalty 1.0`, `min_p` disabled,
`presence_penalty 0`), because that is what the vendor's reference
implementation actually runs — and it differs from llama.cpp's (`top_k 40`,
`top_p 0.95`, `min_p 0.05`).

| model | temp | top_p | top_k | repeat | min_p | presence |
|---|---:|---:|---:|---:|---:|---:|
| `Spark-X2.5-4B-Q6_K` | 1.0 | 0.95 | 0 (card: disabled) | 1.0 | 0 | 0 |
| `Granite-4.2-3B-Q8_0` | 1.0 | 0.95 | 50 | 1.0 | 0 | 0 |
| `Nanbeige4.2-3B-Q6_K` | 0.6 | 0.95 | 20 | 1.0 | 0 | 0 |
| `LFM2.5-2.6B-Q8_0` | **0.1** | 1.0 | 50 | 1.1 | 0 | 0 |
| `MiniCPM5-2B-Q8_0` | 1.0 | 0.95 | 50 | 1.0 | 0 | 0 |
| `Qwen3-Coder-30B-A3B-Q4_K_M` | 0.7 | 0.8 | 20 | 1.05 | 0 | 0 |
| `Qwen3.6-35B-A3B-Q4_K_M` — thinking (default) | 1.0 | 0.95 | 20 | 1.0 | 0 | **1.5** |
| `Qwen3.6-35B-A3B-Q4_K_M` — instruct | 0.7 | 0.8 | 20 | 1.0 | 0 | **1.5** |
| `Qwen3.8-27B-UD-IQ4_XS` — thinking (default) | 1.0 | 0.95 | 20 | 1.0 | 0 | 0 |
| `Qwen3.8-27B-UD-IQ4_XS` — instruct | 0.7 | 0.8 | 20 | 1.0 | 0 | **1.5** |
| `Granite-4.2-30B-Q4_K_M` — both modes | 1.0 | 0.95 | 50 | 1.0 | 0 | 0 |
| `Apertus-4B-Instruct-v1.1-Q8_0` | — | — | — | — | — | — |

`presencePenalty` was added for the Qwen3.6/3.8 entries: their cards ask for
`presence_penalty 1.5` (Qwen3.6 in both modes, Qwen3.8 in instruct mode). It had
no field to live in, which is the same failure as before in a new place: a value
the card states explicitly, silently served as the engine's `0`.

The moded models carry **one sampler per mode** (`samplers.thinking` /
`samplers.instruct`) because the cards pair different numbers with each mode.
The active mode picks the row; see *Thinking models* below.

Granite 4.2 30B is the unusually firm one: IBM's card says `temperature 1.0`
and `top_p 0.95` for **all** tasks, modes and serving backends.

LFM2.5 is the sharpest correction: its card asks for **temperature 0.1** and it
had been running at 0.7 for every round. Apertus is the one model still on the
roster defaults — swiss-ai's repo is gated (HTTP 401) so its card could not be
read — and that is recorded in its `notes` rather than papered over.

**This is deliberately the opposite of `coding-bench/models.conf`**, which
serves every model identically at `temp 0.7 / top_k 40` *for* cross-model
comparability. That harness is a measurement instrument; pi-small is a scaffold
for using these models, so here the model card wins. Changing one does not
change the other — they share no config.

Two mechanical details worth keeping:

- The sampler is injected **per request** as well as passed on the command
  line. In remote mode the container never starts the server, so request-level
  parameters are the only ones the plugin controls; anything omitted there
  reinstates llama.cpp's defaults no matter what the roster says.
- `serve.mjs` builds its own sampler object. When `repeatPenalty`/`minP` were
  added it was missed, and they reached the command line as `String(undefined)`
  — llama.cpp then fell back to its defaults silently. `test/serve-test.ts`
  asserts the values on the actual argv for this reason.

### Thinking models: `thinking` is the switch, not `reasoningBudget`

Three of the four beyond-VRAM models (Qwen3.6, Qwen3.8 and Granite 4.2 30B)
**think by default**, and the roster now serves them that way, as their vendors
ship them:

    "thinking": "on",
    "reasoningBudget": -1,
    "samplers": {
      "thinking": { "temp": 1.0, "topP": 0.95, ... },
      "instruct": { "temp": 0.7, "topP": 0.8,  ... }
    }

Switch per run with `PI_SMALL_THINKING=off` (host and container), `serve.mjs
--thinking off`, `pi-small-docker.sh --thinking off`, or `/sm-thinking off` in a
local session. The sampler row moves with the mode, so no combination can serve
one mode's numbers in the other.

**Why a field, and not `reasoningBudget: 0`.** `--reasoning-budget 0` reads like
the off switch and is not one on these templates. Measured on all three on
2026-09-22: with it set, each still returned a populated `reasoning_content`,
and a request capped at 120 tokens came back as 120 tokens of thoughts with
`content: ""` and `finish_reason: "length"`. Nothing warned, and it looks
exactly like a model that cannot answer. What works is the template's own
switch. For a model with a `thinking` field, pi-small emits
`--chat-template-kwargs {"enable_thinking":…}` on the command line **and** as
`chat_template_kwargs` on every request, because in the container the request
is the only lever. With thinking off it also passes `--reasoning-budget 0`.
`serve.mjs` and the `thinking` probe then confirm live that no reasoning comes
back. Do not put either flag in `serverArgs` as well; `check-roster.mjs` and
the tests reject that.

**What thinking costs here.** It is charged at generation speed, which on these
models runs from ~1 t/s (Granite, Qwen3.8) to ~4-10 t/s (Qwen3.6). On the
debounce task, Qwen3.6 with thinking took 17 minutes; Qwen3.8 took 85, 96% of it
generation. For interactive use of the dense models, `PI_SMALL_THINKING=off` is
usually the right call.

**The ceiling is `maxTokens`, not the budget.** `-1` is unrestricted, but each
response is capped at the model's `maxTokens` (default 4096), thinking and
answer combined. The vendors' own evals assume up to 32k. The session log and
stderr say so when a response stops at the cap with no answer. Raise
`maxTokens` per model if that happens; `bin/pi-small` raises pi's compaction
reserve to match.

- llama-server also logs `chat template supports preserving reasoning, it is
  enabled by default (may use more tokens)`. Reasoning from earlier turns is
  kept in context unless `--no-reasoning-preserve` is passed — worth knowing
  when the window is 16k and prompt processing is the bottleneck.

Former aliases, removed 2026-09-23 when thinking became a field:
`Qwen3.6-35B-A3B-Thinking-Q4_K_M` → `Qwen3.6-35B-A3B-Q4_K_M` (now thinking on by
default), and `Qwen3.8-27B-Thinking-UD-IQ4_XS` → `Qwen3.8-27B-UD-IQ4_XS`. The
earlier thinking-off configuration is `PI_SMALL_THINKING=off`.

### A full card is not a context ceiling

Worth knowing before tuning `ctx` down to fit a model: on this GPU, **it very
likely already does not fit, and that is fine.** CUDA reports `VMM: yes`, so
llama.cpp oversubscribes VRAM into system RAM rather than failing, and
`nvidia-smi` pins at 6037 MiB of 6144 for Qwen3-Coder at *every* context size —
8192, 16384 and 32768 all read identically. The number looks like a wall and is
not one.

Swept on 2026-09-22 with f16 KV, `--n-cpu-moe 34 -t 8`, on a 2659-token prompt:

| ctx | KV | generation t/s | incremental-turn t/s |
|---:|---|---:|---:|
| 8192 | f16 | 2.22 | 4.89 |
| 16384 | f16 | **2.45** | **4.89** |
| 32768 | f16 | **2.58** | 4.66 |
| 65536 | f16 | 1.14 | 3.11 |
| 16384 | q8_0 | 1.80 | 3.00 |
| 32768 | q8_0 | 1.81 | 2.64 |

**Context up to 32768 is free here**, because the KV cache is not what this
model is bottlenecked on — expert streaming is. 65536 is where it finally costs
about half the generation speed.

Two practical consequences:

- **Do not quantize the KV cache on this machine.** `-ctk/-ctv q8_0` saves
  nothing (it spills either way) and costs real throughput at every size.
- **`-fa` is already on.** The default is `auto`, which resolves to on;
  passing `-fa on` explicitly changed neither VRAM nor speed.

Qwen3-Coder is the odd one out in every respect. It is a 30B MoE at 17.28 GiB
against a 6 GiB card, and it runs only because `--n-cpu-moe 34` keeps most
expert weights in system RAM while the attention path gets the GPU — see
`../large-model-hybrid-inference-findings-20260922.md` for how that number was
found, and `../pi-small-qwen3-coder-findings-20260922.md` for what it does in
an actual pi-small session. Two things to know before reaching for it: it is
`repo: "local"`, so its weights must already be on the machine and a wrong path
fails loudly instead of starting a 17 GiB download; and the throughput
llama-bench measured does **not** transfer to a live agent session — expect
roughly half the generation speed and a small fraction of the prompt-processing
speed. It carries no `ctx` override: the roster defaults are measured-correct
for it, see above.

Apertus is worth keeping precisely because it is broken: its `special_eos_id` is
not in `special_eog_ids`, so it never stops and role-plays both sides of the
conversation. It is the one model on the roster that demonstrates what a failed
`turn_boundary` probe looks like before you waste a session on it.

**There is no guard extension here.** The benchmark wraps its agent in
`bench-guard.ts`, which confines writes to the workspace, protects the task
file, and blocks package installs. pi-small has only `bash` by default,
unguarded, by design — the container is the containment for models in
general (see *Running it in a container* above). MiniCPM5 is the one
exception: its roster.json `toolOptions.bash.commandGuards` blocks `npm
install`/`npx` specifically, because that is a real, previously-observed
failure for that one model — not a general bench-guard equivalent, and not
applied to any other model. Prefer `./pi-small-docker.sh` over `./bin/pi-small`
for anything but plugin development regardless.

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

    PI_SMALL_MODEL          roster alias to start with (default: pi's own
                            saved default for small-local, if /model's "set
                            as default" has been used; else the roster's
                            `default: true` entry)
    PI_SMALL_ROSTER         alternative roster file
    PI_SMALL_SYSTEM_PROMPT  fallback system prompt for models with no
                            roster.json `systemPrompt` of their own
    PI_SMALL_PI_BIN         pi executable (default: pi on PATH)
    PI_SMALL_LLAMA_BIN      llama-server executable
    PI_SMALL_PI_HOME        pi's config dir for this session — see "Its own pi
                            config directory" (default: pi-small/.pi-home
                            uncontained; HOME/.pi/agent when PI_SMALL_REMOTE=1)
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
    npm run check                                   # resolve the roster, start nothing
    npm test                                        # drives the plugin end to end
    npm run typecheck

`npm run check` is the pi-small equivalent of `run-filter-bench.sh
--check-models`: for every model it says whether the weights are on this machine
and where, or whether a session would fall back to `-hf` and download them, and
lists any non-default `tools`/`toolOptions`/`systemPrompt`. It uses the
plugin's own resolver, so it cannot drift from what a real session does. Run it
on the serving machine — on any other box everything reads DOWNLOAD, which is
correct rather than a failure.

A live session against the stub:

    PI_SMALL_LLAMA_BIN=$PWD/test/stub-server.mjs ./bin/pi-small
