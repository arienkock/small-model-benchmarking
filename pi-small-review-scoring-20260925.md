# Review experiment scoring — 2026-09-25

The workspace reviewed is `workflow-runs/overnight-5/ws` (books-api, T1 and T2 done, grader 24/28).
Each session reviewed it only; no fixing. The prompts are `lib/review.ts` `REVIEW_VARIANTS`.

- **review-1:** Granite and LFM, with no wrap-up message and no continuation. Its Spark and MiniCPM sessions never submitted and are superseded by review-2.
- **review-2:** Spark and MiniCPM, commit `ff13de2`: the wrap-up message at the turn or time limit plus one continuation session. Spark's `reasoningBudget` is 512.

Granite and LFM were not re-run under the new mechanism. Granite always submitted within
2 turns, so it would not have changed much. LFM always submitted, usually with 0 findings,
so no continuation would have been triggered.

## The defects in the workspace (the answer key)

I checked each one by reading `app.py` and running `workflow/checks/http_fuzz.py`.

| id | defect | where | found by the fuzzer |
|---|---|---|---|
| D1 | a non-integer id in the path: GET returns 404 where the spec says 400; PUT/DELETE crash in `int()` (also on `/books`, `/booksx`, `/books/`) | `:76`, `:174`, `:196` | the crash yes, GET's 404 no (needs the spec) |
| D2 | the `q` filter reads `b['q']` → `KeyError` | `:122` | yes |
| D3 | missing required field → `None.strip()` crash | `:43` | yes |
| D4 | wrong-typed required field → `.strip()` crash (POST and PUT) | `:43`, `:170` | yes |
| D5 | `synopsis` is never type-checked: `null`/`123` stored and returned with 2xx (the spec says 400) | `:42`, `:163` | no (no crash; needs the spec) |
| S1 | `?id=abc` → `int()` crash | `:112` | yes |
| S2 | the "missing required field" branch is unreachable | `:49-51` | yes (coverage) |
| (minor) | a non-numeric `Content-Length` header → `int()` crash | `:20`, `:145` | no (it does not fuzz headers) |

D5 was first found by Spark, in its `all` session.

## Per session

✓ = found, ~ = partly or with the wrong mechanism.
"wrong" counts findings that are false or that mis-describe the code; "noise" counts findings that are true but of no value.

| model | variant | submitted | D1 | D2 | D3 | D4 | D5 | S1 | other real | wrong | noise |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Granite | completeness | 5 |  | ✓ |  |  |  |  |  | 3 | 1 |
| Granite | correctness | 4 |  | ✓ |  |  |  |  |  | 2 | 2 |
| Granite | fidelity | 2 |  | ✓ |  |  |  |  |  | 1 |  |
| Granite | all | 3 | ✓ (GET) | ✓ |  |  |  |  |  |  | 1 |
| LFM | completeness | 0 |  |  |  |  |  |  |  |  |  |
| LFM | correctness | 2 | ~ (PUT/DELETE crash, expects 404) |  |  |  |  |  |  | 1 |  |
| LFM | fidelity | 0 |  |  |  |  |  |  |  |  |  |
| LFM | all | 0 |  |  |  |  |  |  |  |  |  |
| Spark | completeness | — (8 turns, 912 s) |  |  |  |  |  |  |  |  |  |
| Spark | correctness (+cont.) | 3 |  |  | ✓ | ✓ |  |  | Content-Length | 1 |  |
| Spark | fidelity | — (10 turns) |  |  |  |  |  |  |  |  |  |
| Spark | all | 4 | ~ (hedged) |  | ✓ | ✓ | ✓ |  |  |  | 1 |
| MiniCPM | completeness (+cont.) | 6 | ✓ (GET, PUT, DELETE) | ✓ |  | ✓ | ~ |  |  |  |  |
| MiniCPM | correctness | — (5 turns, 557 s) |  |  |  |  |  |  |  |  |  |
| MiniCPM | fidelity (+cont.) | 4 | ✓ (GET, PUT, DELETE) | ✓ |  | ✓ |  |  |  |  |  |
| MiniCPM | all (+cont.) | 7 | ✓ (GET; DELETE mis-described) |  | ✓ | ✓ | ✓ |  |  | 1 | 2 |

Notes on the scoring:
- **Granite's wrong findings:**
  - "books not sorted by id" (append order is id order);
  - "AND logic broken";
  - "`break` stops later filters";
  - "query validation insufficient";
  - "ids get reused" (`next_id` only goes up).
- **LFM's wrong finding:** "errors don't distinguish 400/404".
- **Spark's wrong finding:** it says PUT handles fields correctly, but it crashes on wrong types.
- **MiniCPM `all`, wrong:** it says PUT does not check for empty fields, but it does. Its noise: an "empty-body check is redundant" nit and "isbn is checked twice".
- **MiniCPM `completeness`:** its "fields aren't validated to be strings" is generic. I credited D4 and gave D5 only partial (~) credit.
- **The `+cont.` rows:** each continuation's final list includes the first session's findings where they still hold.

## By model (union of its sessions)

| model | defects found | submissions | wrong findings |
|---|---|---|---|
| Granite 3B | D1 (GET), D2 | 4/4, ~2 turns each | 6 |
| LFM 2.6B | D1 (partly) | 4/4, three of them empty | 1 |
| Spark 4B | D3, D4, D5, Content-Length (D1 hedged) | 2/4 | 1 |
| MiniCPM 2B | D1 (all three methods), D2, D3, D4, D5 | 3/4 | 1 |

Across all 16 sessions, nobody found S1 (`id=abc`) or S2 (the unreachable branch). The fuzzer finds both.

## Takeaways

1. **The wrap-up message and continuation helped a lot.** Spark and MiniCPM went from 0/8
   submissions to 5/8. MiniCPM's continuations submitted within 3 turns each, because the
   findings carried forward gave them a head start.
2. **MiniCPM is the best reviewer here**, as long as it gets a continuation. It found five of
   the six spec-level defects and had very few wrong findings. Spark found fewer, but was the
   only model to find D5 on its own and the header crash. Granite is fast but shallow: it
   always finds `q` and adds wrong claims.
3. **The `all` prompt did best** for Granite, Spark and MiniCPM. It found the most defects
   (D1/D3/D4/D5 between them) and was the only prompt with no wrong findings from Granite.
   `correctness` did worst: MiniCPM never submitted on it, and Granite's version had 2 wrong
   findings out of 4.
4. **Reviewers and the fuzzer cover different things.** The fuzzer finds every crash (D2, D3,
   D4, S1, the PUT/DELETE `int()`) and the dead branch in 6 s, with no model. Reviewers are
   needed for the spec-level defects (D1's 404, D5), which no crash oracle can see. For the
   fix loop: run the fuzzer first, then give reviewers the fuzzer's output and ask for
   spec-level findings only.
