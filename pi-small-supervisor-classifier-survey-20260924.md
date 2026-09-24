# Appendix: how others use classifiers and small models inside agent harnesses

2026-09-24. A reading list for the next time we pick up the supervisor idea. It belongs to
[`pi-small-supervisor-bakeoff-findings-20260923.md`](pi-small-supervisor-bakeoff-findings-20260923.md),
where small judges (MiniCPM5-2B readout, Kev-0.8B, Laya) could not tell a failing 3B coding
session from a passing one in any way that would justify a capsule. The follow-up
(`pi-small/eval/supervisor/simple.py`) tried five very simple between-turn checks with Kev on a
four-turn window and also failed: loop AUROC 0.63, repeated error 0.50, and the three
"agent claims X" checks had no real cases in 1,911 turns while firing on 8–83% of them.

**How this was gathered.** Web search, then the primary text of every source cited (arXiv
PDFs extracted to text; model cards and the Anthropic post fetched directly). Numbers below are
copied from those texts. The first fetch-tool summary of one paper invented a "2–5M-parameter
detector at 85–90% accuracy" that appears nowhere in it, so no number here comes from a
summary. Most sources are 2026 arXiv preprints and are not peer reviewed. Vendor glossary and
SEO pages that turned up in searches are left out.

## What the field does, in six patterns

### 1. Rules first; a model only for what the rules cannot settle

This is the most consistent pattern, and it matches what our follow-up found for loops and
repeated errors.

- **CARE** (shell-command verification for coding agents) canonicalizes each command, derives
  deterministic evidence (syntax, command semantics, path context, known risk patterns) and
  "escalates only underdetermined cases to an LLM judge". 85.6% F1 at a 0.91% false-positive
  rate and 2.3 ms mean latency; the static-only profile keeps 85.0% F1 at 0.34 ms. [2607.21642]
- **AgentTrust** intercepts every tool call with a shell deobfuscator, rules, an order-aware
  session tracker for multi-step chains (read `.env` → base64 → `curl -X POST`), and an LLM
  judge only for ambiguous inputs. The rules alone reach 95.0% verdict accuracy. [2605.04785]
- **Real-Time Detection and Repair of LLM Agent Failures** is the closest study to ours
  (agents on Qwen2.5-3B/7B and Llama-3.1-8B, among others). Its statistical monitors transfer
  "only weakly" to organic failures and rank them "at/below chance without recalibration". A
  trivial *completion check* caught 7 of 7 silent aborts. Deterministic verification
  (recompute the stated total from the tool results actually received, confirm every required
  call was made, check each result against its tool's contract) caught 60% of failures (96%
  with the coverage check) at **0 of 63 false positives**, against the monitor's 54% at 17%.
  The authors also note that "the models rarely invent": 9 hallucinations in 175 organic
  episodes. That echoes our zero positives for "claims success after an error". [2608.02464]
- **LlamaFirewall** (Meta, used in production) pairs its model-based scanners with CodeShield,
  a Semgrep/regex static analyser, and custom regex scanners. [2505.03574]

### 2. Two-stage gates that deliberately see less

**Claude Code auto mode** is the deployed example, and several of its design choices bear
directly on our capsule design ([Anthropic engineering post]):

- Stage 1 is a single-token yes/no filter "tuned to cautious"; only what it flags goes to
  stage 2, which reasons step by step.
- The classifier sees user messages and the agent's tool calls. The agent's own text and all
  tool outputs are stripped: the first "so the agent can't talk the classifier into making a
  bad call", the second as "the primary prompt-injection defense". A separate probe scans tool
  outputs for injection attempts.
- It judges *actions*, not whether the code is correct. Reads and search are allowlisted, and
  in-project file edits skip the classifier entirely.
- A denial comes back to the agent as a tool result telling it to find a safer path. After 3
  consecutive or 20 total denials the session stops and escalates to the human. That is the
  same role our `maxFires` played.
- Reported: 0.4% FPR on 10,000 real actions; 17% FNR on 52 real overeager actions; 5.7% FNR
  on 1,000 synthetic exfiltration attempts.
