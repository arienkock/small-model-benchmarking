# sm-persona — a conversational mode for pi-small, behind an OpenAI endpoint

Status, 2026-09-26: **v1 implemented and tested without a GPU**. That covers
persona mode in the plugin, `bin/sm-persona`, `persona/server.mjs`, the
`weather` tool and follow-ups (`test/persona-test.ts`, `test/persona-e2e.ts`).
Not done yet: a live run on the laptop with Qwen3.6, `persona/ctl.sh` and
`start.sh` (the boot service), and the eval. The "Future work" section is
parked.

Intended end state: if it works well, this becomes **the laptop's primary job**.
The persona starts at boot as a background service and is always up. It goes
down only when the GPU is wanted for something else, such as a coding session
on a specific model or a bench run, and comes back afterwards. Its default
model is **Qwen3.6-35B-A3B with thinking off** (see "Roster" and "Choosing the
model").

**v1 scope:** the persona owns its llama-server, the way an uncontained
`bin/pi-small` does, and has the GPU to itself. Sharing one server with coding
agents, and delegating tasks to them, is designed but parked. See "Future
work: sharing the server" at the end.

## What it is for

A speech pipeline that is stateless today:

    mic → STT server → [one user message] → LLM (OpenRouter, fresh each time) → TTS → speaker

The LLM hop is replaced with a long-lived pi-small session on the bench laptop that
keeps the conversation, compacts it, and carries **memory** across compactions
and restarts. The STT server does not change: it still sends a single message
to an OpenAI-compatible `/v1/chat/completions` and reads back one reply.

    STT server ──HTTP──▶ persona/server.mjs ──RPC (stdin/stdout JSONL)──▶ pi --mode rpc
                         (LAN, :8130)                                      + pi-small plugin, PI_SMALL_MODE=persona
                                                                                │ starts, probes, stops
                                                                                ▼
                                                                           llama-server (:8123, loopback)

Two pieces, kept separate on purpose:

- **The harness mode** (`PI_SMALL_MODE=persona`, entry point `bin/sm-persona`):
  everything about *what the model sees* — prompt, memory, compaction, persona tools,
  sampler/length caps. Usable interactively in a terminal, which is how it gets
  tested without any audio.
- **The server** (`persona/server.mjs`): everything about *the wire* — OpenAI
  request/response shape, auth, queueing, streaming, output sanitising, and
  *when* to compact. It holds no conversation state of its own; pi's session
  file does.

Why pi in RPC mode, rather than a server that builds prompts and calls
llama-server itself: that would reimplement exactly the parts this repo has
already paid for — the roster and its model selection, the ctx ladder, the
server adoption/refusal rules, the sampler injection, the probes, the in-context
compaction hook, the session log. RPC mode (`pi --mode rpc`, documented in pi's
`docs/rpc.md`) exposes `prompt`, `compact`, `get_session_stats` and streaming
`message_update` text deltas, which is everything the server needs.

## Part 1 — harness changes (the persona mode)

### Entry point: `bin/sm-persona`

A thin wrapper around `bin/pi-small`:

```bash
export PI_SMALL_MODE=persona
export PI_SMALL_PI_HOME="${PI_SMALL_PI_HOME:-$PERSONA_HOME/pi}"   # own settings.json, own sessions
exec "$HERE/bin/pi-small" --session-dir "$PERSONA_HOME/sessions" --continue "$@"
```

It runs **uncontained, in local mode**: the plugin starts, probes and stops
llama-server itself, as `bin/pi-small` does. There is no bash and no file
access, and its tools only make fixed, read-only web requests, so there is
nothing for a container to contain. The usual rules apply: it adopts a server already
serving its model, and refuses to touch one serving anything else.

- `PERSONA_HOME` defaults to `D:/persona` on the laptop (not C:, not the repo —
  it holds personal data; gitignored if it ever sits inside the checkout).
- `--continue` resumes the latest session, so a restart (reboot, crash, model
  switch) picks the conversation back up.
- Its own `PI_SMALL_PI_HOME` gives it its own `compaction.reserveTokens` /
  `keepRecentTokens` without touching the coding sessions' settings — the same
  mechanism `bin/pi-small` already uses to isolate itself from `~/.pi/agent`.
- Interactive use (`./bin/sm-persona`) is a typed chat with the persona; the
  server runs the same thing with `--mode rpc`.

**Model selection uses the same mechanism with one extra step.** In order:
`PI_SMALL_MODEL`, then pi's saved `small-local` default in the persona's own
pi home (so `/model`'s "set as default" there applies to the persona only),
then **`defaults.persona.model` in the roster (Qwen3.6-35B-A3B-Q4_K_M)**, then
the roster's `default: true` entry. That last one stays Spark for coding
sessions, so neither default moves the other. `/sm-model` and `/model` switch
live, and the whole roster is available. What changes per model is a
`persona` block (below).

### `/sm-persona` command

In the plugin, available in any mode:

    /sm-persona            show the memory file, its tiers' sizes, last compaction time
    /sm-persona remember   compact now and write memory (not speculative: runs to completion)
    /sm-persona forget <text>   drop matching lines from memory (manual correction)

### What changes in `extensions/small.ts` when `PI_SMALL_MODE=persona`

| hook | coding mode (today) | persona mode |
|---|---|---|
| tools (`registerToolsFor`) | roster `tools` (bash) | the persona tools only (`persona.tools`, default `weather`); no bash |
| `before_agent_start` | roster prompt + `SESSION_STYLE` | `persona.md` + `PERSONA_STYLE` + memory file (see below) |
| `before_provider_request` | roster sampler | roster sampler, `max_tokens` = persona cap, thinking per persona block |
| `session_before_compact` | Lessons / Next steps | three memory tiers, written to the memory file |
| probes | all four | all four (`tool_calls` only when the model has persona tools) |

Everything else, including server start/adopt/refuse, the ctx ladder,
sampler checks and the session log, is untouched.

The logic lives in a new `lib/persona.ts` (no pi dependency, unit-testable like
`lib/compaction.ts`): the style text, the prompt assembly, the compaction
instruction, the tier parser and the memory-file guards.

### The system prompt

Three parts, in this order, and nothing about the date or time (see "Time"
below — anything that changes per turn in the system prompt defeats
llama-server's prompt cache):

**Principle: constrain the medium, not the voice.** The prompt says what the
situation is and what the output has to survive (being spoken aloud, being
short). It never scripts wording. That means no example replies, no quoted
phrases to use, no few-shot turns, and no adjectives for tone beyond what
`persona.md` sets. Each model's own manner should come through, and
`persona.md` steers it from there. Two layers, kept apart:

1. **`persona/persona.md`** is the personality layer, and the only one. It is
   short and human-editable: a name if you want one, a few traits, and that it
   talks with a household. It uses descriptions rather than sample lines, and
   holds no facts about the users, which are memory's job. Keeping it brief is
   part of the point, because the less it says, the more of the model's own
   manner comes through. It can be empty to see a model's defaults, which is
   also worth doing once per model during the eval.
2. **`PERSONA_STYLE`** is the constraint layer. It covers only what the medium
   forces and is phrased as facts and limits, never as phrasings. Draft:

   > You are speaking, not writing: everything you say is read aloud.
   > Keep answers short, a few sentences at most. If a full answer would be
   > long, give the short version and offer to say more.
   > No lists, tables, headings, markdown, emoji or code.
   > Say numbers and symbols the way a person would say them.
   > What you receive comes from speech recognition. It can be misheard, cut
   > off, or background talk that was not meant for you. If a message is
   > garbled, a fragment, or does not make sense as a question or a statement,
   > do not guess; ask for clarification.
   > Several people may talk to you and you cannot tell who is speaking. Do not
   > assume; use a name only if the speaker says who they are.

   The two speech-specific rules are the part a small model is most likely to
   ignore, so they are the first things the eval checks (below). They say
   *when* to ask for clarification, not *how*. How it asks is the model's.

The same principle applies elsewhere. The persona sampler is the model's
vendor sampler from the roster, with no lower temperature for "safety",
because a flattened sampler flattens the personality too. The compaction
prompt defines the memory tiers but gives no example entries to imitate.
Memory and the sanitiser (Part 2) touch facts and formatting only, never
wording.

3. **Memory** — the contents of `memory.md`, under a line such as
   *"What you remember about the people you talk to:"*.

Because the memory is in the system prompt, it only changes at a compaction —
which rebuilds the context anyway — so between compactions every turn reuses
the cached prefix and llama-server only processes the new user message.

### Memory: three tiers, one file, written by compaction

No separate memory system. The compaction prompt asks the model to maintain
three tiers, and the plugin files the answer:

| tier | holds | lives in | lifetime |
|---|---|---|---|
| **Permanent** | near-invariant facts: names, who is who, relationships, where you live, lasting preferences, how they like to be spoken to | `memory.md` → system prompt | until corrected |
| **Ongoing** | things true for now: current projects, plans, upcoming events with dates, recent health/moods, open questions | `memory.md` → system prompt | model drops them when stale |
| **Recent** | the thread of the last conversation(s): what was just talked about, anything left hanging | pi's compaction summary (the message pi puts after the system prompt) | replaced every compaction |

The model decides what goes where. The prompt only defines the tiers, with no
example entries, so the model does not copy their wording into every memory. Permanent + Ongoing go to the memory file, Recent is what the
hook returns to pi as `compaction.summary` — so nothing is in the context twice.

**Compaction instruction (in-context), draft:**

> The conversation above is being cleared from your context. Write your memory
> of it now; you will keep only what you write here, plus the memory you
> already had (shown at the top). Rewrite all three parts in full.
>
> ## Permanent
> At most {P} words. Facts about the people you talk to that will almost never
> change: names, who is who, relationships, home, lasting likes and dislikes,
> how they want you to talk. Keep every earlier permanent fact unless you were
> told it is wrong.
>
> ## Ongoing
> At most {O} words. What is true for now but will change: plans, projects,
> upcoming events with their dates, how people are doing. Drop what is over or
> no longer true. Keep dates absolute.
>
> ## Recent
> At most {R} words. What you were just talking about, and anything left open.
>
> Short plain sentences, one fact per line. Say who a fact is about only when
> the conversation made that clear; the speaker is never identified
> automatically. Leave out anything that came from misheard or garbled
> messages.

Word limits come from the roster (`persona.memoryWords`, default e.g.
`{ permanent: 300, ongoing: 200, recent: 120 }`); at 10–14 tokens/s a full
three-tier rewrite is ~800 tokens ≈ one minute, which is why *when* it runs
matters (Part 2).

**Guards against a small model forgetting** — the real risk here is a 3–4B
model silently dropping a permanent fact during a rewrite, and then it is gone:

- **Versioned file.** Every write keeps the previous one as
  `memory-history/memory-<ts>.md`. Cheap, and it makes a lost fact recoverable
  by hand.
- **Shrink check.** If the new Permanent tier is under ~70 % of the old one's
  length, or a tier is missing/unparseable, the plugin keeps the old tier,
  logs it (`memory_rejected` in the session log), and still accepts the other
  tiers. Ongoing is allowed to shrink — that is its job.
- **Human-editable.** `memory.md` is plain markdown with the three headings;
  editing it takes effect at the next turn (the plugin re-reads it in
  `before_agent_start`, which is also where its hash goes into the session log,
  like the system prompt's today).

A tier parse failure never loses the conversation: if the Recent part is
missing, the whole reply becomes the pi summary, as today's fallbacks do.

**Memory is written only when a compaction is committed.** Compaction is
speculative and can be cancelled (Part 2), so `session_before_compact` must not
touch `memory.md`. It returns the parsed tiers in the compaction's `details`,
and pi stores them on the compaction entry. The plugin writes `memory.md` in
`session_compact`, which pi emits only after the entry has been appended; an
aborted compaction never reaches it. This was checked in pi 0.85.1's
`agent-session.js`: after the summary comes back it checks the abort signal and
throws `Compaction cancelled` before `appendCompaction`.

If the process dies between appending the entry and writing the file, the
session holds a newer memory than `memory.md`. At startup the plugin compares
the latest compaction entry's `details` with the file and rewrites the file
from the entry when the entry is newer. The session file is the record, and
`memory.md` is a readable copy of it.

**In-context vs. user message.** Today's in-context compaction smuggles the
instruction in as a synthetic `compact_context` tool result, to keep Qwen
templates from re-rendering earlier thinking. Persona mode runs with thinking
off by default, which removes the reason for the trick, and a plain user
message is the most natural thing for a conversational model to answer, so it
sends the instruction that way. The serialized fallback and pi's
own compaction stay as the second and third attempts.

### Time

Each user message is prefixed with a short timestamp, `[Sat 26 Sep 2026,
14:02]`, by the **plugin's `input` hook**, so a typed test chat gets it too. It
never goes in the system prompt. The model needs "now" for
Ongoing ("the dentist is on Tuesday" → a date) and to know that a conversation
resumed after a gap; putting it in the system prompt would change the prefix
every turn and throw away the prompt cache.

### Roster: a `persona` block

Per model, with a `defaults.persona` fallback, resolved like every other roster
field (`resolvePersona(spec, d)` in `lib/roster.ts`, checked by `check-roster.mjs`):

```json
"defaults": {
  "persona": {
    "model": "Qwen3.6-35B-A3B-Q4_K_M",
    "thinking": "off",
    "maxTokens": 300,
    "memoryWords": { "permanent": 300, "ongoing": 200, "recent": 120 }
  }
}
```

- `model` sets the persona's default model, and only the persona's (see
  "Model selection" above).
- `thinking: "off"` means no reasoning before a reply. At ~12 t/s every
  thought is silence before the first word. For Qwen3.6 it also selects the
  card's **instruct** sampler row, as `/sm-thinking off` does today (temp 0.7,
  top_p 0.8, top_k 20, presence 1.5). That is the vendor's own setting for
  this mode, so it fits the "no flattened sampler" rule. A model can opt back
  in with its own `persona.thinking`. It goes through the existing thinking
  machinery (`resolveThinking`), so the server is started in that mode and
  the `thinking` probe confirms no reasoning comes back.
- **Context is the model's own**: Qwen3.6's roster `ctx` is 32768, and its
  `--n-cpu-moe 35`, `--load-mode none` and batch settings are unchanged. At
  32k with a soft threshold of 60 %, roughly 19k tokens of conversation fit
  before the first speculative compaction, which is hours of speech.
- `maxTokens: 300` — a hard ceiling so a runaway answer cannot hold the
  speaker for a minute; the prompt keeps normal answers far below it. It is
  deliberately *not* the only length control: truncated speech sounds broken,
  so the server logs every `length` stop.
- The compaction call itself still gets its own cap (as today, from
  `reserveTokens`), not the 300.

`bin/sm-persona` seeds its pi home with `reserveTokens` from the same
`requiredReserveTokens(roster)` and a `keepRecentTokens` of ~1500: a handful of
verbatim exchanges survive each compaction, so the next reply after one does
not lose the thread.

## Part 2 — the server: `persona/server.mjs`

Plain Node, no dependencies, same style as `proxy.mjs`.

### Endpoints

    POST /v1/chat/completions   OpenAI-compatible, stream and non-stream
    GET  /v1/models             one entry: "sm-persona" (+ the served roster alias in metadata)
    GET  /health                200 once pi is up and the model is loaded (no key needed)
    GET  /persona/status        model, busy, compaction in progress, context use, follow-up listeners
    GET  /persona/events        Server-Sent Events: follow-up messages (see "Tools")
    GET  /persona/followups     the same, polled (?after=<seq>)
    POST /persona/compact       compact now, to completion
    POST /persona/shutdown      abort, stop pi (and so its llama-server), exit

Bound to `0.0.0.0:8130` (the STT server is elsewhere on the LAN), bearer key
required (`PERSONA_API_KEY`), and a Windows firewall rule for that port only.
llama-server stays on loopback.

### Request handling

1. Take the **last `user` message** from `messages`. Everything else in the
   request is ignored — the STT server's own system prompt, and any history it
   might send later — because pi's session is the history. (Logged once per
   distinct system prompt, so a change on the STT side is visible.)
2. No speaker label (the plugin adds the timestamp, see "Time"):
   the STT server cannot tell voices apart, and the persona is told not to
   assume who is talking. An empty or whitespace-only message never reaches
   the model. The server returns an empty reply, so there is silence and no
   audio, and leaves the session untouched. The server has no canned lines of
   its own. Every word the speaker plays comes from the model, so the
   personality stays in one place. Anything with words in it goes to the
   model, which decides whether it makes sense. Detecting nonsense is a
   language judgement, and a heuristic here would reject real short utterances
   like "yes" or "and?".
3. `model` in the request is ignored (logged). Switching models takes minutes;
   that stays a deliberate operator action (`/sm-model` via `/persona/…`, or a
   restart with `PI_SMALL_MODEL`).
4. Send `{"type":"prompt","message":…}` to pi; collect `text_delta`s from
   `message_update` until `agent_settled`.
5. **Sanitise** before returning: strip `<think>…</think>` leftovers, markdown
   emphasis/headings/bullets/table pipes, code fences, emoji. It only removes
   markup and never rewords, reorders or shortens. The prompt asks for plain
   speech, and this makes sure TTS never reads out an asterisk when a small
   model forgets. A reply that needed heavy stripping is logged, since that is
   a prompt-following signal for the eval.
6. Return a normal `chat.completion` (or SSE chunks) with the text and pi's
   usage numbers.

**Streaming** (`stream: true`) is worth supporting from day one: deltas are
buffered to **sentence boundaries** and sanitised per sentence, so a TTS that
consumes a stream can start speaking after the first sentence rather than after
the whole reply.

**One conversation, one queue.** Requests are serialised. A request that arrives
while one is generating waits (pi's `followUp` semantics), with a timeout
(`PERSONA_WAIT`, default 120 s) after which it gets a 503 — a voice assistant
answering a question from two minutes ago is worse than no answer.

### Tools, and replies that come later

The persona has tools (v1: `weather`), and a tool call must not hold up the
spoken reply. A request like "what's the weather tomorrow" should get an
immediate acknowledgement, and the answer as a **second message** when the
tool returns.

**In pi this is ordinary agent behaviour.** One assistant message can carry
text *and* a tool call. pi runs the tool and then calls the model again, and
that second assistant message is the follow-up. The style prompt adds one
constraint, and it is about behaviour, not wording: *call the tool in the
same reply, with a few words first saying what you are doing*. How it says
so is the model's. The rule has to say that the call itself belongs in the
reply: phrased only as "say what you are doing before the call", Qwen3.6
announced the check and ended its reply without calling in 6 of 8 weather
questions (2026-09-26), so no follow-up ever came.

**On the wire, plain OpenAI chat completions cannot do this.** One request
gets exactly one response, and nothing can be pushed afterwards. The server
therefore splits a turn:

1. **The HTTP response** carries the text of the *first* assistant message,
   the part before the tool call. It is sent as soon as that message ends, not
   when the agent settles. When more is coming, the response carries a
   non-standard `persona` field that OpenAI clients ignore:
   `{"followup": true, "turn": "t-42"}`.
   If the model called a tool without saying anything first, the server waits
   up to `PERSONA_FIRST_REPLY_WAIT` (default 8 s) for the result, so a fast
   tool still yields one complete reply. After that it returns an empty reply
   with `followup: true`, which means silence now and the answer later.
2. **Follow-ups** are every later assistant message's text, sanitised the
   same way. They are delivered through whichever of these the speech side
   uses:
   - `GET /persona/events`: a Server-Sent Events stream the speech client
     keeps open. Each event is a `chat.completion`-shaped object with
     `persona.turn` and `persona.kind: "followup"`. This is the recommended
     one. The STT/TTS side needs one listener that speaks whatever arrives.
   - `PERSONA_FOLLOWUP_URL`: a webhook. The server POSTs the same object
     there, for a client that cannot hold a connection open.
   - `GET /persona/followups?after=<id>`: polling, as a fallback and for
     debugging. The server keeps the last few follow-ups for a few minutes.
3. **Stale follow-ups are dropped**, not spoken. An answer that arrives more
   than `PERSONA_FOLLOWUP_TTL` (default 120 s) after its question is logged
   and discarded. Hearing about the weather five minutes later, unprompted,
   is worse than not hearing it.

**A new message while a tool is still running** is sent to pi as `steer`. pi
delivers it after the running tool finishes, before the next model call, so
the model sees the tool result and the new message together and answers
both, or whichever still matters. The HTTP response for that new message
follows the same rules as above.

**Speculative compaction** waits for the agent to settle, because a turn with
a tool in flight is not a quiet spell.

**Tools themselves** live in `lib/persona-tools.ts` and are listed per model
in the roster's persona block (`persona.tools`, default `["weather"]`). Each
tool has its own timeout (a slow network call becomes an error the model can
talk about), and returns short plain text written for the model to read, not
JSON. `weather` uses Open-Meteo, which needs no API key. It takes an optional
place name and falls back to the home location in
`$PI_SMALL_PERSONA_HOME/config.json`. With tools present, the `tool_calls`
probe runs again at start.

### When compaction runs

pi compacts when `contextTokens > contextWindow − reserveTokens`, and it checks
that **before a new user prompt**. That puts a compaction of about a minute
between someone asking and the answer. In persona mode compaction is
**asynchronous and speculative**. It never delays a reply, and it is committed
only when it finishes during a quiet spell.

**The loop, in the server:**

1. After every reply, read `get_session_stats`. If `contextUsage.percent` is at
   or above the **soft threshold** (`PERSONA_COMPACT_AT`, default 60 %), start a
   compaction with `{"type":"compact"}`. Do not wait for it.
2. **A request arrives while it runs:** send `{"type":"abort"}`. It returns once
   pi is idle. pi's `abort` cancels the compaction, and a cancelled compaction
   is never appended to the session (see Part 1). Then send the prompt as
   usual. Cancelling the in-flight llama-server request takes well under a
   second. The conversation prefix is still in the server's cache. Qwen3.6 is
   a hybrid model, though, so the server resumes from its last checkpoint
   rather than from any token. A cancelled compaction, and in fact every
   turn, may cost a re-processed micro-batch (see "Hybrid cache" below).
3. **After that reply,** step 1 runs again and the compaction restarts from
   scratch on the now-longer conversation. There is no partial result to
   resume, and none is needed.
4. **The compaction finishes before the next message:** pi appends it, emits
   `session_compact`, and the plugin writes `memory.md`. The server logs it and
   returns to step 1 on the next reply.

So a compaction lands only after a quiet spell long enough to finish one. At
10–14 tokens/s with an ~800-token three-tier rewrite, that is roughly a minute.
While people keep talking, every attempt is cancelled and the conversation
simply goes on growing.

**pi's own threshold is suppressed, apart from a hard backstop.** In persona
mode the plugin's `session_before_compact` cancels a `reason: "threshold"`
compaction unless the context is past the **hard threshold**: the point where
one more exchange, the persona `maxTokens` and pi's fixed 4096-token safety
margin would not fit. At Qwen3.6's 32k that is about 85 %. This builds on the
`compaction_deferred` check the hook already has. Manual compactions (the
server's) and `overflow` always go through. The hard threshold is the only
place a reply ever waits for a compaction. Getting from 60 % to 85 % takes
about 8k tokens, well over a hundred spoken exchanges, with no quiet minute
in between. The server logs it when it happens,
because it means the soft threshold is too high.

**Cancelled work is logged, not hidden.** Each attempt gets a line with its
outcome (`committed` / `cancelled after N s`) and how many tokens it generated
before being cancelled. A conversation that cancels a dozen attempts a day is
fine. One that reaches the hard threshold regularly means `PERSONA_COMPACT_AT`
should come down.

**Optional, off by default: a quiet-period save.** `PERSONA_IDLE_COMPACT=30m`
also starts a speculative compaction after that much silence, even below the
soft threshold. It gets memory written at the end of a conversation rather
than whenever the window fills. The cost is that each one throws away verbatim
turns early. Nothing is lost without it, because `--continue` keeps the
uncompacted conversation across restarts, so it stays off until the eval shows
memory lagging too far behind.

### Logging

The plugin's session log already records every response's tokens and wall
time. The server adds one JSONL line per request: arrival, queue wait, time to
first sentence, total time, chars in/out, whether sanitising changed anything,
stop reason. That is what "is this fast enough to talk to" will be decided on.

### Lifecycle on the laptop: an always-on service

Everything goes through one control script, `persona/ctl.sh`:

    persona/ctl.sh install      register the boot task (once)
    persona/ctl.sh start        start now (the same task, run on demand)
    persona/ctl.sh stop         stop cleanly; pi stops its llama-server, and the GPU is free
    persona/ctl.sh status       up / loading / stopped, the model, memory size
    persona/ctl.sh uninstall    remove the boot task

**Start at boot.** A scheduled task, `PersonaServer`, with `/sc onstart`,
running **as the user's own account** with its password stored (`/ru <user>
/rp`, which Windows calls "run whether user is logged on or not"). It has to
be that account, not SYSTEM. `pi` is a per-user npm global, and a different
account has a different profile, which is exactly the "different environment,
empty cache" trap `CLAUDE.md` warns about. `LLAMA_CACHE` is still sourced from
`llama-cache.env` by `persona/start.sh`, the task's target, which keeps `/tr`
short. `onstart` rather than `onlogon`, because the laptop should serve after a
reboot with nobody logged in. The password has to be typed once, on the
laptop, by you (`ctl.sh install` prompts for it). Two things to verify during
`install`:
- CUDA works from a non-interactive session on this GeForce driver. It usually
  does, but "the model loads over SSH" does not prove it.
- The weights are readable at boot. Qwen3.6 loads from `C:/models`, about 80 s
  at start-to-ready.

**Supervision.** `start.sh` runs `persona/server.mjs` in the foreground in a
restart loop (back off, give up after N crashes an hour, all logged to
`D:/persona/logs/`). The server in turn restarts its pi child if that dies. A
`D:/persona/stopped` flag file ends the loop, which is how `stop` makes it
stay down instead of bouncing back.

**Stopping for other GPU work** (a coding session on another model, a bench
run). `ctl.sh stop` writes the flag and calls `POST /persona/shutdown`. The
server aborts any generation or compaction in flight, and a cancelled
compaction is discarded, so memory stays consistent. It then closes pi's
stdin, so pi stops its llama-server through the plugin's normal
`session_shutdown`. As a last resort, after a timeout, it runs `taskkill /T` on
the pi process tree. `ctl.sh start` removes the flag and runs the task again.
`--continue` picks the conversation up where it was, after about 80 s of
loading. At start it refuses while `coding-bench/.bench-lock/` is held.
Nothing restarts the persona automatically when the other work finishes.


### Keeping the model in RAM while idle

Measured 2026-09-26: after a few quiet minutes, Windows had paged llama-server
out almost completely (working set 0 GiB of the ~18.5 GiB readable model;
the rest on the low-priority standby list and in the pagefile). The first
turn after a quiet spell then read its ~40 new tokens at 3-6 t/s instead of
11-13, and paging the whole model back in took **129 s**. Two causes:

- **Priority.** The scheduled task ran at Task Scheduler's default priority 7,
  so llama-server was below normal with memory priority 2. Its trimmed pages
  were the first to be reused. `ctl.sh install` now registers the task at
  priority 4 (normal).
- **Nothing touches the model between turns.** `persona/keepwarm.exe`
  (`keepwarm.cs`, built by `start.sh` with the .NET Framework's `csc`) reads
  through llama-server's private memory with `ReadProcessMemory`. That brings
  paged-out pages back into llama-server's working set and marks them recently
  used, without touching llama-server's state or its slot cache. It also sets
  llama-server's priority and memory priority to normal. The server runs it
  every `PERSONA_KEEPWARM` seconds (default 60; 0 = off) while no turn or
  compaction has run for that long. A pass takes ~3 s when the model is
  resident. With the model resident, ~1 GiB of RAM stays available.

The server log has a `keepwarm` line for every pass that had to page the model
back in (over 10 s, or the working set grew by over 1 GiB), and for one pass
in 60.

### Hybrid cache: measure before trusting the latency numbers

Qwen3.5-family models are hybrid, and llama.cpp can only resume a hybrid
model's state from **checkpoints**. The supervisor bake-off measured the
effect: *re-processes about one micro-batch per question even on a warm
cache* (`pi-small-supervisor-bakeoff-findings-20260923.md`). Qwen3.6 runs with
`-ub 2048` for prompt throughput. If every persona turn re-processes up to one
micro-batch, that could add up to ~20 s at ~100 t/s before the first word, and
it would dominate the latency. The coding sessions never noticed, because
their turns are minutes long. The first live test measures seconds to first
token for a short message on a warm context. If it shows up, the fix is a
per-model `persona.serverArgs` with a smaller `-ub`: the bake-off found
`-ub 128` made follow-ups ~3× cheaper.

## Future work: sharing the server with coding agents

*Parked 2026-09-26. Get a working persona first. What follows is the design
for later.* The idea: the persona and pi-small coding instances run on one
llama-server and one model, so the persona can delegate tasks to coding
agents without a model switch.

The persona would become a *client* instead of an owner. `bin/sm-persona`
would set `PI_SMALL_REMOTE=1` (the plugin never starts or stops llama-server),
`PI_SMALL_NO_SWITCH=1` (a new flag: it never asks the proxy for another model,
so a restarting persona cannot yank a model someone loaded for coding), and
`PI_SMALL_CLIENT=persona` (a new flag, sent as an `X-Pi-Small-Client` header).
The always-on component would be `proxy.mjs` on 8123. It already owns
llama-server on a loopback backend port, passes every OpenAI route through,
and switches models through `serve.mjs`. A coding session finds it and uses it
without any change. Five things would have to change for two kinds of client
to live on it at once.

### 1. One server, both thinking modes

Today a thinking-mode difference counts as a *different server*. `serve.mjs`
restarts on it, and the plugin's `attachRemote` asks the proxy to switch
whenever `proxy.thinking` differs from what it wants. With a persona (off) and
a coding client (on), each would keep restarting the other's server.

The shared server therefore always runs a moded model **thinking on**: no
`--reasoning-budget 0` on the command line, since that would take thinking
away from the coding clients. Each client picks its mode per request through
`chat_template_kwargs.enable_thinking`, which the plugin already sends on
every request. In the proxy, a mode request counts as satisfied when the
server is in `on` mode. `off` is then per-request, and the proxy's status
reports `thinking: "per-request"`. The persona's `thinking` probe (no
`reasoning_content` with thinking off) already runs at every attach, and is
what proves the per-request switch works on this template. The sampler works
the same way: the server's command line carries the thinking row, every
client injects its own, and the `sampler` probe's mismatch warning is
expected for the persona. It already says "injected per request, unaffected"
in remote mode.

### 2. Slots: one per kind of client

`buildServerArgs` hard-codes `--parallel 1`, and for good reason. Round 3 found
four default slots sharing one unified cache and forcing full re-prefills
(`coding-bench/round3-recommendation.md` §4.4). For sharing, the proxy's server
gets a roster field instead, `slots`, used only by the proxy: **2** (one for
the persona, one for coding) with `-c` = 2 × the per-slot context and **no
unified KV**. That gives each slot a fixed 32k of its own, so one client can
never evict the other's cache. The round-3 failure came from four slots
competing for a unified pool, which this layout rules out.

The proxy **pins clients to slots**. It reads `X-Pi-Small-Client` (the
plugin sends `PI_SMALL_CLIENT`; the persona sets it to `persona`, and
everything else counts as `coding`) and adds `id_slot` to the request body
before passing it on: slot 0 for the persona, slot 1 for coding. Without
pinning, llama-server picks a slot by prompt similarity, which is usually
right but not guaranteed. A wrong pick costs a full re-prefill: ~3 minutes
for 19k tokens at ~100 t/s, in the middle of a spoken reply. That
llama-server honours `id_slot` on `/v1/chat/completions` in build 10896 is
the second measurement below.

A second coding client (two containers at once) shares slot 1, and the two
evict each other's cache there. It stays correct but gets slow. More slots
are a later decision, sized by the measurement.

**Context competes for memory, not for the window.** Each slot has its own
32k, and pi's `contextWindow` for each client is the per-slot size reported by
`/props`. The cost is KV memory. Qwen3.6 is hybrid, so only its attention
layers carry a KV cache that grows with context, which should make a second
32k far cheaper than it would be on a dense model. Whether it fits at
`--n-cpu-moe 35` or needs 36+ is measurement one.

### 3. Priority for the persona

llama-server has no priorities: two active slots decode in one batch, and on
this machine, with the experts on the CPU, a batch of two costs close to two
tokens' worth of expert reads. So a coding generation in flight roughly halves
the persona's speed, from 3–6 s to maybe 6–12 s for a reply. It cannot be
paused mid-generation without breaking the coding session. What the proxy
*can* do cheaply is not start new coding work while a persona request is in
flight: a coding request that arrives then is held until the persona's reply
is done. An agent turn is minutes long anyway, so a few seconds' delay costs
nothing, and the persona gets the whole GPU for most replies. The logs record
whether each persona reply overlapped with a coding generation, so the real
slowdown gets measured rather than guessed.

The persona's speculative compactions are **not** prioritised. They run at
coding priority, because they are background work by design.

### 4. Model pinning, and pausing the persona

Today any client can `POST /pi-small/model` and switch the model. With a
persona living on the server, that would silently take the voice away.
The proxy gains a **pin**:

    POST /pi-small/pin     { alias, owner: "persona" }   refuse switches away from alias
    POST /pi-small/unpin   { owner }

A switch request for another model while pinned gets **409** with an
explanation: *pinned to Qwen3.6 by persona; `persona/ctl.sh release` frees
it*. The plugin surfaces this the way it surfaces "host control" hints today.
A coding session with no explicit `PI_SMALL_MODEL` should not trip over it,
so in remote mode behind a pinned proxy, the session's default becomes
**whatever is served** instead of the roster default. `pi-small-docker.sh`
then just works on the persona's model, and asking for a different one gives
the 409 message.

**Pausing.** `ctl.sh release` unpins. You can then switch the proxy to any
model for coding. While the served model is not the persona's, the persona
server answers **503 immediately** ("paused", with the served alias) rather
than letting requests hang in a queue, and a speech client can say so or stay
quiet. `ctl.sh resume` switches back to the persona's model and pins it again,
and the persona serves again as soon as the model is loaded (about 80 s for
Qwen3.6). `--continue` means the conversation has not gone anywhere. The
persona itself never switches models (`PI_SMALL_NO_SWITCH`), so nothing grabs
the GPU back on its own.

**A bench run is the one thing that cannot share.** `run-filter-bench.sh`
starts its own llama-server on 8123 at `--parallel 1` and must have the
whole card. It stays that way, since sharing would make its numbers
meaningless. `ctl.sh stop` takes everything down, the persona and then the
proxy with its llama-server. The proxy holds `D:/persona/.gpu-lock` while its
llama-server runs, and the bench launchers and `CLAUDE.md`'s "check first"
snippet refuse to start while the lock is held. The other way round, `ctl.sh
start` refuses while `coding-bench/.bench-lock/` is held.

### 5. The proxy's own lifecycle

Today the proxy exits and **leaves llama-server running**, deliberately, for
container experiments. As a service it needs a clean stop too: `ctl.sh stop`
calls a new `POST /pi-small/shutdown`, which stops the backend it started
(`serve.mjs --stop` on the backend port) and then exits.

### Measurements before building on this

On the laptop, with the proxy serving Qwen3.6 at `--parallel 2`, 2 × 32k:

1. **Does it fit**, at `--n-cpu-moe 35`, without the driver spilling into
   shared memory? The 2026-09-25 spill cut generation from 11.8 to 4.8 t/s.
   Check `nvidia-smi` and the speed, not just a clean load.
2. **Does `id_slot` pin**: two alternating conversations, each keeping its own
   cache (`cacheRead` in pi's usage, or the server log's slot lines).
3. **Per-turn cost on a warm persona slot**: seconds to first token for a
   30-token message after 5k, 15k and 25k tokens of conversation, at `-ub`
   2048 and 512.
4. **Interference**: persona reply time with slot 1 idle versus mid-generation.
5. **Thinking per request**: the persona's `thinking` probe passes on a
   thinking-on server.

The outcome decides `slots`, `-ub` and the context sizes. If 2 × 32k does not
fit, the persona slot can be smaller than coding's only with a unified KV
cache, and that brings the eviction problem back. The simpler fallback is
2 × 24k.

### Delegation, later

Once sharing works, delegation is a persona tool rather than new
infrastructure. The persona calls `delegate(task)`, and the persona server
starts a containerised pi-small coding instance (`pi-small-docker.sh -p
"<task>"`) on slot 1, with the same model and nothing loaded. It reports the
result back as a message in the conversation when the instance finishes. It
is left out of v1 because it adds the first tool, and with it the first
tool-call round trip, to a voice path. The design above deliberately leaves
room for it: the persona already talks to the proxy as a client, and coding
clients already run next to it.

## File layout

    pi-small/
      bin/sm-persona          entry point (new)
      lib/persona.ts          style, prompt assembly, compaction instruction, tier parser, memory guards (new)
      extensions/small.ts     PI_SMALL_MODE=persona branches in 5 hooks; /sm-persona
      lib/roster.ts           resolvePersona()
      roster.json             defaults.persona
      persona/
        DESIGN.md             this file
        persona.md            the persona's own description (editable)
        server.mjs            the OpenAI-compatible front end
        ctl.sh                install / start / stop / status / uninstall
        start.sh              the boot task's target: sources llama-cache.env, runs the server in a restart loop
        keepwarm.cs           keeps the model in RAM while idle (built by start.sh into keepwarm.exe)
      test/persona-test.ts    tier parsing, shrink guard, sanitiser, server ↔ stub pi round trip

    D:/persona/               PERSONA_HOME on the laptop, not in git
      memory.md
      memory-history/
      sessions/               pi session files (--continue)
      pi/                     the persona's own pi home (settings.json)
      logs/
      stopped                 present = stay down (ctl.sh stop)

## Choosing the model

**The default is Qwen3.6-35B-A3B-Q4_K_M, thinking off.** Its roster numbers
suggest a spoken reply is comfortably fast:

- ~12.7 t/s generation (measured 2026-09-26 at 32k, loading from C:). A typical
  spoken answer of 40–80 tokens takes 3–6 s. With sentence streaming, the
  first sentence reaches TTS in 1–2 s.
- Prompt processing is 91–106 t/s, and with the prefix cached a turn only
  processes the new message, a few dozen tokens. That assumes the hybrid
  cache resumes close to the end (see "Hybrid cache").
- The costs are an 80 s load (only at boot and after `ctl.sh start`) and most
  of the machine's RAM, which is fine for a machine whose main job this is.

The per-request log (time to first sentence) confirms or refutes those numbers
in the first days of use. The eval below still matters, but for a different
reason: not to pick a model, but to check that Qwen3.6 actually follows the
speech rules and keeps memory straight. It also gives a baseline for any
challenger. Sharing adds a new reason to look for one: a model that leaves
room for two or three full slots, and is fast enough when two decode at once,
makes delegation practical rather than merely possible.

**The eval.** The roster and the way to switch models are the same as for
coding; what differs is the yardstick. For coding the roster was graded on
finishing tasks. For this it is **latency to first sentence** and **whether
memory survives compaction**. A small eval fits the
existing `eval/` pattern: a scripted multi-day conversation (names, a plan with
a date, a preference, a correction) fed through the server with forced
compactions in between, then questions that only memory can answer. Mixed in
are garbled STT-style fragments ("the uh for tomorrow then if", background
talk) and turns that tempt the model to assume a speaker. Score: facts
recalled, facts wrongly kept after a correction, garbled inputs answered with
a clarification rather than a guess, speaker assumptions, markdown leaks, and
median seconds to first sentence. A second script interrupts compactions at
random points and checks that memory never shows a half-written state.

## Open questions

Settled 2026-09-26: Qwen3.6 with thinking off is the default model; the persona
runs as an always-on boot service and owns its server in v1. Sharing the
server with coding agents is future work. The STT server cannot identify speakers, so there are no
speaker labels and the persona is told not to assume. Background and misheard
speech does arrive, so the persona asks for clarification rather than guessing.
Compaction is speculative and cancellable, as above.

1. **Privacy of `D:/persona`.** It will accumulate personal facts on a laptop
   that also runs untrusted model code in Docker. The containers mount only
   their workspace, so it is not exposed, but it is worth stating as a rule.
2. **More tools.** v1 has `weather` to prove the path. Delegation to coding
   agents is future work. Each further tool is a new thing a small model can
   call wrongly on a voice path, so they get added one at a time, each with
   an eval case.
