# Qwen3.6 free-form: making it fast (2026-09-25/26)

**Result:** with the current defaults, Qwen3.6-35B-A3B finishes the books-api task free-form in
5–16.5 minutes (mean 9.7, all 28/28), and with thinking off in 4.4–7.9 minutes (mean 6.6,
27–28/28). Before tonight, run 2 was at 27/28 after 70 minutes and still working, and a
single compaction cost about 25 minutes.

The model gets no extra help. The changes are to serving, the harness, and the system and
compaction prompts, as agreed. All runs: books-api `prompt.md` as the only message, plain
pi-small session, graded by the hidden grader (28 checks). Scripts are in
`pi-small/workflow/freeform-bench/`.

## What changed, in order of effect

| change | commit | effect |
|---|---|---|
| `--n-cpu-moe 35` (was 32) | a4a79a0 | 32 overflowed the 6 GiB card (6022/6144 MiB), and the Windows driver silently spilled into system RAM. With 35: 5188 MiB, generation 4.8 → 11.8 t/s, prompt reading ~5 → ~60 t/s. The ~6 t/s prompt speed seen at 16k was the same spill, and it is why compactions took 25 minutes. |
| ctx 32768, `maxTokens` 8192 | 9efb72c | Run 3 died after 10 minutes: its first response was 4096 tokens of thinking with no answer. At 32k the task finishes without a single compaction. |
| `-b 2048 -ub 2048` | 8c830df | Prompt reading 62 → 97–104 t/s; generation unchanged within noise. |
| In-context compaction | 9efb72c | The summary is requested inside the session's own context (a synthetic tool call whose result is the instruction), so llama-server reuses its prompt cache. Test at 16k: **42 s** (cacheRead 6455, 451 new tokens), then 28/28 at 11.4 min. Before: ~23 min. Falls back to the serialized prompt, then to pi's own. |
| Compaction prompt | 44cc0a5, 00a66fe | Two parts, Lessons and Next steps, at most `compactionWords` (default 200) each. |
| Per-model compaction threshold | 9efb72c | pi uses one reserve for the whole roster (now 10240 because of Qwen's 8192); the plugin cancels threshold compactions until the served model's own threshold. |
| `SESSION_STYLE` | 3c6a2c5 | Terse, plus "change only the lines that need changing; write once, run, fix". Most of the output was full `app.py` rewrites (~2,000–2,700 tokens, ~4 min each, 2–3 per run), not thinking (8–14% of output). Mean 12.7 → 7.6 min. |
| bash runs commands from a file | 529fe24 | `pkill -f "python3 app.py"` in a `bash -c` command killed its own shell: the output vanished and the model floundered for 7–10 minutes (run 2, edit3-1). Confirmed in the Linux container: `bash -c` exits 143; from a file it survives. A real terminal works the same way, so this is fidelity, not help. |

## Batches (minutes to done; grade)

| batch | configuration | runs (min) | mean | grades |
|---|---|---|---|---|
| base32k | terse only | 14.7, 13.5, 9.9 (4th lost to a server crash) | 12.7 | 28, 27, 28 |
| style2 | + "do not rewrite whole files" | 11.2, 6.0, 7.2, 5.8 | 7.6 | 28 ×4 |
| edit3 | style2 + `edit` tool | 25.4*, 6.8, 5.2, 11.5 | 7.8 without * | 28, 28, 28, 27 |
| final | SESSION_STYLE + bash via file (current defaults) | 7.5, 5.0, 9.6, 16.5 | 9.7 | 28 ×4 |
| nothink | final, thinking **off** | 7.2†, 6.8, 7.9, 4.4 | 6.6 | 27, 28, 28, 28 |
| style4 | final, stronger "never rewrite" wording | 8.8, 11.2, 12.7, 10.7 | 10.9 | 27, 28, 27, 23 |

\* the `pkill` self-kill, before the fix. † includes 3.4 min of cold-server start; the model's
own work was ~3.8 min.

The spread within a batch comes mostly from whether the model rewrites `app.py` in full after
its first test. No prompt wording has stopped that reliably, and neither did the `edit` tool.
The stronger wording (style4) made runs slower and less accurate, so `SESSION_STYLE` stays at
the style2 text.

## What did not help

- **n-gram speculative decoding** (`ngram-simple`, `ngram-mod`, `ngram-cache`): at best +11% on
  a rewrite, and 20–60% slower on new text. The GGUF has no MTP layers, so `draft-mtp` is out.
- **`-t 4` vs `-t 8`, `--n-cpu-moe 34` vs 35:** equal within noise; 35 keeps more GPU headroom.

## Found and fixed on the laptop

- **llama-server crashed twice between runs.** Both times the System log had
  Resource-Exhaustion-Detector event 2004 (low virtual memory) at the same second. With
  `--load-mode none`, llama-server commits ~19.8 GB, and the system-managed pagefile was capped
  at ~14.8 GB (1/8 of the 119 GB C: drive; commit limit 38.5 GB). With your approval, the
  pagefile is now **16–24 GB**, applied live with no reboot. The batch runner also restarts a
  dead server.

## Open, for you to decide

1. **Thinking off for Qwen3.6 by default** (roster `"thinking": "off"`): 6.6 vs 9.7 minutes and
   much less spread, one 27/28 in four runs. The model card's default is thinking on.
2. **A fourth 8 GB RAM stick:** channel A has 16 GB, channel B 8 GB, so 8 GB runs
   single-channel. Generation speed here depends mostly on memory bandwidth.
3. **Models on the SSD:** they are on D:, a 7200 rpm hard disk, so each load takes 4–5 minutes.
   C: is too full for the 19 GB file next to the larger pagefile.
4. **Startup checks once per server:** each session spends 17–40 s on pi-small's template and
   sampler checks, 1.5–3.5 min on a freshly loaded server. Caching them per server would save
   that time, but it weakens a safety check.
5. **The `edit` tool:** no clear gain over the prompt alone. Not the default.

## Mistake

The GPU sat idle from 22:53 to 00:39 UTC: the queue ran out and I had not queued the next batch
or armed a monitor on the queue.
