/**
 * serve-test.ts — drives serve.mjs, the HOST half, against the stub server.
 *
 *   node test/serve-test.ts
 *
 * plugin-test.ts covers the context ladder inside the pi process. This covers
 * the same ladder in serve.mjs, which is the one the CONTAINER path actually
 * depends on: with pi-small-docker.sh, the plugin runs in remote mode and never
 * starts anything — serve.mjs picks the context, and if it gets that wrong the
 * session either dies or silently attaches to the wrong window. The two
 * implementations are separate processes and cannot share a call stack, so the
 * only thing keeping them honest is testing both.
 */

import assert from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildServerArgs, compareProps, quoteForCmdShell, requiredReserveTokens, resolveSampler, resolveToolOptions, thinkingKwargs, validateSpec } from "../lib/roster.ts";
import { buildTool } from "../lib/tools.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVE = resolve(HERE, "..", "serve.mjs");
const PORT = 8198;
const LOGS = mkdtempSync(join(tmpdir(), "pi-small-serve-test-"));

// Same .cmd shim rationale as plugin-test.ts: a shebang script is not a
// Windows-executable file.
const stubServerPath = resolve(HERE, "stub-server.mjs");
let stubBin = stubServerPath;
if (process.platform === "win32") {
	stubBin = join(LOGS, "stub-server.cmd");
	writeFileSync(stubBin, `@echo off\r\nnode "${stubServerPath}" %*\r\n`);
}

const baseEnv = {
	...process.env,
	PI_SMALL_LLAMA_BIN: stubBin,
	PI_SMALL_PORT: String(PORT),
	PI_SMALL_LOG_DIR: LOGS,
	PI_SMALL_START_TIMEOUT: "30",
};

function serve(args: string[], extraEnv: Record<string, string> = {}) {
	return spawnSync(process.execPath, [SERVE, ...args], {
		env: { ...baseEnv, ...extraEnv },
		encoding: "utf8",
	});
}

const passed: string[] = [];
const pass = (what: string) => {
	passed.push(what);
	console.log(`PASS  ${what}`);
};

function stopServer() {
	serve(["--stop"]);
}

// Preflight. Every server serve.mjs starts is detached on purpose, so it
// outlives the launcher — including a test run that is killed partway through
// (an ssh session being torn down on the bench laptop does exactly that). The
// leftover then answers on the port and the first case below fails as
// "already serving ... nothing to do", which says nothing about what broke.
// --stop clears the normal case; anything else needs a human, because refusing
// to kill a server it did not start is the one safety property serve.mjs has.
const leftover = serve(["--status"]).stdout.trim();
if (!/^nothing serving/.test(leftover)) {
	serve(["--stop"]);
	const after = serve(["--status"]).stdout.trim();
	assert.ok(
		/^nothing serving/.test(after),
		`port ${PORT} is busy and serve.mjs will not free it (${after}). ` +
			`A previous run leaked a detached server; kill it by hand before re-running.`,
	);
}