- An independent stress test on deliberately ambiguous DevOps tasks measured 81.0%
  end-to-end FNR. 36.8% of state-changing actions were in-project file edits that the
  classifier never sees, and on the actions it did see, FNR was 70.3% at 31.9% FPR.
  [2604.04978]

The stage-1 filter is a large model, not an SLM. What transfers to us is the shape: a cheap
first stage, a narrow input, judging actions rather than correctness, the denial returned as a
tool result, and a hard cap before a human is pulled in.

### 3. Probing the agent's own hidden states instead of asking a second model

This is the strongest new lead. Several groups find that the acting model's own activations
already encode "this is going to fail", often before it generates anything, and a linear
probe reads that out for next to nothing. Our judges had to infer failure from the rendered
transcript and could not.

- **Doomed from the Start**: linear probes on activations "predict eventual task failure from
  the first interaction round", earlier than monitors that watch behaviour. Tested on
  Llama-3.2-3B, Qwen3-1.7B and Qwen-2.5-7B, all in our size class. "Behavior-only monitoring is
  consistently weaker, and adding behavioral features to hidden-state probes provides no
  further gain." Used for early abort, it saves 42–60% of tokens at 90–95% recall of eventually
  successful episodes. [2607.06503]
- **Code correctness is linearly decodable before generation**: for Qwen3-4B-Instruct on 444
  LiveCodeBench tasks, a probe on the final prompt token predicts whether its first-attempt
  code will be correct with AUC 0.88. That is still 0.84 after controlling for prompt length,
  against 0.66 for prompt length alone. [2606.14530]
- **PRISMS** detects three tool-use failures (unnecessary calls, missing calls, invalid
  arguments) from 1–128 MLP neurons, including in Qwen3-1.7B and Qwen3-4B. Over- and
  under-calling reach AUC 0.98–1.00 before generation; invalid arguments 0.86–0.90 from the
  generated call. The same neurons steer behaviour when risk is predicted. [2608.00218]
- **Calls are coming from inside the model**: across 18 models from 1B to 70B on BFCL, most
  probes reach AUROC > 0.80 for tool-call errors, including plausible-but-wrong argument values
  that logging would not catch. Probes work better on larger models (about +0.06 AUROC at 70B
  versus about 8B) and generalize to unseen error types. [2608.27750]
- **When2Tool / Probe&Prefill**: whether a tool call is needed is decodable at AUROC 0.89–0.96,
  "substantially exceeding the model's own verbalized reasoning". The probe's verdict is acted
  on by prefilling a steering sentence, which is essentially a capsule. [2605.09252]
- **SWE-Pruner Pro** uses the same idea for context: a small head on the coding agent's own
  representations labels each line of tool output keep or prune. [2607.18213]

**For us:** we already have 129 graded runs with run-level labels and the exact prompts. The
blocker is plumbing. pi-small serves through `llama-server`, and a probe needs intermediate
layer activations. Collecting training data would probably mean replaying the transcripts
through the same GGUF with a tool that can dump activations, or through `transformers`. 129
runs is small for a probe; Doomed from the Start discusses the sample complexity of
certifying one.

### 4. Narrow, fine-tuned small models beat general ones zero-shot

- **Squeez**: Qwen3.5-2B fine-tuned with LoRA for task-conditioned tool-output pruning reaches
  0.86 recall / 0.80 F1 while removing 92% of tokens. That is 11 recall points above zero-shot
  Qwen3.5-35B-A3B. [2604.04979]
- **ToolRM**: outcome reward models for tool calls from 1.7B to 14B. With best-of-n they give
  up to 25% gains, largest for small generators. [2509.11963]
- **Granite Guardian 3.1 2B** has a `function_call` risk: "function calls that have syntax or
  semantic errors based on the user query and available tool". Its model-card AUCs are
  0.65–0.82 across BFCL splits, APIGen and ToolACE. The output is a yes/no token with a
  probability, the same readout we used. [Granite Guardian card]
- **Prompt Guard 2** (86M, and a 22M variant) detects injection and jailbreaks inside
  LlamaFirewall. [2505.03574]

