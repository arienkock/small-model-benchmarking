# Coding bench findings — 2026-09-11 runs (121228 + 122510)

## 0. Data quality: how much of this data is usable

The two concurrent runs interfered in three specific ways:

1. **Shared port 8123 + `kill_server` kills ALL llama-servers** (`taskkill //IM`).
   Each model switch or probe by one run killed the other run's model server mid-task.
2. **`run_one`'s hygiene step kills ALL pi agents** (`commandline like '%provider-extension%'`),
   which matches the *other* run's agent too. Both runs' pi agents died mid-generation
   whenever the other run's task finished — transcripts literally end mid-token-stream.
   Roughly half of all tasks were cut off this way; the two runs then ran in lockstep
   (identical task durations) because each task ended when the other's finished.
3. **Mislabeled model**: run 2's task 12 "LFM" (13:06–13:07:30) was actually served by
   run 1's MiniCPM server. Exclude it from LFM stats (it's a bonus MiniCPM data point).

Usable data:
- LFM: ~10 tasks with genuine LFM serving (several with kill noise at the tail);
  only run1-02 and run2-02 fully completed naturally.
- MiniCPM: only 3 genuine tasks (run1-01, run1-02, run2-01), 2 of which completed.
  Every other MiniCPM task hit a dead server (15s / 32-line transcripts) — no data.

## 1. What LFM2.5-2.6B struggled with

- **Never saw its own error messages → verification death-spirals.** Task 1 (todo app):
  server had a real bug (`todo_id_counter += 1` in `do_POST` without `global` →
  UnboundLocalError on every POST). The traceback went to `/tmp/server.log`, which the
  model then couldn't read back (it tried `read server.log` in cwd → ENOENT, and
  `D:\tmp\server.log` → ENOENT — MSYS /tmp ≠ Windows path). It burned ~20 tool calls
  re-checking GET (which worked) and re-POSTing, never once seeing the traceback that
  would have fixed it in one read.
- **Absolute-path hallucination, ~50% of all tool calls.** Invented variants:
  `/llama.cpp/...` (no drive), `/testbed`, `D:\tmp\server.log`, and — worst —
  **the run root instead of the workspace**: `shortener.ts`, `convert.ts`,
  `throttle.ts`, `parseToken.ts`, `public/` all ended up in
  `bench-coding-*/` instead of `NN-model/` workspaces. The grader sees "file never
  created" even when the content was correct.
- **Claims exceed deliverables.** Task 2: declared "The task is complete" with a
  working, verified server — but never created the required `shortener.ts` (it went
  to the run root). Task 10: "The files are present" with zero files created.
- **Node/ESM knowledge gaps**: `require.main === module` in an ESM `.ts` file
  (ReferenceError, shipped unfixed in task 5); extensionless ESM imports
  (`from './notes'` → ERR_MODULE_NOT_FOUND); `import { random } from 'crypto'`
  (no such named export).
- **Linux-isms**: `ss` (not in Git Bash), `ps aux | grep python` (Git Bash `ps` doesn't
  show native Windows processes — its background python was invisible, feeding the
  flailing), `/tmp` for logs.
- **Short bash timeouts**: passed `timeout: 3/5/10` to the bash tool, then got
  "Command timed out" while servers started/curl'd.
- Style: 65% of output tokens are thinking (235 msgs → 257k chars thinking vs 134k
  tool args, 5k text). Powerful for reasoning about the code itself, but the
  verification loop is where it drowns.

## 2. What MiniCPM5-2B struggled with

(Small sample — 2 completed tasks. Both were strong, though.)

- **Efficient, clean tool use**: task 1 in 6 calls — relative paths, `python3 server.py & echo $!`,
  curl POST+GET verified, `kill <pid>` cleanup. Correct server code on first write
  (todo app: verified POST returns the created todo; shortener: verified 302 redirect).
- **TS module-level bugs + incomplete self-verification**: `isValidCode` checks
  `code.length === makeCode.length` (function arity = 2, not 6) → returns false for
  valid codes. It verified the server endpoints but never tested the TS exports
  it was asked to deliver.
- **Bash command construction**: multiline commands mixing `&` with embedded newlines
  → `syntax error near unexpected token 'newline'`; one `/home/ubuntu` hallucination
  (recovered on its own after `cd` failed).
- Injection test (task 12, the mislabeled run): ignored the "forget the task"
  instruction and worked on the real task. One data point only.

## 3. Systemic tool-use hurdles (fixable, model-agnostic)

Ranked by observed cost:

1. **Log visibility** (cost LFM ~20 calls): background server output must land in
   the workspace where `read` can see it.
2. **Path discipline** (cost LFM files on nearly every task): bare filenames only;
   no /tmp, no invented absolute paths, no paths outside cwd.
3. **ESM rules** (cost LFM 3 distinct error classes): imports with explicit `.ts`
   extension, never `require`, correct builtin exports.
4. **Process management on Windows** (cost LFM many calls): `ps` can't see the
   background python; `ss` missing; `pkill` unreliable. `$!` + `kill <pid>` works.
5. **Bash timeouts**: server-start+curl needs 15–30s; model-chosen 3–10s fails.

## 4. Recommended fixes

### A. run-coding-bench.sh (correctness — do these regardless)
- Add a lock file (`exec 9> /tmp/coding-bench.lock; flock -n 9 || die`) — prevents
  this accident class entirely.
- Make all hygiene kills PID-scoped, never global patterns:
  - kill only the pi PIDs this run spawned (record `$!` of the `timeout` call),
  - kill only *this run's* llama-server (by recorded PID, not `//IM llama-server.exe`),
  - `kill_exercise_servers`: cover 8000 AND 8080 (models used both).

### B. append-system-prompt (removes hurdles for both models equally)
Suggested additions:
- "Reference every file by its bare name (e.g. python server.py, read server.py).
  Never use absolute paths; paths outside the working directory do not exist."
- "Background processes are invisible to `ps`. Start servers as
  `python3 server.py > server.log 2>&1 &` (log in the current directory!), keep the
  pid from `$!`, stop with `kill <pid>`."
- "When a request to your server fails or returns empty, the traceback is in the
  server's log file — read it before changing code."
- "TypeScript runs directly under Node 24: use `import`, never `require`; import
  local files with the explicit .ts extension (from './notes.ts'); use
  `import { randomUUID, randomInt } from 'node:crypto'` (there is no `random`)."
- "Use port 8000 for every exercise server. Give server-start + curl commands a
  timeout of at least 30 seconds."
- Note: `ss`/`pkill`/`/tmp` are unavailable — `netstat -ano` works if needed.

### C. Optional (harness normalizes, both models equally)
- Pre-seed each workspace with `package.json` `{"type":"module"}` and/or a
  tool-arg rewriting rule in the extension: any absolute path under the run root
  is remapped into the workspace. Removes LFM's biggest file-loss mode without
  giving either model extra knowledge.

## 5. Suggested next run
Re-run MiniCPM fully (only 2 usable tasks exist) and ideally re-run LFM's
tasks 1, 5, 6, 10 (killed mid-flight or with dead-server noise). With A+B in place,
single-run, the comparison should be clean.
