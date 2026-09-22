# Beyond-VRAM models on benchlaptop: setup and throughput findings (2026-09-22)

Investigates whether models too big for the 6 GiB GTX 970M alone — using system
RAM + VRAM together via llama.cpp's CPU/GPU hybrid offload — are viable for
agentic coding, and specifically whether ternary/BitNet-class CPU-optimized
models deliver on that promise on this hardware. Two models tested:
**Qwen3.6-35B-A3B** (Q4_K_M GGUF, MoE) and **Ternary Bonsai 2 27B** (PrismML,
ternary GGUF). Everything below happened directly on `benchlaptop`; no pi
harness, no coding-bench grading run.

## Hardware ceiling

- CPU: Intel i7-6820HK, 4 cores / 8 threads, AVX2 only (no AVX512), 2.7 GHz.
- RAM: 24 GiB total.
- GPU: NVIDIA GTX 970M, 6 GiB VRAM, **compute capability 5.2 (Maxwell)**.

## Setup performed

- Confirmed no bench run was active before touching anything (`.bench-lock`,
  `tasklist llama-server.exe`).
- Stock `D:\llama.cpp\llama-server.exe`/`llama-bench.exe` (build 10896,
  `0.4.0-dev`, commit `fa6769818`) already supports Qwen3.6's architecture —
  no rebuild needed for that model.
- **Ternary Bonsai 2 27B needs PrismML's own llama.cpp fork** — stock
  llama.cpp refuses PTQ1_0/PQ2_0 files outright. Built it from source:
  `git clone -b prism https://github.com/PrismML-Eng/llama.cpp D:/prismml-llama.cpp`,
  CPU-only (`-DGGML_CUDA=OFF -DGGML_NATIVE=ON`), using the VS 2022 Build Tools
  + CMake + Ninja that were already installed on the laptop (MSVC 14.44) — no
  new compiler toolchain needed.
- **CUDA is not viable for Bonsai on this GPU, full stop** — not just
  "not yet built." PrismML's own build script targets
  `CMAKE_CUDA_ARCHITECTURES=80;86;89;90(;100;120)` (Ampere and newer only,
  regardless of installed CUDA version), and their prebuilt Windows CUDA
  release targets CUDA 13.3 for the same architectures. The GTX 970M
  (Maxwell, sm_52) is architecturally excluded from their CUDA kernels. Separately,
  CUDA 13.0 (already installed on the laptop) dropped Maxwell support entirely,
  so even a from-scratch build against the system CUDA toolkit couldn't target
  this card — a CUDA 12.x toolkit would be needed just to compile for sm_52,
  and PrismML's kernels don't ship that target anyway. CPU is the only path
  for Bonsai here, which is at least the model's advertised design point.