Contrast with our run: Kev and Laya are general decision models, and Kev's README describes
training on tickets, policy rules and consumer-finance complaints, not agent transcripts. We
used them zero-shot on a domain they never saw. Kev ships its training code, and its question
API accepts `criteria` descriptions for what "true" and "false" mean for a yes/no (`noul`)
question, which we never used. Kev's served probabilities carry a fitted temperature of about
2.1–2.4. That explains why our scores sat around 0.4 and a 0.8 threshold fired almost nothing:
`KEV_TEMPERATURE=1.0` gives the raw logits. [Kev README]

### 5. Escalate to a stronger model instead of injecting a capsule

- **R2V-Agent**: a distilled SLM acts, a lightweight process verifier scores candidate
  actions, and a calibrated step-level router hands individual steps to a stronger model only
  when the residual failure risk warrants it. 93.3% TerminalBench success at 33.9% LLM calls;
  94.3% HumanEval+ with 0.6% escalation. The authors argue routing before execution is brittle
  because difficulty shifts mid-trajectory. [2605.16604]
- **SWE-RM** (a 30B-A3B outcome reward model for SWE agents) finds that two verifiers with the
  same best-of-n selection accuracy can behave very differently in RL. Classification accuracy
  and **calibration** are what separate them. That is the same distinction we hit between our
  AUROC (ranking) and fire rates (calibration). [2512.21919]
- The NVIDIA position paper *Small Language Models are the Future of Agentic AI* argues for
  heterogeneous systems: SLMs for the repetitive narrow invocations, larger models where
  general ability is needed. [2506.02153]

### 6. Known weaknesses of LLM judges

- **Reliability without Validity** (21 judges, about 541,000 judgments): test–retest
  reliability above 0.95 coexists with position bias above 0.10 in two production judges, and
  exact-match agreement overstates discrimination by 33–41 points of Cohen's κ. Our 6–17%
  order-flip rates are the same effect at small scale. [2606.19544]
- **AgentProcessBench** (8,509 human step labels on tool-use trajectories): telling neutral
  steps from erroneous ones "remains a significant challenge" even for current large models,
  and weaker agents look better step by step because they stop early. [2603.14465]

## How our results line up

| we found | the literature |
|---|---|
| Judges answer every question with one impression of the session (halo 0.81–0.98) | Behaviour-only monitors are weaker than internal probes; judges show position bias despite high test–retest reliability |
| No judge caught "self-test passes, logic wrong" | Neither does anyone's behaviour monitor. Deterministic grounding checks and pre-generation correctness probes are the proposed answers |
| Loop and repeated-error checks work as rules, not with Kev | Rules-first with escalation (CARE, AgentTrust, completion and coverage checks) |
| "Claims success after an error" never happens in 1,911 turns | "The models rarely invent": 9 in 175 organic episodes |
| Kev's scores clustered near 0.4 | Kev serves temperature-scaled probabilities (T ≈ 2.1–2.4) |
| Capsules fired 5–10 times per session | Claude Code returns denials as tool results and stops after 3 in a row or 20 in total |

## Ideas for next time, most promising first

1. **Mechanical checks with zero false positives**:
   - exact repeated tool call;
   - the same normalized error line twice;
   - a tool result with `isError` set, followed by a message claiming the change was made;
   - a completion check that every file the task names exists and every verification command
     it names was run.

   These are cheap, and the literature's best false-positive numbers come from exactly this
   kind of check.
2. **Probe the 3B itself.** Label: did the run pass (we have 129). Feature: its hidden state at
   the end of turn k. A useful first question is whether "doomed" is readable at turn 1–2, as it
   was for Llama-3.2-3B in *Doomed from the Start*. The prerequisite is a way to dump layer
   activations for our GGUF models.
3. **Token-level uncertainty from llama-server `logprobs`** as extra telemetry. It costs
   nothing at serving time, and the detection-and-repair paper uses it as a monitor channel.
4. **If a model judge at all, make it narrow and fine-tuned:**
   - one question;
   - the input restricted to user messages plus tool calls;
   - a single-token first stage;
   - trained on our transcripts, which Kev's training code allows;
   - raw logits, calibrated on our own data.
