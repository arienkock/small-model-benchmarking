# Benchmark target machine

Benchmarks do **not** run on this machine. They run on a Windows 10 laptop reachable over SSH
as the host alias `benchlaptop` (defined in `~/.ssh/config`; see the global agent notes for the
host's quirks). Everything below is about the benchmark repo itself.

- Repo lives at **`/d/llama.cpp`** on that host. `llama-server.exe` and the GPU are there;
  the pi agent runs in Docker and reaches the server via `host.docker.internal`.
- Pull result dirs back with:
  ```bash
  ssh benchlaptop "cd /d/llama.cpp/coding-bench && tar czf - bench-filter-<ts>" | tar xzf - -C .
  ```

## Pushing code without the GitHub round trip

`git push bench master` once these are set (not yet configured):

```bash
# on this machine
git remote add bench ssh://benchlaptop/d/llama.cpp
# on the laptop, once
ssh benchlaptop 'cd /d/llama.cpp && git config receive.denyCurrentBranch updateInstead'
```

`origin` (GitHub) stays the backup remote.

## Before running anything

A run holds `coding-bench/.bench-lock/` and pins ~6.5 GB of VRAM for hours.
**Check first; do not start a second run or kill `llama-server.exe` if one is active:**

```bash
ssh benchlaptop 'cat /d/llama.cpp/coding-bench/.bench-lock/info 2>/dev/null; tasklist //FI "IMAGENAME eq llama-server.exe"'
```

Long runs take 8-10 h and must survive disconnect:

```bash
ssh benchlaptop 'cd /d/llama.cpp/coding-bench && nohup ./run-filter-bench.sh > bench-run.log 2>&1 &'
```

If the run dies with the SSH session, use `schtasks /create /sc once` instead.
