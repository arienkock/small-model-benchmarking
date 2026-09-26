# Beyond-VRAM models on benchlaptop: setup and throughput findings (2026-09-22)

Investigates whether models too big for the 6 GiB GTX 970M alone — using system
RAM + VRAM together via llama.cpp's CPU/GPU hybrid offload — are viable for
agentic coding, and specifically whether ternary/BitNet-class CPU-optimized
models deliver on that promise on this hardware. Two models tested:
**Qwen3.6-35B-A3B** (Q4_K_M GGUF, MoE) and **Ternary Bonsai 2 27B** (PrismML,
ternary GGUF). Everything below happened directly on `benchlaptop`; no pi
harness, no coding-bench grading run.

The raw `llama-bench` / `llama-server` logs behind the sweeps (Qwen3.6, Qwen3.8,
Qwen3-Coder, Granite 4.2 30B) are in [`large-model-sweeps/`](large-model-sweeps/).

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

**Followed up in
[`pi-small-qwen3-coder-findings-20260922.md`](pi-small-qwen3-coder-findings-20260922.md):**
Qwen3-Coder-30B-A3B was put on the pi-small roster and run as a real agent. The
`llama-bench` numbers here do **not** transfer — a live agent session gets
~6 t/s generation and ~3 t/s prompt processing, because agent turns are small
batches and `pp512` exists precisely to amortise the per-batch cost away. That
document also records why **ctx 4096 cannot be used at all** under pi, which
matters because 4096 is the size this round validated.

Open follow-ups if this gets revisited: a finer `--n-cpu-moe` sweep around
28-36 to explain/exploit the 24-dip and pin down the true optimum with more
repeats (variance was ~20% here); whether Bonsai 2's PQ2_0 kernel benefits
from `-b`/`-ub` batch-size tuning; whether PrismML ships or plans an x86
AVX2 kernel for PTQ1_0 to match PQ2_0's.

## Update 2026-09-22: Granite 4.2 30B and Qwen3-Coder-30B-A3B