5. **Escalate instead of nudging.** When a check fires, hand the step to a bigger model, as in
   R2V, rather than injecting advice the 3B may not be able to act on.

## Other ways small models appear in harnesses (not supervision)

- **Context pruning of tool output**: Squeez, SWE-Pruner Pro. [2604.04979], [2607.18213]
- **Speculative actions**: a cheap model predicts the next tool call so it can be launched
  early, and the main model confirms it. [2607.25816]
- **Prompt compression and complexity routing** for SLM-first frameworks (EffGen, ICML 2026):
  prompt optimization helps 1.5B models more (+11.2%); routing helps 32B more. [2602.00887]

Morph advertises an inline agent-trace classifier ("Reflex") with sub-90 ms latency over 64k
tokens. The page returned HTTP 429 and could not be checked, so treat that as an unverified
vendor claim.

## Sources

- [2607.21642] CARE: Pre-Execution Command Verification for Shell-Executing LLM Agents — https://arxiv.org/abs/2607.21642
- [2605.04785] AgentTrust: Runtime Safety Evaluation and Interception for AI Agent Tool Use — https://arxiv.org/abs/2605.04785
- [2608.02464] Real-Time Detection and Repair of LLM Agent Failures — https://arxiv.org/abs/2608.02464
- [2505.03574] LlamaFirewall: An open source guardrail system for building secure AI agents — https://arxiv.org/abs/2505.03574
- [Anthropic engineering post] How we built Claude Code auto mode — https://www.anthropic.com/engineering/claude-code-auto-mode
- [2604.04978] Measuring the Permission Gate: A Stress-Test Evaluation of Claude Code's Auto Mode — https://arxiv.org/abs/2604.04978
- [2607.06503] Doomed from the Start: Early Abort of LLM Agent Episodes via a Recall-Controlled Probe Cascade — https://arxiv.org/abs/2607.06503
- [2606.14530] Code Correctness Is Linearly Decodable from LLM Hidden States Before Generation — https://arxiv.org/abs/2606.14530
- [2608.00218] A Few Neurons Reveal When LLMs Misuse Tools (PRISMS) — https://arxiv.org/abs/2608.00218
- [2608.27750] The Calls are Coming from Inside the Model: Probe-based Detection of Tool-Calling Errors — https://arxiv.org/abs/2608.27750
- [2605.09252] LLM Agents Already Know When to Call Tools – Even Without Reasoning — https://arxiv.org/abs/2605.09252
- [2607.18213] SWE-Pruner Pro: The Coder LLM Already Knows What to Prune — https://arxiv.org/abs/2607.18213
- [2604.04979] Squeez: Task-Conditioned Tool-Output Pruning for Coding Agents — https://arxiv.org/abs/2604.04979
- [2509.11963] ToolRM: Outcome Reward Models for Tool-Calling Large Language Models — https://arxiv.org/abs/2509.11963
- [Granite Guardian card] ibm-granite/granite-guardian-3.1-2b — https://huggingface.co/ibm-granite/granite-guardian-3.1-2b
- [Kev README] jaredpalmer/kev — https://github.com/jaredpalmer/kev
- [2605.16604] R2V Agent: Teaching SLMs When to Ask for Help — https://arxiv.org/abs/2605.16604
- [2512.21919] SWE-RM: Execution-free Feedback for Software Engineering Agents — https://arxiv.org/abs/2512.21919
- [2506.02153] Small Language Models are the Future of Agentic AI — https://arxiv.org/abs/2506.02153
- [2606.19544] Reliability without Validity: A Systematic, Large-Scale Evaluation of LLM-as-a-Judge — https://arxiv.org/abs/2606.19544
- [2603.14465] AgentProcessBench: Diagnosing Step-Level Process Quality in Tool-Using Agents — https://arxiv.org/abs/2603.14465
- [2607.25816] Speculate While You Reason: Teaching Agents to Predict Their Next Tool Call — https://arxiv.org/abs/2607.25816
- [2602.00887] EffGen: Enabling Small Language Models as Capable Autonomous Agents — https://arxiv.org/abs/2602.00887
