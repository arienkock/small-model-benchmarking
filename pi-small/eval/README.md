# eval/ — measuring what a pi-small session actually did

Tools used to produce the 2026-09-22/23 findings reports in the repo root. They
read what the run left behind (workspaces, pi's session records, llama-server
logs); none of them talks to a model. The one exception is `preflight.sh`,
which runs on the serving machine *before* a round.

| tool | answers |
|---|---|
| `preflight.sh <alias>...` | Does this model start, serve the roster's sampler and thinking mode, run fast enough to finish, and emit real tool calls? Run it before committing hours to a model. |
| `timings.mjs [--session <jsonl>] <llama log>` | What did the session cost server-side: prompt and generation totals and rates, the prompt share of compute, and a per-request table. `--session` isolates one session on a server that served several. |
| `session-shape.mjs [--run <regex>] <workspace>...` | How much work was done: assistant messages, tool calls, and how many calls *executed* the thing under test, plus thinking volume. |
| `dump-session.mjs <workspace> [chars]` | The session as readable turns: calls, results, text. Use it to check a model's claim against what it actually ran. |
| `grade-wordfreq.py <workspace>...` | Grades the word-frequency task by running the script on a fixed corpus of its own. Checks count-first vs word-first, line count, ordering and case. |
| `bench-grade.sh <task> <label>=<workspace>...` | Grades pi-small workspaces with `coding-bench/grade-run.sh`, unchanged, so the results are comparable to the 3-4B rounds (task 1 = debounce). |

A workspace is a pi-small `--ws` directory. The container's HOME is the
workspace, so pi's session record is under
`.home/.pi/agent/sessions/--workspace--/`, and the plugin's own session log
(settings, effective system-prompt hash, per-response cost) is under
`.home/.pi-small/`.

## Traps these tools already handle, so they are not rediscovered

- **llama-server log stamps are total minutes.seconds.ms.µs.** `85.05.014`
  means 85 minutes, not 85 hours, and the fields are not zero-padded. Compare
  them as numbers. A hand-split that read them as hours put a session boundary
  several requests off.
- **A heredoc that writes a script is not a run of it.** A Python script's
  shebang says `python3` and its usage line usually names the file, so a naive
  "command mentions python and wordfreq.py" count also counts the write.
  `session-shape.mjs` strips heredoc bodies first. The naive count overstated
  five of seven runs in the first report.
- **Grade by execution, never by what the model said.** The failure these
  rounds are about is a model reporting success while its own output
  contradicts the spec.
- **The prompt the models got is in `coding-bench/prompts-filter.txt`**, split
  on `===PROMPT===`. Read it from there rather than retyping it. Shell command
  substitution drops the trailing newline, and nothing else differs.