Two more candidates, picked to fill gaps the first round left open: a
genuinely **dense** model (Granite — no MoE trick available, tests plain
`-ngl` layer-split offload) and a **coding-specialized MoE sibling** of
Qwen3.6 (Qwen3-Coder, to see whether task-specific tuning beats the newer
general model on this hardware). Weights cached under `D:\models\` as
before. Downloads hit a genuinely bad stretch of home-network congestion
mid-run (general, non-HF-specific — verified with an independent Cloudflare
speed test) that dropped combined throughput to ~0.4 MB/s for a while; no
tooling fix for that, just waited it out, then a mesh-network AP switch on
the user's end brought speeds back up to 30-50 MB/s. Also caught and killed
one `llama-bench` process that hung (near-zero CPU/memory, no progress) after
a sibling config had already CUDA-OOM'd — not every stall in this stack
resolves itself.

### Granite 4.2 30B (dense, Q4_K_M, 16.50 GiB, 29.28B params)

Dense models don't get the MoE expert-offload trick — every token passes
through every layer regardless of where it lives, so the only lever is how
many whole layers sit on GPU vs. CPU. Swept `-ngl`:

| ngl | pp512 (t/s) | tg128 (t/s) | note |
|---:|---:|---:|---|
| 0 (CPU only) | 22.8-23.5 | 1.19-1.21 | |
| **10 (best)** | **23.9-24.0** | **1.18-1.19** | |
| 20 | 8.6-8.7 | 1.23-1.26 | pp512 collapses for a marginal tg gain |
| 30 | — | — | **CUDA OOM crash** (`ggml-cuda.cu:108: CUDA error`) |
| 40, 999 | — | — | also CUDA OOM |

The ceiling for this GPU with this model is between 20 and 30 layers before
it hard-crashes (not just slows down — an actual out-of-memory error).
Thread count (4 vs. 8) changes almost nothing at any `ngl` (generation stays
within 1.18-1.26 t/s across the board) — this workload is memory-bandwidth-
bound on the CPU side, not compute-bound, so more threads don't help once
you're waiting on RAM reads. **Best practical config: `-ngl 10 -t 8`**
(pp512 ≈ 24 t/s, tg128 ≈ 1.19 t/s) — `ngl 20`'s tg bump (+0.05-0.07 t/s) isn't
worth pp512 dropping by nearly 3x for agentic use, where prompt/context
ingestion speed matters too.

**Context headroom** (verbose-logged, not estimated): at `-ngl 10 -c 4096`,
weights split as 13.8 GiB CPU-resident / 2.7 GiB GPU-resident, KV cache
880 MiB CPU + 144 MiB GPU (~0.25 MiB/token), compute buffers ~257 MiB —
**~14.7 GiB of 24 GiB system RAM used**, leaving roughly 9 GiB of headroom
before OS overhead. That headroom is not free to spend carelessly, though:
a separate run at `-c 8192` (same `-ngl 10`) **collapsed to 0.0 tok/s
generation** (prompt processing also fell from ~24 to 2.9 t/s) — caught 372 MB
free system RAM during that run. The KV-cache math alone doesn't fully
explain a jump that large (8192 ctx should only add roughly 800 MB over the
4096 case), so this is likely a load-time memory spike rather than steady-
state pressure, but the empirical result stands: **treat 8192 context as
unsafe at `-ngl 10` on this machine until someone retests it directly** —
4096 is confirmed fine.

### Qwen3-Coder-30B-A3B-Instruct (MoE, Q4_K_M, 17.28 GiB, 30.53B total / ~3B active)

Same `--n-cpu-moe` sweep methodology as Qwen3.6. Full data (`-ngl 999`,
8 threads):

| n-cpu-moe | pp512 (t/s) | tg128 (t/s) |
|---:|---:|---:|
| 999 (all CPU) | 26.1 ± 4.4 | 5.76 ± 0.57 |
| 36 | 77.7 ± 0.3 | 12.59 ± 0.01 |
| **34 (best)** | **70.8 ± 1.3** | **12.83 ± 0.02** |
| 32 | 15.2 | 10.60 |
| 30 | 15.3 | 10.78 |
| 28 | 9.2 ± 5.6 (anomaly) | 7.60 ± 0.44 |
| 24 | 13.0 | 8.01 |
| 16 | 14.0 | 7.64 |
| 8 | 61.7 ± 4.7 | 7.24 |

Same non-monotonic pattern seen with Qwen3.6 (a dip at 28, here, rather than
24) — real measurements, not noise, but the underlying cause is still
unexplained. **`--n-cpu-moe 34` is the true joint optimum**: unlike Qwen3.6,
where the best generation speed (`ncmoe 32`) and best prompt speed
(`ncmoe 48`) landed at different settings, here one config wins on both
axes simultaneously. Thread sweep at `ncmoe 34`: t=8 gets pp512 ≈ 70-75 t/s
(t=4/6 collapse to ~20 t/s — a huge gap), while tg128 varies 10.4-12.8 t/s
across repeated runs at t=8 (same ~20% run-to-run variance documented for
Qwen3.6) — **t=8 is unambiguously correct** despite that tg noise, because
of the pp512 gap. **Best practical config: `-ngl 999 --n-cpu-moe 34 -t 8`**
(pp512 ≈ 71-78 t/s, tg128 ≈ 10-13 t/s).

**Context headroom**: at `ncmoe 34 -c 4096`, weights split as 12.02 GiB
CPU-resident / 5.63 GiB GPU-resident (VRAM is basically maxed — weights alone
are 5.63 GiB of the 6.0 GiB card), KV cache landed **entirely on GPU** this
time (384 MiB, no CPU KV buffer at all — different from Granite, where KV
split across both). System RAM footprint is much lighter than Granite's
(~12 GiB vs. ~14.7 GiB) because most of the "big" part of this model lives in
VRAM, not RAM — but that also means **headroom here is GPU-VRAM-constrained,
not RAM-constrained**: weights + KV + compute buffer (5.63 + 0.375 + 0.22 ≈
6.2 GiB) already exceeds the card's 6.0 GiB nominal capacity, surviving only
because the driver reports `VMM: yes` (unified/managed memory allowing
graceful oversubscription). Growing context further will eat into VRAM
first, not system RAM — untested how gracefully that degrades past 4096.

### Bonus: Qwen3.8-27B-UD-IQ4_XS (dense, 13.26 GiB, 27.32B params)

Added as a third candidate mid-session — this is the **same base model**
PrismML ternarized into Bonsai 2 27B, at a conventional IQ4_XS quant
instead, specifically to answer "does ternary compression actually win on
this hardware, or does a normal quant of the same base model beat it on
both speed and quality?" Same `-ngl` sweep approach as Granite:

| ngl | pp512 (t/s) | tg128 (t/s) | note |
|---:|---:|---:|---|
| 0 (CPU only) | 22.5 | 1.08 | |
| 10 | 25.9 | 1.22 | |
| **20 (best)** | **26.4** | **1.38-1.39** | good on both axes |
| 24 | 5.5 | 1.47 | pp512 collapses for a small tg gain, same pattern as Granite's ngl 20 |
| 26, 28, 30 | — | — | CUDA OOM |

Unlike Granite, this one improves *monotonically* from ngl 0→10→20 (smaller
per-layer footprint than Granite's 16.5 GiB total, so more layers fit
before VRAM contention kicks in) — no anomalous dip until right at the
OOM boundary. Thread sweep at `ngl 20` confirms t=8 best (tg128 1.38 vs.
1.24 at t=4). **Best practical config: `-ngl 20 -t 8`**
(pp512 ≈ 26.4 t/s, tg128 ≈ 1.38-1.39 t/s).

**Context headroom** at `ngl 20 -c 4096`: weights split 8.54 GiB CPU / 4.40
GiB GPU, KV cache 176 MiB CPU + 80 MiB GPU, compute buffers ~227 MiB —
**~8.74 GiB system RAM** and **~4.67 GiB VRAM** used. This is by far the
lightest footprint of the three models measured this round: **~15.3 GiB RAM
headroom and ~1.47 GiB VRAM headroom** left over, vs. Granite's tight ~9 GiB
RAM / near-zero VRAM slack or Qwen3-Coder's maxed VRAM. Smaller total size
buys real breathing room, not just at idle — this is the only one of the
three where both RAM and VRAM have comfortable slack simultaneously.

**Answering the original question**: at ~1.38 tok/s this normal-quant dense
version is meaningfully *slower* than Bonsai 2's ternary PQ2_0 CPU path
(~2.0 tok/s, see above) despite getting real GPU offload that Bonsai
categorically cannot use on this card. So for this specific base model on
this specific hardware, **ternary compression does win on speed** — the
~9x size reduction (13.26 GiB → 5.9-7.25 GiB) apparently matters more here
than "gets to use the GPU at all," because both are still fundamentally
bottlenecked by how much weight data has to move per token, and PQ2_0
simply has less of it to move. Neither is fast in absolute terms; both are
firmly behind the two MoE models.

### Updated bottom line across all five models tested

| model | type | best config | best tg128 (t/s) | headroom picture |
|---|---|---|---:|---|
| Qwen3-Coder-30B-A3B | MoE | `ncmoe 34 -t 8` | 10-13 | RAM-light (~12 GiB), VRAM-tight |
| Qwen3.6-35B-A3B | MoE | `ncmoe 32 -t 8` | 10-14 | not measured this precisely |
| Ternary Bonsai 2 27B | ternary | PQ2_0 CPU, `-t 8` | ~2.0 | not measured this precisely |
| Qwen3.8-27B (dense, same base as Bonsai) | dense | `ngl 20 -t 8` | ~1.38 | lightest footprint: ~15.3 GiB RAM + ~1.5 GiB VRAM headroom |
| Granite 4.2 30B | dense | `ngl 10 -t 8` | ~1.2 | RAM-heavy (~14.7 GiB), ~9 GiB headroom, unsafe past 4096 ctx |

The MoE models remain the clear winners for agentic coding on this hardware
— both land in the 10-14 tok/s range, roughly **7-10x faster than either
dense option**. The dense-model results confirm the theory from the first
round: without an MoE-style trick to keep most compute on a small
active-parameter subset, a ~27-30B-class model on a 6 GiB card is
bottlenecked by CPU RAM bandwidth for nearly its whole weight set, and no
amount of thread or `-ngl` tuning fixes that short of the GPU holding the
whole model (which this hardware cannot do at this size/quant) — Qwen3.8-27B
being smaller helps its headroom and lets it inch ahead of Granite on speed,
but it's still in the same tier, not a different one. Between the two MoE
options, Qwen3-Coder's 34-config is a genuine joint optimum (best pp *and*
tg together) while Qwen3.6's best pp and best tg configs disagree (`ncmoe
48` vs `32`) — worth keeping both configs handy depending on whether a given
task is prompt-heavy (large context ingestion) or generation-heavy.