- Installed **aria2c** (portable binary, `D:\tools\`) after discovering plain
  `curl -L -C -` was **silently discarding already-downloaded multi-GB chunks**
  on resume after HTTP/2 stream resets on this network — a real bug, caught by
  noticing downloaded file sizes going *backward* between checks (one curl
  attempt for Bonsai's PTQ1_0 file dropped from 5.27 GB back to 4.19 GB after
  a "successful" resume). Switching to `aria2c -x8 -s8` (8 parallel segmented
  connections, real per-segment resume) fixed this for both downloads.
- All weights and tools cached on `D:` (`D:\models\...`, `D:\tools\`,
  `D:\prismml-llama.cpp\`) — `C:` free space unchanged (33 GiB free before and
  after).

## Ternary Bonsai 2 27B results

- Ships two GGUF packings: **PTQ1_0** (5.93 GB, 1.75 bpw) and **PQ2_0**
  (7.25 GB, 2.13 bpw).
- Default context is huge (model advertises 262K tokens) and, left unset,
  drove RAM usage to ~17 GB resident with only 306 MB free system-wide —
  thrashing. **Always pass `-c` explicitly** (used 4096) for this model.
- **PTQ1_0 is effectively broken on x86 CPU**: source inspection
  (`ggml/src/ggml-cpu/`) shows only a generic/scalar reference kernel for
  PTQ1_0 on x86 (`ggml_vec_dot_ptq1_0_q8_0_generic`) — no vectorized path.
  Measured **0.1 tok/s** generation, ~91% CPU utilization across all 8 threads
  for that. Confirmed compute-bound, not a config/threading problem.
- **PQ2_0 has a real AVX2/AVX-VNNI-capable kernel**
  (`ggml_vec_dot_pq2_0_q8_K`, x86-specific, dated in-source "2026-09-18" — four
  days before this test), gated only on `__AVX2__` (VNNI absent just falls
  back to a plain-AVX2 emulation inside the same function, so this CPU's
  lack of AVX-VNNI doesn't disable it). Measured **~2.0 tok/s generation /
  3.7 tok/s prompt** at 8 threads (**1.6 / 2.7 at 4 threads** — 8 threads
  wins). **Use PQ2_0, not PTQ1_0, on this hardware.**
- Model itself loads correctly and produces coherent, on-topic completions
  (checked with a "write a Fibonacci function" prompt) — the slowness is a
  kernel-implementation gap, not a broken model or quant.

## Qwen3.6-35B-A3B (Q4_K_M, 19.0 GiB, 34.66B total / ~3B active) results

Swept `--n-cpu-moe` (how many layers' MoE experts stay on CPU vs. offload to
the 6 GiB GPU) from 999 (all-CPU) down to 8, `-ngl 999`, 8 threads,
`llama-bench -p 512 -n 128 -r 2`:

| n-cpu-moe | pp512 (t/s) | tg128 (t/s) |
|---:|---:|---:|
| 999 (baseline, all CPU) | 16.6 ± 7.2 | 6.85 ± 0.60 |
| 48 | 76.8 ± 2.8 | 12.74 ± 0.11 |
| **32 (best found)** | **86.6 ± 1.7** | **13.58 ± 0.02** |
| 24 | 4.4 ± 1.0 (anomaly) | 6.58 ± 0.28 |
| 16 | 19.0 ± 5.8 | 4.57 ± 0.78 |
| 8 | 44.7 ± 10.1 | 5.26 ± 0.02 |

The 24/16/8 dips are real measurements, not typos — the relationship isn't
monotonic, plausibly VRAM-fit/tensor-placement effects at those specific
boundaries. **`--n-cpu-moe 32` is the sweet spot found**: roughly 2x the
generation throughput of dumping every expert on CPU.

Thread sweep at the `n-cpu-moe 32` sweet spot: 4 threads = 9.89 tok/s,
6 threads = 10.89 tok/s, 8 threads = 10.54 tok/s (6 and 8 tie; 4 is worse).
Re-running the exact same `-ncmoe 32 -t 8` config in this second sweep gave
10.54 tok/s vs. 13.58 tok/s in the first sweep — **~20% run-to-run variance
observed**, so treat throughput as a range (**~10-14 tok/s generation,
50-90 tok/s prompt processing**), not a single number.

CPU-only baseline (`-ngl 0`) was much worse than expected for a 3B-active
MoE — 0.3-0.4 tok/s — almost certainly because the 19 GiB file leaves very
little RAM headroom (24 GiB total) for OS page cache once the process's own
working set is added, causing disk-bound stalls as different experts get
paged in per token. This is resolved by GPU offload (see above), not a
CPU-thread fix.

## Bottom line

For agentic coding on this specific laptop, **Qwen3.6-35B-A3B at
`-ngl 999 --n-cpu-moe 32` (~10-14 tok/s) beats Ternary Bonsai 2 27B's best
CPU-only path (PQ2_0, ~2 tok/s) by 5-7x**, despite Bonsai being the
"CPU-optimized" architecture on paper. The reason is GPU offload, not raw
efficiency: Qwen3.6's hybrid split puts its compute-heavy shared/attention
layers on the GPU and only routes small (~3B active) expert weights through
CPU, while Bonsai gets zero GPU acceleration on this Maxwell card (PrismML's
CUDA kernels categorically exclude it) and 27B-class CPU-only ternary
inference, even with a properly vectorized AVX2 kernel (PQ2_0), isn't fast
enough on a 4-core/8-thread 2015-era CPU to compete.

Open follow-ups if this gets revisited: a finer `--n-cpu-moe` sweep around
28-36 to explain/exploit the 24-dip and pin down the true optimum with more
repeats (variance was ~20% here); whether Bonsai 2's PQ2_0 kernel benefits
from `-b`/`-ub` batch-size tuning; whether PrismML ships or plans an x86
AVX2 kernel for PTQ1_0 to match PQ2_0's.
