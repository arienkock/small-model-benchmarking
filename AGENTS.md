# Benchmark target machine

Benchmarks do **not** run on this machine. They run on a Windows 10 laptop reachable over SSH
as the host alias `benchlaptop` (defined in `~/.ssh/config`; see the global agent notes for the
host's quirks). Everything below is about the benchmark repo itself.

- Repo lives at **`/d/llama.cpp`** on that host. `llama-server.exe` and the GPU are there;
  the pi agent runs in Docker and reaches the server via `host.docker.internal`.

## Before running anything

A run holds `coding-bench/.bench-lock/` and occupies essentially the whole GPU for hours (the
card is 6144 MiB / ~6 GiB total; the host itself has ~24 GiB of system RAM).
**Check first; do not start a second run or kill `llama-server.exe` if one is active:**

```bash
ssh benchlaptop 'cat /d/llama.cpp/coding-bench/.bench-lock/info 2>/dev/null; tasklist //FI "IMAGENAME eq llama-server.exe"'
```

## Starting a long run

Runs take 8-10 h and must outlive the SSH session. **Do not use `nohup ... &`** — Windows sshd
tears down the process tree on disconnect and the run dies silently hours later. Launch it as a
scheduled task instead, which is detached from the session:

```bash
ssh benchlaptop 'schtasks //create //tn BenchRun //sc once //st 00:00 //f //tr "\"C:\Program Files\Git\bin\bash.exe\" -lc \"cd /d/llama.cpp/coding-bench && ./run-filter-bench.sh > bench-run.log 2>&1\""
schtasks //run //tn BenchRun'
```

The `/ST is earlier than current time` warning at create time is expected and harmless — `/run`
starts it immediately. Clean up afterwards with `schtasks //delete //tn BenchRun //f`. Then poll:

```bash
ssh benchlaptop 'tail -20 /d/llama.cpp/coding-bench/bench-run.log'
```

## Fetching results

Result dirs are untracked in the laptop's repo, so git is no help — stream them over SSH. This is
read-only and safe to do while a run is in progress:

```bash
ssh benchlaptop 'cd /d/llama.cpp/coding-bench && tar czf - --warning=no-file-changed bench-filter-<ts>' | tar xzf - -C .
```

`--warning=no-file-changed` is required for a live run; without it tar exits non-zero as soon as
the harness writes to a file it is reading. The newest run dir is a snapshot of work in progress —
its `transcript.jsonl` may end in a torn line.

## Pushing code without the GitHub round trip

`git push bench master` once these are set (not yet configured):

```bash
# on this machine
git remote add bench ssh://benchlaptop/d/llama.cpp
# on the laptop, once
ssh benchlaptop 'cd /d/llama.cpp && git config receive.denyCurrentBranch updateInstead'
```

`origin` (GitHub) stays the backup remote.