try {
	// --- the happy path: no fallback, and the ladder does not get in the way --
	let r = serve(["Spark-X2.5-4B-Q6_K", "--ctx", "8192", "--host", "127.0.0.1"]);
	assert.equal(r.status, 0, `expected a clean start, got status ${r.status}: ${r.stderr}`);
	assert.ok(/ready: Spark-X2\.5-4B-Q6_K/.test(r.stdout), `expected a ready line, got: ${r.stdout}`);
	assert.ok(!/fell back/.test(r.stdout), `nothing should have fallen back: ${r.stdout}`);
	assert.ok(/ctx 8192/.test(r.stdout), `expected the requested ctx to be served: ${r.stdout}`);
	stopServer();
	pass("serve.mjs starts a model at the requested context when it fits");

	// --- adopting an existing server checks the CONTEXT, not just the alias ---
	// A leftover at a smaller window is still the wrong server, and because pi
	// clamps max_tokens against whatever window it finds rather than erroring,
	// silently adopting one produces a session that answers with a single token
	// and looks like a bad model rather than a stale process.
	r = serve(["Spark-X2.5-4B-Q6_K", "--ctx", "8192", "--host", "127.0.0.1"]);
	assert.equal(r.status, 0, `setup start failed: ${r.stderr}`);
	r = serve(["Spark-X2.5-4B-Q6_K", "--ctx", "8192", "--host", "127.0.0.1"]);
	assert.ok(/nothing to do/.test(r.stdout), `same size should be adopted as-is: ${r.stdout}`);
	r = serve(["Spark-X2.5-4B-Q6_K", "--ctx", "12288", "--host", "127.0.0.1"]);
	assert.equal(r.status, 0, `expected a restart at the larger size, got ${r.status}: ${r.stderr}`);
	assert.ok(/restarting/.test(r.stdout), `expected it to say it was restarting: ${r.stdout}`);
	assert.ok(/ctx 12288/.test(r.stdout), `expected the larger window to be served: ${r.stdout}`);
	stopServer();
	pass("an existing server at a smaller context is restarted, not silently adopted");

	// --- the ladder: the requested size OOMs, a smaller candidate does not ----
	// 16384 and 12288 "OOM", 8192 "fits" — the roster's default candidate list.
	const ladderStart = Date.now();
	r = serve(["Nanbeige4.2-3B-Q6_K", "--host", "127.0.0.1"], { PI_SMALL_STUB_CRASH_ABOVE_CTX: "8192" });
	const ladderElapsedMs = Date.now() - ladderStart;
	assert.equal(r.status, 0, `expected the fallback to succeed, got status ${r.status}: ${r.stderr}`);
	assert.ok(/ctx 8192/.test(r.stdout), `expected it to settle at 8192, got: ${r.stdout}`);
	assert.ok(/fell back/.test(r.stdout), `expected the ready line to say it fell back, got: ${r.stdout}`);
	assert.ok(
		/likely out of GPU memory/.test(r.stderr),
		`expected the failed candidates to be explained, got: ${r.stderr}`,
	);
	assert.ok(
		ladderElapsedMs < 25_000,
		`two failed candidates must fail FAST via the isAlive short-circuit, not wait out ` +
			`PI_SMALL_START_TIMEOUT each; took ${ladderElapsedMs}ms`,
	);
	stopServer();
	pass("serve.mjs falls back through ctxCandidates when the requested context does not fit, quickly");

	// --- nothing fits: give up cleanly, leave nothing running -----------------
	const giveUpStart = Date.now();
	r = serve(["Granite-4.2-3B-Q8_0", "--host", "127.0.0.1"], { PI_SMALL_STUB_CRASH_ABOVE_CTX: "0" });
	const giveUpElapsedMs = Date.now() - giveUpStart;
	assert.equal(r.status, 1, `expected a non-zero exit when nothing fits, got ${r.status}: ${r.stdout}`);
	assert.ok(
		/did not come up at any of ctx/.test(r.stderr),
		`expected a give-up message naming the ladder, got: ${r.stderr}`,
	);
	assert.ok(giveUpElapsedMs < 35_000, `all four candidates failing must still fail fast; took ${giveUpElapsedMs}ms`);
	assert.equal(serve(["--status"]).stdout.trim(), `nothing serving on port ${PORT}`, "nothing left half-started");
	pass("serve.mjs gives up cleanly when no candidate fits, leaving nothing running");

	// Both remaining cases go through a roster COPY rather than the real one.
	// Qwen3-Coder's weights are a 17 GiB file that exists on the bench laptop and
	// nowhere else, and neither of these checks is about that file — one needs a
	// path that resolves, the other a path that does not. Reading the answer off
	// whichever machine happens to be running the test would make both
	// assertions accidents of geography.
	const roster = JSON.parse(readFileSync(resolve(HERE, "..", "roster.json"), "utf8"));
	const qwen = roster.models.find((m: any) => m.alias === "Qwen3-Coder-30B-A3B-Q4_K_M");
	assert.ok(qwen, "the roster must still carry Qwen3-Coder for these checks to mean anything");
	assert.equal(qwen.repo, "local", "its weights are a manual download, not an -hf repo");

	// The dead rung. pi's clampMaxTokensToContext subtracts a fixed
	// CONTEXT_SAFETY_TOKENS = 4096 and floors the result at MIN_MAX_TOKENS = 1,
	// so a 4096 window makes every request come back as a single token with
	// finish_reason "length" — observed twice against this exact model on
	// 2026-09-22, and reproduced with curl showing the SERVER was fine. Offering
	// 4096 as a fallback therefore trades a server that will not start for a
	// session that silently does nothing, which is worse.
	assert.ok(
		!roster.defaults.ctxCandidates.includes(4096),
		`the default ladder must not fall back to 4096 — pi cannot use it: ${roster.defaults.ctxCandidates}`,
	);
	// It deliberately carries NO ctx/ctxCandidates override any more: 8192,
	// 16384 and 32768 were measured at the same throughput on 2026-09-22 (the
	// card is oversubscribed via VMM either way), so the roster defaults are
	// simply correct for it.
	assert.equal(qwen.ctx, undefined, "no ctx override — the roster default 16384 is measured-good");
	assert.equal(qwen.ctxCandidates, undefined, "no ladder override — the default ladder is entirely above pi's floor");
	assert.ok(
		roster.defaults.ctxCandidates.every((c: number) => c > 4096),
		`every rung must clear pi's 4096 margin: ${roster.defaults.ctxCandidates}`,
	);

	// --- a model whose weights are missing fails fast and readably ------------
	// `repo: "local"` exists precisely so a wrong path cannot turn into a 17 GiB
	// -hf re-download: it has to fail, and say why.
	const missingRoster = join(LOGS, "roster-missing.json");
	qwen.file = join(LOGS, "definitely-not-here.gguf");
	writeFileSync(missingRoster, JSON.stringify(roster));

	r = serve(["Qwen3-Coder-30B-A3B-Q4_K_M", "--host", "127.0.0.1"], { PI_SMALL_ROSTER: missingRoster });
	assert.equal(r.status, 1, `a missing local file must exit non-zero, got ${r.status}: ${r.stdout}`);
	assert.ok(
		/repo is "local" but no file matched/.test(r.stderr),
		`expected a readable missing-weights error rather than a stack trace, got: ${r.stderr}`,
	);
	assert.ok(!/at buildServerArgs/.test(r.stderr), `must not surface as an unhandled throw: ${r.stderr}`);
	assert.ok(!/waiting for the model to load/.test(r.stdout), `must not start anything: ${r.stdout}`);
	pass("a `local` model whose weights are missing fails fast, without starting anything");

	// --- a model's roster sampler reaches the server command line -------------
	// Three of Qwen3-Coder's four sampler values coincide with llama.cpp's own
	// defaults if left unset, so "it looks right" is not evidence that the model
	// card was honoured. Check the actual argv.
	const samplerRoster = join(LOGS, "roster-sampler.json");
	const argsLog = join(LOGS, "stub-args.json");
	qwen.file = stubServerPath;
	writeFileSync(samplerRoster, JSON.stringify(roster));
	r = serve(["Qwen3-Coder-30B-A3B-Q4_K_M", "--host", "127.0.0.1"], {
		PI_SMALL_ROSTER: samplerRoster,
		PI_SMALL_STUB_ARGS_LOG: argsLog,
	});
	assert.equal(r.status, 0, `sampler start failed: ${r.stderr}`);
	const argv: string[] = JSON.parse(readFileSync(argsLog, "utf8")).argv;
	const flag = (name: string) => argv[argv.indexOf(name) + 1];
	assert.ok(argv.includes("--repeat-penalty"), `--repeat-penalty must be passed at all: ${argv.join(" ")}`);
	assert.ok(argv.includes("--min-p"), `--min-p must be passed at all: ${argv.join(" ")}`);
	assert.ok(argv.includes("--presence-penalty"), `--presence-penalty must be passed at all: ${argv.join(" ")}`);
	assert.equal(Number(flag("--temp")), 0.7, "temperature from Qwen's generation_config.json");
	assert.equal(Number(flag("--top-p")), 0.8, "top_p 0.8, NOT llama.cpp's 0.95 default");
	assert.equal(Number(flag("--top-k")), 20, "top_k 20, NOT llama.cpp's 40 default");
	assert.equal(Number(flag("--repeat-penalty")), 1.05, "repetition_penalty 1.05, NOT the 1.0 default");
	assert.equal(Number(flag("--min-p")), 0, "min_p 0 per Qwen3 guidance, NOT llama.cpp's 0.05 default");
	assert.equal(Number(flag("--presence-penalty")), 0, "presence_penalty 0 — Qwen3-Coder's card asks for none, unlike Qwen3.6/3.8");
	stopServer();
	pass("a model's roster sampler reaches llama-server, overriding llama.cpp's defaults");

	// --- every model carries an explicit sampler, not an inherited one --------
	// The whole point of the audit: a value that happens to equal the engine
	// default is indistinguishable from one nobody chose. Apertus is the one
	// documented exception — swiss-ai's repo is gated, so its card could not be
	// read — and it has to stay a deliberate, visible exception.
	// A model with thinking modes states it once per mode (samplers.thinking /
	// samplers.instruct); everything else states it flat.
	const SAMPLER_KEYS = ["temp", "topP", "topK", "repeatPenalty", "minP", "presencePenalty"];
	const states = (m: any) =>
		m.thinking
			? ["thinking", "instruct"].every((row) => SAMPLER_KEYS.every((k) => k in (m.samplers?.[row] ?? {}) || k in m))
			: SAMPLER_KEYS.every((k) => k in m);
	const unset = roster.models
		.filter((m: any) => m.alias !== "Apertus-4B-Instruct-v1.1-Q8_0")
		.filter((m: any) => !states(m))
		.map((m: any) => m.alias);
	assert.deepEqual(unset, [], `these models inherit their sampler instead of stating it: ${unset.join(", ")}`);
	const problems = roster.models.flatMap(validateSpec);
	assert.deepEqual(problems, [], `roster config problems: ${problems.join("; ")}`);
	pass("every roster model but the gated one states its sampler explicitly, per mode where it has modes");

	// --- a per-model ngl REPLACES defaults.ngl, and appears once --------------
	// The dense beyond-VRAM models have no --n-cpu-moe lever: -ngl is their only
	// split, the working value is a measured number, and one layer too many is a
	// CUDA OOM at load rather than a slowdown. Put in serverArgs it would land on
	// the command line as a SECOND -ngl after defaults.ngl (999), leaving
	// llama.cpp's last-one-wins parsing as the only thing deciding which applies.
	// A synthetic spec, not a roster one: this must assert the same on the Mac,
	// where no `local` weights resolve.
	const denseSampler = { temp: 1, topP: 0.95, topK: 50, repeatPenalty: 1, minP: 0, presencePenalty: 0 };
	const denseArgs = buildServerArgs(
		{ alias: "dense", repo: "org/repo", file: "w.gguf", ngl: 10 },
		roster.defaults,
		8192,
		denseSampler,
	);
	assert.equal(denseArgs.filter((a: string) => a === "-ngl").length, 1, `-ngl must appear once: ${denseArgs.join(" ")}`);
	assert.equal(denseArgs[denseArgs.indexOf("-ngl") + 1], "10", "the model's own ngl, not defaults.ngl");
	const noNgl = buildServerArgs({ alias: "all", repo: "org/repo", file: "w.gguf" }, roster.defaults, 8192, denseSampler);
	assert.equal(noNgl[noNgl.indexOf("-ngl") + 1], String(roster.defaults.ngl), "a model without its own ngl still gets the default");
	pass("a per-model ngl replaces defaults.ngl instead of doubling it");

	// --- a per-model ctxCandidates list overrides the default ladder ----------
	// Qwen3-Coder is the reason this exists: its ladder stops at 4096 because
	// that is the only size its measured --n-cpu-moe config was validated at.
	const rosterPath = join(LOGS, "roster-local.json");
	qwen.file = stubServerPath; // any path that resolves; the stub never reads it
	qwen.ctx = 12288;
	qwen.ctxCandidates = [8192, 6144]; // deliberately NOT the default ladder
	writeFileSync(rosterPath, JSON.stringify(roster));

	r = serve(["Qwen3-Coder-30B-A3B-Q4_K_M", "--host", "127.0.0.1"], {
		PI_SMALL_ROSTER: rosterPath,
		PI_SMALL_STUB_CRASH_ABOVE_CTX: "6144",
	});
	assert.equal(r.status, 0, `expected the per-model ladder to reach 6144, got ${r.status}: ${r.stderr}`);
	assert.ok(/ctx 6144/.test(r.stdout), `expected it to settle at 6144, got: ${r.stdout}`);
	assert.ok(
		!/ctx 16384/.test(r.stdout + r.stderr),
		`the model's own ctxCandidates must replace the default ladder, not extend it: ${r.stdout}${r.stderr}`,
	);
	// 6144 is above pi's 4096 margin but well under a comfortable window, so it
	// is served WITH a warning rather than refused.
	assert.ok(
		/WARNING:.*leaves only ~2048 tokens/.test(r.stderr),
		`expected a headroom warning at ctx 6144, got: ${r.stderr}`,
	);
	stopServer();
	pass("a model's own ctxCandidates replaces the default ladder, and a tight window is served with a warning");

	// --- a window at or below pi's safety margin is called out loudly ---------
	qwen.ctx = 4096;
	qwen.ctxCandidates = [4096];
	writeFileSync(rosterPath, JSON.stringify(roster));
	r = serve(["Qwen3-Coder-30B-A3B-Q4_K_M", "--host", "127.0.0.1"], { PI_SMALL_ROSTER: rosterPath });
	assert.equal(r.status, 0, `4096 still starts — the SERVER is fine — got ${r.status}: ${r.stderr}`);
	assert.ok(
		/WARNING:.*clamp max_tokens to 1.*EVERY request/s.test(r.stderr),
		`expected the one-token warning at ctx 4096, got: ${r.stderr}`,
	);
	stopServer();
	pass("a context at pi's 4096 safety margin starts but warns that every request will return one token");

	// --- thinking: the template switch, not just the budget, and the sampler
	// moves with the mode ---------------------------------------------------
	// `--reasoning-budget 0` alone did NOT disable thinking on Qwen3.6, Qwen3.8
	// or Granite 4.2 30B (2026-09-22). The switch that works is the template's
	// own kwarg, and each Qwen mode has its own sampler row on the card.
	const moded = roster.models.find((m: any) => m.alias === "Qwen3.6-35B-A3B-Q4_K_M");
	moded.file = stubServerPath;
	writeFileSync(rosterPath, JSON.stringify(roster));
	const argvOf = () => JSON.parse(readFileSync(argsLog, "utf8")).argv as string[];
	const argOf = (argv: string[], name: string) => argv[argv.indexOf(name) + 1];

	r = serve(["Qwen3.6-35B-A3B-Q4_K_M", "--host", "127.0.0.1"], { PI_SMALL_ROSTER: rosterPath, PI_SMALL_STUB_ARGS_LOG: argsLog });
	assert.equal(r.status, 0, `default-mode start failed: ${r.stdout}${r.stderr}`);
	let a = argvOf();
	assert.equal(argOf(a, "--chat-template-kwargs"), '{"enable_thinking":true}', "roster default is thinking ON, switched on explicitly");
	assert.equal(argOf(a, "--reasoning-budget"), "-1", "vendor default: unrestricted");
	assert.equal(Number(argOf(a, "--temp")), 1.0, "thinking row: temp 1.0");
	assert.equal(Number(argOf(a, "--top-p")), 0.95, "thinking row: top_p 0.95");
	assert.equal(Number(argOf(a, "--presence-penalty")), 1.5, "thinking row: presence 1.5");
	assert.ok(/verified: live sampler matches the roster/.test(r.stdout), `expected a verified line: ${r.stdout}${r.stderr}`);

	// Same alias, same ctx, OTHER mode: must restart, not adopt.
	r = serve(["Qwen3.6-35B-A3B-Q4_K_M", "--host", "127.0.0.1", "--thinking", "off"], { PI_SMALL_ROSTER: rosterPath, PI_SMALL_STUB_ARGS_LOG: argsLog });
	assert.equal(r.status, 0, `thinking-off start failed: ${r.stdout}${r.stderr}`);
	assert.ok(/with thinking on, but off was asked for — restarting/.test(r.stdout), `a wrong-mode server must be restarted: ${r.stdout}`);
	a = argvOf();
	assert.equal(argOf(a, "--chat-template-kwargs"), '{"enable_thinking":false}', "off is the template kwarg...");
	assert.equal(argOf(a, "--reasoning-budget"), "0", "...AND a zero budget");
	assert.equal(Number(argOf(a, "--temp")), 0.7, "instruct row: temp 0.7, not the thinking row's 1.0");
	assert.equal(Number(argOf(a, "--top-p")), 0.8, "instruct row: top_p 0.8");
	assert.ok(/thinking off confirmed/.test(r.stdout), `expected the live thinking-off check to pass: ${r.stdout}${r.stderr}`);

	// Same mode again: adopted, and still verified.
	r = serve(["Qwen3.6-35B-A3B-Q4_K_M", "--host", "127.0.0.1"], { PI_SMALL_ROSTER: rosterPath, PI_SMALL_THINKING: "off" });
	assert.ok(/nothing to do/.test(r.stdout) && /verified/.test(r.stdout), `same mode should be adopted and verified: ${r.stdout}${r.stderr}`);
	stopServer();
	pass("thinking on/off emits the template switch AND moves the sampler; a wrong-mode server is restarted, never adopted");

	// --- the failure itself is DETECTED, not just prevented -------------------
	// A template that ignores the switch keeps thinking; serve.mjs must say so
	// and exit non-zero, so pi-small-docker.sh never starts a session on it.
	r = serve(["Qwen3.6-35B-A3B-Q4_K_M", "--host", "127.0.0.1", "--thinking", "off"], {
		PI_SMALL_ROSTER: rosterPath,
		PI_SMALL_STUB_IGNORE_THINKING_SWITCH: "1",
	});
	assert.equal(r.status, 3, `a thinking leak on our own server must exit 3, got ${r.status}: ${r.stdout}${r.stderr}`);
	assert.ok(/VERIFY FAIL: thinking is OFF in the roster but the server returned/.test(r.stderr), `expected the leak to be named: ${r.stderr}`);
	stopServer();
	pass("a model that keeps thinking with thinking OFF is caught at startup and blocks the session (exit 3)");

	// --- compareProps catches exactly the class of bug it exists for ----------
	const intended = { temp: 0.7, topP: 0.8, topK: 20, repeatPenalty: 1.05, minP: 0, presencePenalty: 0 };
	const llamaDefaults = { temperature: 0.699999988079071, top_p: 0.95, top_k: 40, min_p: 0.05, repeat_penalty: 1, presence_penalty: 0 };
	const mism = compareProps({ default_generation_settings: { n_ctx: 16384, params: llamaDefaults } }, intended, 16384);
	assert.deepEqual(
		mism.map((m) => m.split(":")[0]).sort(),
		["min_p", "repeat_penalty", "top_k", "top_p"],
		`the four fields Qwen3-Coder actually lost to llama.cpp defaults, and nothing else (f32 temp must not count): ${mism.join("; ")}`,
	);
	assert.deepEqual(compareProps({ default_generation_settings: { n_ctx: 16384, params: { ...llamaDefaults, top_p: 0.8, top_k: 20, min_p: 0, repeat_penalty: 1.05 } } }, intended, 16384), []);
	pass("compareProps flags exactly the sampler fields a server got wrong, tolerating f32 rounding");

	// --- the compaction reserve follows the largest maxTokens -----------------
	assert.equal(requiredReserveTokens(roster), 6144, "4096 everywhere keeps the historical 6144");
	const bigger = JSON.parse(JSON.stringify(roster));
	bigger.models[0].maxTokens = 8192;
	assert.equal(requiredReserveTokens(bigger), 10240, "a model given 8192 needs a 10240 reserve");
	pass("pi's compaction reserve is derived from the roster's largest maxTokens");

	// --- arguments through a .cmd wrapper keep their quotes -------------------
	// cmd.exe + MSVCRT parsing turned {"enable_thinking":false} into
	// {enable_thinking:false}. The end-to-end proof is the thinking checks above
	// passing on Windows, where the stub IS a .cmd wrapper; this pins the rules.
	assert.equal(quoteForCmdShell("8192"), "8192", "plain arguments are untouched");
	assert.equal(quoteForCmdShell('{"enable_thinking":false}'), '"{\\"enable_thinking\\":false}"', "inner quotes are escaped");
	assert.equal(quoteForCmdShell("a b"), '"a b"', "whitespace is quoted");
	assert.equal(quoteForCmdShell('x\\"y'), '"x\\\\\\"y"', "backslashes before a quote are doubled, plus the quote's own");
	pass("arguments passed through a .cmd wrapper are quoted so JSON survives cmd.exe");

	// --- reasoning_effort rides with enable_thinking, only while thinking is on ---
	const granite = roster.models.find((m: any) => m.alias === "Granite-4.2-3B-Q8_0")!;
	assert.equal(granite.thinking, "on");
	assert.deepEqual(thinkingKwargs("on", granite.reasoningEffort), { enable_thinking: true, reasoning_effort: "low" });
	assert.deepEqual(thinkingKwargs("off", granite.reasoningEffort), { enable_thinking: false }, "no effort with thinking off");
	assert.equal(thinkingKwargs(null, "low"), null, "nothing for a model without modes");
	const gArgs = buildServerArgs(granite, roster.defaults, 16384, resolveSampler(granite, roster.defaults, "on"), undefined, "on");
	assert.equal(gArgs[gArgs.indexOf("--chat-template-kwargs") + 1], '{"enable_thinking":true,"reasoning_effort":"low"}');
	assert.equal(gArgs[gArgs.indexOf("--reasoning-budget") + 1], "2048");
	pass("Granite's reasoning_effort reaches the server command line with thinking on, and nowhere with it off");

	// --- per-model toolOptions merge over the defaults; bash gets a default timeout ---
	const minicpm = roster.models.find((m: any) => m.alias === "MiniCPM5-2B-Q8_0")!;
	const mOpts = resolveToolOptions(minicpm, roster.defaults, "bash") as any;
	assert.equal(mOpts.defaultTimeoutSec, 120, "MiniCPM5's own bash options must not drop the roster-wide timeout");
	assert.ok(Array.isArray(mOpts.commandGuards) && mOpts.commandGuards.length > 0, "and its guards stay");
	assert.equal((resolveToolOptions(granite, roster.defaults, "bash") as any).defaultTimeoutSec, 120);
	const bash = buildTool("bash", tmpdir(), { defaultTimeoutSec: 1 });
	const t0 = Date.now();
	const hung = await (bash.execute as any)("t1", { command: "sleep 30" }, undefined, undefined, undefined).then(
		(r: any) => JSON.stringify(r.content),
		(e: any) => String(e?.message ?? e),
	);
	assert.ok(Date.now() - t0 < 15_000, `a command with no timeout of its own is stopped by the default (took ${Date.now() - t0} ms): ${hung}`);
	assert.match(hung, /timed out|timeout/i);
	const own = await (bash.execute as any)("t2", { command: "sleep 2; echo done", timeout: 10 }, undefined, undefined, undefined);
	assert.match(JSON.stringify(own.content), /done/, "a model's own longer timeout wins over the default");
	pass("tool options merge over the roster defaults, and bash calls get a 120 s timeout unless the model sets one");

	console.log(`\n${passed.length} checks passed. Logs: ${LOGS}`);
} finally {
	stopServer();
}
