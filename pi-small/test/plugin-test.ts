/**
 * plugin-test.ts — drives the pi-small plugin against the stub server with a
 * fake ExtensionAPI, so the parts that are expensive to reach through the TUI
 * (switching models, resizing the context, refusing to kill a foreign server)
 * are checked without a GPU.
 *
 *   node test/plugin-test.ts
 */

import assert from "node:assert";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRoster } from "../lib/roster.ts";
import { SESSION_STYLE } from "../lib/workflow.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8199;
const LOGS = mkdtempSync(join(tmpdir(), "pi-small-test-"));

// A POSIX shebang script is not a Windows-executable file (EFTYPE) — a .cmd
// shim that re-invokes node stands in for the stub the same way it would for
// any other wrapped binary. ServerManager.start (and spawnStub below) opts
// into shell:true for exactly that extension, which Node now requires before
// it will run a .cmd/.bat at all.
const stubServerPath = resolve(HERE, "stub-server.mjs");
if (process.platform === "win32") {
	const shimPath = join(LOGS, "stub-server.cmd");
	writeFileSync(shimPath, `@echo off\r\nnode "${stubServerPath}" %*\r\n`);
	process.env.PI_SMALL_LLAMA_BIN = shimPath;
} else {
	process.env.PI_SMALL_LLAMA_BIN = stubServerPath;
}
process.env.PI_SMALL_PORT = String(PORT);
process.env.PI_SMALL_LOG_DIR = LOGS;
process.env.PI_SMALL_START_TIMEOUT = "30";

// ------------------------------------------------------------ fake pi API ---

interface Recorded {
	providers: Array<{ name: string; cfg: any }>;
	/** Currently-registered tools, keyed by name — mirrors pi's own upsert-by-name semantics. */
	toolsByName: Map<string, any>;
	commands: Map<string, any>;
	handlers: Map<string, any>;
	activeTools: string[];
	model: any;
	notices: string[];
}

function fakePi() {
	const rec: Recorded = {
		providers: [],
		toolsByName: new Map(),
		commands: new Map(),
		handlers: new Map(),
		activeTools: [],
		model: null,
		notices: [],
	};
	const pi = {
		registerProvider: (name: string, cfg: any) => rec.providers.push({ name, cfg }),
		unregisterProvider: () => {},
		registerTool: (t: any) => rec.toolsByName.set(t.name, t),
		registerCommand: (name: string, opts: any) => rec.commands.set(name, opts),
		on: (evt: string, h: any) => rec.handlers.set(evt, h),
		setActiveTools: (names: string[]) => {
			rec.activeTools = names;
		},
		getActiveTools: () => rec.activeTools,
		getAllTools: () => [...rec.toolsByName.values()].map((t: any) => ({ name: t.name, description: t.description, parameters: t.parameters })),
		setModel: async (m: any) => {
			rec.model = m;
			return true;
		},
	};
	const ctx = {
		cwd: process.cwd(),
		mode: "tui",
		hasUI: true,
		ui: {
			notify: (msg: string) => rec.notices.push(msg),
			setStatus: () => {},
		},
		modelRegistry: { find: (provider: string, id: string) => ({ provider, id }) },
		// The real bash tool's execute() reads this when exposeSessionEnvironment
		// is on (the default) — needed to exercise it directly for the guard test.
		sessionManager: { getSessionId: () => "test-session", getSessionFile: () => null },
	};
	return { pi, ctx, rec };
}

// ---------------------------------------------------------------- helpers ---

const lastProvider = (rec: Recorded) => rec.providers[rec.providers.length - 1].cfg;
const modelIn = (rec: Recorded, id: string) => lastProvider(rec).models.find((m: any) => m.id === id);
const logCount = () => readdirSync(LOGS).length;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const toolText = (result: any): string => (result.content ?? []).map((c: any) => c.text ?? "").join("\n");

/** Same shell:true-for-.cmd rule as ServerManager.start, for the two direct spawns below. */
function spawnStub(args: string[]): ChildProcess {
	const bin = process.env.PI_SMALL_LLAMA_BIN!;
	return spawn(bin, args, { stdio: "ignore", shell: process.platform === "win32" && /\.(cmd|bat)$/i.test(bin) });
}

/** Same taskkill-the-tree rule as ServerManager.stop, for the two direct spawns below. */
function killStub(proc: ChildProcess): void {
	if (process.platform === "win32" && proc.pid) spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
	else proc.kill("SIGKILL");
}

async function servedAlias(): Promise<string | null> {
	try {
		const res = await fetch(`http://127.0.0.1:${PORT}/v1/models`, {
			headers: { Authorization: "Bearer sk-bench" },
		});
		const body: any = await res.json();
		return body?.data?.[0]?.id ?? null;
	} catch {
		return null;
	}
}

// Preflight. A stub server outlives a test run that dies partway through — an
// assertion failure, a killed ssh session — and the next run's session_start
// then ADOPTS it instead of starting its own. Everything downstream still looks
// plausible right up to the first /sm-model switch, which refuses to kill a
// server pi-small does not own and fails somewhere unrelated to the cause. Fail
// here instead, saying exactly what to do.
if (await servedAlias()) {
	throw new Error(
		`port ${PORT} already has a server on it (serving "${await servedAlias()}"). ` +
			`A previous run leaked a detached stub; kill it first:\n` +
			`  lsof -ti tcp:${PORT} | xargs kill -9      (or: netstat -ano | grep :${PORT}  on Windows)`,
	);
}

const results: string[] = [];
function pass(name: string) {
	results.push(`PASS  ${name}`);
	console.log(`PASS  ${name}`);
}

// ------------------------------------------------------------------- run ---

const roster = loadRoster();
const { default: createExtension } = await import("../extensions/small.ts");
const { pi, ctx, rec } = fakePi();
createExtension(pi as any);

// --- registration happens during the factory, before any server exists -----
assert.equal(rec.providers.length, 1, "provider registered during factory");
assert.equal(rec.providers[0].name, "small-local");
assert.equal(
	lastProvider(rec).models.length,
	roster.models.length,
	"the WHOLE roster is registered up front, not just the starting model, so /model lists everyone",
);
assert.equal(rec.toolsByName.size, 0, "no tools registered before a model is switched in — that happens per model");
pass("factory registers the full roster under one provider; tools wait for the first switchTo");

// --- session_start brings the server up -----------------------------------
await rec.handlers.get("session_start")({}, ctx);
assert.equal(await servedAlias(), "Spark-X2.5-4B-Q6_K", "stub is serving the default model");
assert.deepEqual(rec.activeTools, ["bash"], "Spark's roster entry has no tools override — bash only");
assert.equal(rec.toolsByName.size, 1, "exactly one tool kind registered for Spark");
assert.ok(rec.toolsByName.has("bash"), "the one tool is bash");
assert.equal(modelIn(rec, "Spark-X2.5-4B-Q6_K").contextWindow, 16384, "the active model's entry uses the server-reported context");
assert.equal(modelIn(rec, "Spark-X2.5-4B-Q6_K").maxTokens, 4096, "maxTokens is the flat RESPONSE_MAX_TOKENS cap, not scaled with the window");
assert.equal(
	modelIn(rec, "Apertus-4B-Instruct-v1.1-Q8_0").contextWindow,
	4096,
	"an inactive model is listed too, with ITS OWN roster ctx as the guess (Apertus overrides ctx to 4096) — not 16384 copied from whatever is active",
);
assert.equal(rec.model.id, "Spark-X2.5-4B-Q6_K", "session model set");
assert.ok(
	rec.notices.some((n) => n.includes("probes OK")),
	`probes should pass against the stub; notices were: ${rec.notices.join(" | ")}`,
);
pass("session_start starts llama-server, probes it, and points the session at it");

// --- temperature: no restart ----------------------------------------------
const beforeRequest = rec.handlers.get("before_provider_request");
// Spark's own generation_config.json: temp 1.0, top_p 0.95, top_k disabled.
// Asserted against the CARD, not against whatever the roster defaults happen
// to be — that is the difference the audit was about.
assert.equal(beforeRequest({ payload: { messages: [] } }).temperature, 1.0, "Spark's card temperature, not the roster default");
const logsBefore = logCount();
await rec.commands.get("sm-temp").handler("0.25", ctx);
assert.equal(beforeRequest({ payload: { messages: [] } }).temperature, 0.25, "temp applies to the next request");
assert.equal(beforeRequest({ payload: { messages: [] } }).top_p, 0.95, "top_p still injected");
// The whole sampler has to ride on the request, not just the three obvious
// fields: in remote mode the container never started the server, so anything
// omitted here silently falls back to llama.cpp's own defaults (repeat_penalty
// 1.0, min_p 0.05) regardless of what the roster says.
assert.equal(beforeRequest({ payload: { messages: [] } }).repeat_penalty, 1.0, "repeat_penalty injected");
assert.equal(beforeRequest({ payload: { messages: [] } }).min_p, 0, "min_p injected (0 = disabled; llama.cpp would have used 0.05)");
assert.equal(beforeRequest({ payload: { messages: [] } }).presence_penalty, 0, "presence_penalty injected (Qwen3.6/3.8 ask for 1.5; everything else 0)");
assert.equal(logCount(), logsBefore, "changing temperature must NOT restart the server");
pass("/sm-temp changes the next request and does not restart the server");

// --- system prompt: no override for Spark -----------------------------------
const beforeAgentStart = rec.handlers.get("before_agent_start");
assert.deepEqual(
	beforeAgentStart({ prompt: "hi", systemPrompt: "BASE" }, ctx),
	{ systemPrompt: `BASE\n\n${SESSION_STYLE}` },
	"Spark has no roster systemPrompt, so the chained prompt is kept and only the terse style is appended",
);
pass("/before_agent_start keeps the prompt of a model with no override and appends the terse style");

// --- model switch: restart, re-register, keep the sampler ------------------
await rec.commands.get("sm-model").handler("Granite-4.2-3B-Q8_0", ctx);
assert.equal(
	await servedAlias(),
	"Granite-4.2-3B-Q8_0",
	`stub now serves Granite; notices were: ${rec.notices.join(" | ")}`,
);
assert.equal(modelIn(rec, "Granite-4.2-3B-Q8_0").contextWindow, 16384, "provider re-registered with Granite as the active entry");
assert.ok(modelIn(rec, "Spark-X2.5-4B-Q6_K"), "Spark is still listed — the whole roster stays registered across a switch");
assert.equal(rec.model.id, "Granite-4.2-3B-Q8_0", "session model followed the switch");
assert.equal(beforeRequest({ payload: {} }).temperature, 0.25, "a deliberate /sm-temp survives a model switch");
// ...but NOTHING else of the previous model's sampler does. Carrying the whole
// sampler across served one model's card to the next — Spark's top_k 0 to
// Granite, whose card asks for 50.
assert.equal(beforeRequest({ payload: {} }).top_k, 50, "Granite's own top_k after the switch, not Spark's 0");
assert.equal(beforeRequest({ payload: {} }).top_p, 0.95, "Granite's own top_p");
assert.ok(logCount() > logsBefore, "a switch starts a new server (new log file)");
pass("/sm-model restarts the server with the NEW model's sampler; only a deliberate /sm-temp carries over");

// --- pi's own /model / Ctrl+P triggers the same restart via model_select ---
// This is the mechanism that makes /model live: registering the whole roster
// only gets it INTO the picker, model_select is what makes picking one there
// actually restart llama-server, the same way /sm-model does.
const modelSelect = rec.handlers.get("model_select");
const logsBeforeModelSelect = logCount();
await modelSelect(
	{ model: { provider: "small-local", id: "Nanbeige4.2-3B-Q6_K" }, previousModel: { provider: "small-local", id: "Granite-4.2-3B-Q8_0" }, source: "set" },
	ctx,
);
assert.equal(await servedAlias(), "Nanbeige4.2-3B-Q6_K", "model_select alone (no /sm-model involved) switched the server");
assert.equal(rec.model.id, "Nanbeige4.2-3B-Q6_K", "session model followed the native /model pick");
assert.ok(logCount() > logsBeforeModelSelect, "picking a different alias via /model actually restarted the server");
pass("model_select (pi's native /model / Ctrl+P) switches the server the same way /sm-model does");

// --- re-selecting the already-active model must not restart it -------------
// Also covers the real reentrancy case: switchTo()'s own pi.setModel() call
// fires this same event once the switch above completes, for the model that
// is by then already active — this proves that echo is a safe no-op.
const logsBeforeReselect = logCount();
rec.notices.length = 0;
await modelSelect(
	{ model: { provider: "small-local", id: "Nanbeige4.2-3B-Q6_K" }, previousModel: { provider: "small-local", id: "Nanbeige4.2-3B-Q6_K" }, source: "set" },
	ctx,
);
assert.equal(logCount(), logsBeforeReselect, "re-selecting the already-active model must not restart the server");
assert.equal(rec.notices.length, 0, "...and must not touch the UI at all");
pass("model_select no-ops when the picked model is already the one being served");

// --- model_select ignores selections for a different provider --------------
rec.notices.length = 0;
await modelSelect({ model: { provider: "anthropic", id: "claude-x" }, previousModel: undefined, source: "set" }, ctx);
assert.equal(await servedAlias(), "Nanbeige4.2-3B-Q6_K", "an unrelated provider's model_select must not touch our server");
assert.equal(rec.notices.length, 0, "and must not notify either");
pass("model_select ignores selections for a different provider");

// --- context switch, including llama-server capping it ---------------------
// Reported ctx (4096) is picked so floor(4096/2)=2048 is BELOW the flat
// RESPONSE_MAX_TOKENS cap (4096) — if maxTokens wrongly used the requested
// ctx (8192, whose floor/2=4096 would clear the flat cap and give the same
// 4096 either way) instead of the real servedCtx, this would still read 4096
// and the bug would slip past.
process.env.PI_SMALL_STUB_REPORT_CTX = "4096";
await rec.commands.get("sm-ctx").handler("8192", ctx);
assert.equal(
	modelIn(rec, "Nanbeige4.2-3B-Q6_K").contextWindow,
	4096,
	"the provider must use the context the SERVER reports, not the one we asked for",
);
assert.equal(modelIn(rec, "Nanbeige4.2-3B-Q6_K").maxTokens, 2048, "maxTokens follows the real window, not the flat cap, once the window itself is small");
assert.ok(
	rec.notices.some((n) => n.includes("actually serves 4096")),
	"the cap is reported, not swallowed",
);
delete process.env.PI_SMALL_STUB_REPORT_CTX;
pass("/sm-ctx restarts at the new size and believes the server about what it got");

// --- a model's toolOptions guard bash without touching any other model -----
await rec.commands.get("sm-model").handler("MiniCPM5-2B-Q8_0", ctx);
assert.equal(await servedAlias(), "MiniCPM5-2B-Q8_0", "stub now serves MiniCPM5");
assert.deepEqual(rec.activeTools, ["bash"], "MiniCPM5 still gets exactly bash — same kind, guarded config");
// pi's bash tool throws on a non-zero exit rather than resolving with an
// error result, so a guard refusal (which exits 1) surfaces as a rejection.
const guardedBash = rec.toolsByName.get("bash");
await assert.rejects(
	guardedBash.execute("call-1", { command: "npm install left-pad" }, undefined, undefined, ctx),
	/npm install is disabled/i,
	"expected the npm guard to refuse the command",
);
const allowed = await guardedBash.execute("call-2", { command: "echo still-fine" }, undefined, undefined, ctx);
assert.match(toolText(allowed), /still-fine/, `expected the unguarded command to actually run, got: ${toolText(allowed)}`);
pass("MiniCPM5's roster toolOptions guard npm/npx in bash; an unguarded command still runs");

await rec.commands.get("sm-model").handler("Granite-4.2-3B-Q8_0", ctx);
const graniteBash = rec.toolsByName.get("bash");
const graniteRun = await graniteBash.execute("call-3", { command: "echo granite-has-no-guard" }, undefined, undefined, ctx);
assert.match(toolText(graniteRun), /granite-has-no-guard/, "MiniCPM5's guard must not leak onto Granite's bash tool");
pass("switching away from MiniCPM5 drops its guard — Granite's bash is unaffected");

// --- system prompt: LFM2.5's roster override follows /sm-model -------------
await rec.commands.get("sm-model").handler("LFM2.5-2.6B-Q8_0", ctx);
const overridden = beforeAgentStart({ prompt: "hi", systemPrompt: "BASE" }, ctx);
assert.ok(
	typeof overridden.systemPrompt === "string" && /overwrote a file/i.test(overridden.systemPrompt),
	`expected LFM2.5's roster systemPrompt to replace the chained prompt, got: ${JSON.stringify(overridden)}`,
);
pass("/sm-model switch changes the per-turn system prompt override to match the new model");

// --- context ladder: falls back to a smaller size that actually loads ------
// Mirrors coding-bench/run-filter-bench.sh's per-model context probe: some
// models do not fit the GPU at the roster's usual ctx, and the only way to
// find out is to try. PI_SMALL_STUB_CRASH_ABOVE_CTX makes the stub "OOM"
// (exit immediately) for -c above the given value, standing in for a real
// GPU-memory crash.
process.env.PI_SMALL_STUB_CRASH_ABOVE_CTX = "8192"; // 16384 and 12288 "OOM", 8192 "fits"
rec.notices.length = 0;
const ladderStart = Date.now();
await rec.commands.get("sm-model").handler("Nanbeige4.2-3B-Q6_K", ctx);
const ladderElapsedMs = Date.now() - ladderStart;
delete process.env.PI_SMALL_STUB_CRASH_ABOVE_CTX;
assert.equal(await servedAlias(), "Nanbeige4.2-3B-Q6_K", "the server ends up serving the model that actually fits");
assert.equal(modelIn(rec, "Nanbeige4.2-3B-Q6_K").contextWindow, 8192, "settled at the first ctx candidate that loaded");
assert.ok(
	rec.notices.some((n) => n.includes("context 16384 failed to load") && n.includes("trying 12288")),
	`expected a fallback notice from 16384; notices were: ${rec.notices.join(" | ")}`,
);
assert.ok(
	rec.notices.some((n) => n.includes("context 12288 failed to load") && n.includes("trying 8192")),
	`expected a fallback notice from 12288; notices were: ${rec.notices.join(" | ")}`,
);
assert.ok(
	rec.notices.some((n) => n.includes("did not fit at ctx 16384") && n.includes("serving at 8192")),
	`expected a final did-not-fit summary; notices were: ${rec.notices.join(" | ")}`,
);
assert.ok(
	ladderElapsedMs < 20_000,
	`two failed candidates must fail FAST (the isAlive short-circuit) rather than each waiting out PI_SMALL_START_TIMEOUT; took ${ladderElapsedMs}ms`,
);
pass("a model that OOMs at the roster ctx falls back through ctxCandidates to one that fits, quickly");

// --- the ladder gives up cleanly when nothing fits --------------------------
process.env.PI_SMALL_STUB_CRASH_ABOVE_CTX = "0"; // every candidate "OOMs"
rec.notices.length = 0;
const giveUpStart = Date.now();
// switchTo() catches mgr.start()'s failure and reports it rather than
// throwing out of the command handler, so this resolves normally.
await rec.commands.get("sm-model").handler("Granite-4.2-3B-Q8_0", ctx);
const giveUpElapsedMs = Date.now() - giveUpStart;
delete process.env.PI_SMALL_STUB_CRASH_ABOVE_CTX;
assert.ok(
	rec.notices.some((n) => n.includes("did not come up for Granite-4.2-3B-Q8_0 at any of")),
	`expected a final give-up error; notices were: ${rec.notices.join(" | ")}`,
);
assert.ok(giveUpElapsedMs < 30_000, `all four candidates failing must still fail fast; took ${giveUpElapsedMs}ms`);
pass("when nothing in ctxCandidates fits, pi-small gives up with a clear error instead of hanging");

// --- a server we did not start is never killed -----------------------------
await rec.handlers.get("session_shutdown")({}, ctx);
assert.equal(await servedAlias(), null, "session_shutdown stopped our server");
pass("session_shutdown stops the server we started");

const foreign: ChildProcess = spawnStub([
	"--alias", "SomeoneElsesBenchRun", "-c", "16384", "--port", String(PORT), "--host", "127.0.0.1",
]);
await sleep(1500);
assert.equal(await servedAlias(), "SomeoneElsesBenchRun", "foreign server is up");
rec.notices.length = 0;
await rec.commands.get("sm-model").handler("Spark-X2.5-4B-Q6_K", ctx);
assert.equal(await servedAlias(), "SomeoneElsesBenchRun", "the foreign server must still be running");
assert.ok(
	rec.notices.some((n) => n.includes("Refusing to kill it")),
	`expected a refusal; notices were: ${rec.notices.join(" | ")}`,
);
pass("a foreign llama-server on the port is refused, never killed");

// --- but a server already serving the model we want is adopted -------------
killStub(foreign);
await sleep(500);
const ours: ChildProcess = spawnStub([
	"--alias", "Spark-X2.5-4B-Q6_K", "-c", "16384", "--port", String(PORT), "--host", "127.0.0.1",
]);
await sleep(1500);
rec.notices.length = 0;
await rec.commands.get("sm-model").handler("Spark-X2.5-4B-Q6_K", ctx);
assert.ok(
	rec.notices.some((n) => n.includes("adopted")),
	`expected adoption; notices were: ${rec.notices.join(" | ")}`,
);
assert.equal(await servedAlias(), "Spark-X2.5-4B-Q6_K");
await rec.handlers.get("session_shutdown")({}, ctx);
assert.equal(await servedAlias(), "Spark-X2.5-4B-Q6_K", "an adopted server outlives our session");
killStub(ours);
pass("a server already serving the wanted model is adopted and not killed on exit");

// --- PI_SMALL_MODEL picks the factory's own startup model -------------------
// bin/pi-small resolves ALIAS (from PI_SMALL_MODEL, the saved /model default,
// or the roster's `default: true` entry) and passes it to pi via --model —
// but the plugin's own `initial` (what session_start actually brings up) is
// computed independently, from this same env var. If bin/pi-small ever
// stopped exporting it after resolving ALIAS, the plugin would silently fall
// back to the roster default, serve THAT first, then tear it down the moment
// pi's own --model flag fired model_select for the real target: the wrong
// model loading, replaced a few seconds later by the right one.
process.env.PI_SMALL_MODEL = "MiniCPM5-2B-Q8_0";
const { pi: pi2, ctx: ctx2, rec: rec2 } = fakePi();
createExtension(pi2 as any);
await rec2.handlers.get("session_start")({}, ctx2);
assert.equal(await servedAlias(), "MiniCPM5-2B-Q8_0", "a fresh factory instance starts the model named by PI_SMALL_MODEL, not the roster default");
await rec2.handlers.get("session_shutdown")({}, ctx2);
delete process.env.PI_SMALL_MODEL;
pass("PI_SMALL_MODEL picks the plugin's own startup model — matches what bin/pi-small passes via --model");

// --- a model with thinking modes -------------------------------------------
// Qwen3.6 from the real roster, with the stub standing in for its weights.
// Everything thinking-related has to arrive TWICE — on the command line and on
// every request — because in the container the request is the only lever.
const modedRoster = JSON.parse(readFileSync(resolve(HERE, "..", "roster.json"), "utf8"));
const modedQwen = modedRoster.models.find((m: any) => m.alias === "Qwen3.6-35B-A3B-Q4_K_M");
modedQwen.file = stubServerPath;
// Only its thinking modes are under test here: back on the roster defaults for the rest.
for (const k of ["ctx", "ctxCandidates", "maxTokens"]) delete modedQwen[k];
modedRoster.models.find((m: any) => m.alias === "Qwen3.8-27B-UD-IQ4_XS").maxTokens = 6000;
const modedRosterPath = join(LOGS, "roster-moded.json");
writeFileSync(modedRosterPath, JSON.stringify(modedRoster));
const argsPath = join(LOGS, "moded-args.json");
const sessionDir = join(LOGS, "sessions");
Object.assign(process.env, {
	PI_SMALL_ROSTER: modedRosterPath,
	PI_SMALL_MODEL: "Qwen3.6-35B-A3B-Q4_K_M",
	PI_SMALL_STUB_ARGS_LOG: argsPath,
	PI_SMALL_SESSION_LOG_DIR: sessionDir,
});
const { pi: pi3, ctx: ctx3, rec: rec3 } = fakePi();
createExtension(pi3 as any);
await rec3.handlers.get("session_start")({}, ctx3);
const argv3 = () => JSON.parse(readFileSync(argsPath, "utf8")).argv as string[];
const arg3 = (name: string) => argv3()[argv3().indexOf(name) + 1];
const req3 = () => rec3.handlers.get("before_provider_request")({ payload: { messages: [] } });
const latestLlamaLog = () =>
	readdirSync(LOGS)
		.filter((f) => f.startsWith("llama-Qwen3.6"))
		.sort()
		.map((f) => readFileSync(join(LOGS, f), "utf8"))
		.pop() ?? "";

assert.equal(arg3("--chat-template-kwargs"), '{"enable_thinking":true}', "thinking on by default, switched on explicitly");
assert.deepEqual(req3().chat_template_kwargs, { enable_thinking: true }, "the switch rides on every request");
assert.equal(req3().temperature, 1.0, "thinking row temperature");
assert.equal(req3().presence_penalty, 1.5, "thinking row presence_penalty");
assert.equal(
	(latestLlamaLog().match(/kwargs=\{"enable_thinking":false\}/g) ?? []).length >= 2,
	true,
	"both template probes run with thinking OFF even though the session thinks",
);
assert.ok(rec3.notices.some((n) => /probes OK/.test(n)), `probes should pass: ${rec3.notices.join(" | ")}`);
assert.equal(modelIn(rec3, "Qwen3.6-35B-A3B-Q4_K_M").maxTokens, 4096, "default maxTokens");
assert.equal(modelIn(rec3, "Qwen3.8-27B-UD-IQ4_XS").maxTokens, 6000, "a model's own maxTokens");
pass("a thinking model gets the template switch on the command line AND per request; probes run with thinking off");

// /sm-thinking off: restart, instruct sampler, and the live check confirms it.
await rec3.commands.get("sm-thinking").handler("off", ctx3);
assert.equal(arg3("--chat-template-kwargs"), '{"enable_thinking":false}');
assert.equal(arg3("--reasoning-budget"), "0");
assert.deepEqual(req3().chat_template_kwargs, { enable_thinking: false });
assert.equal(req3().temperature, 0.7, "instruct row temperature moves with the mode");
assert.equal(req3().top_p, 0.8, "instruct row top_p moves with the mode");
assert.ok(rec3.notices.some((n) => /no reasoning with thinking off/.test(n)), `the thinking-off check should pass: ${rec3.notices.slice(-4).join(" | ")}`);
pass("/sm-thinking off restarts in instruct mode with the instruct sampler, and verifies no reasoning comes back");

// The failure itself: a template that ignores the switch is REPORTED.
process.env.PI_SMALL_STUB_IGNORE_THINKING_SWITCH = "1";
const noticesBeforeLeak = rec3.notices.length;
await rec3.commands.get("sm-restart").handler("", ctx3);
delete process.env.PI_SMALL_STUB_IGNORE_THINKING_SWITCH;
assert.ok(
	rec3.notices.slice(noticesBeforeLeak).some((n) => /thinking FAIL — thinking is OFF but the model returned/.test(n)),
	`a thinking leak must be reported: ${rec3.notices.slice(noticesBeforeLeak).join(" | ")}`,
);
pass("a model that keeps thinking with thinking off is reported at session start");

// Truncation: loud, and louder when the whole budget went to thinking.
const messageEnd = rec3.handlers.get("message_end");
const noticesBeforeTrunc = rec3.notices.length;
messageEnd({ message: { role: "assistant", content: [{ type: "thinking", thinking: "x".repeat(900) }], stopReason: "length", usage: { input: 10, output: 4096 } } }, ctx3);
messageEnd({ message: { role: "assistant", content: [{ type: "text", text: "partial answ" }], stopReason: "length", usage: { input: 10, output: 4096 } } }, ctx3);
const truncNotices = rec3.notices.slice(noticesBeforeTrunc);
assert.ok(truncNotices.some((n) => /max_tokens \(4096\) with NO answer — 900 chars of thinking/.test(n)), `empty truncation: ${truncNotices.join(" | ")}`);
assert.ok(truncNotices.some((n) => /response truncated at max_tokens \(4096\)/.test(n)), `partial truncation: ${truncNotices.join(" | ")}`);
pass("a response cut off at max_tokens is reported, and one with no answer at all is named as such");

// Compaction: pi-small writes the summary itself, with its own prompt — in
// context first (reusing the server's prompt cache), then from a serialized copy.
{
	const compactHook = rec3.handlers.get("session_before_compact");
	const calls: any[] = [];
	let replies: any[] = [];
	const entries = [
		{ type: "message", id: "e1", parentId: null, timestamp: new Date(1).toISOString(), message: { role: "user", content: "build the thing", timestamp: 1 } },
		{ type: "message", id: "e2", parentId: "e1", timestamp: new Date(2).toISOString(), message: { role: "assistant", content: [{ type: "text", text: "on it" }], api: "openai-completions", provider: "small-local", model: "m", usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2 } },
	];
	const cctx = {
		...ctx3,
		model: { provider: "small-local", id: "Qwen3.6-35B-A3B-Q4_K_M", api: "openai-completions" },
		getSystemPrompt: () => "THE SYSTEM PROMPT",
		sessionManager: { ...ctx3.sessionManager, getEntries: () => entries, getLeafId: () => "e2" },
		modelRegistry: { ...ctx3.modelRegistry, complete: async (m: any, c: any, o: any) => (calls.push({ m, c, o }), replies.shift()) },
	};
	const ok = { content: [{ type: "text", text: "## Lessons\nx\n## Next steps\ny" }], stopReason: "stop", usage: { output: 9 } };
	const cut = { content: [{ type: "text", text: "## Lessons\ncut o" }], stopReason: "length", usage: {} };
	const event = (previousSummary?: string) => ({
		reason: "threshold",
		signal: new AbortController().signal,
		preparation: {
			messagesToSummarize: [{ role: "user", content: "build the thing", timestamp: 1 }],
			turnPrefixMessages: [],
			tokensBefore: 12000,
			firstKeptEntryId: "entry-7",
			previousSummary,
			settings: { reserveTokens: 5000 },
		},
	});

	replies = [ok];
	const out = await compactHook(event(), cctx);
	assert.deepEqual(out?.compaction, { summary: "## Lessons\nx\n## Next steps\ny", firstKeptEntryId: "entry-7", tokensBefore: 12000, usage: { output: 9 } });
	const first = calls[0];
	assert.equal(first.c.systemPrompt, "THE SYSTEM PROMPT", "the agent's own system prompt, so the prefix matches");
	assert.deepEqual(first.c.tools.map((t: any) => t.name), rec3.activeTools, "the agent's active tools, in order");
	const msgs = first.c.messages;
	assert.deepEqual(msgs.slice(0, 2).map((m: any) => m.role), ["user", "assistant"], "the session's own messages come first");
	const [call, result] = msgs.slice(-2);
	assert.equal(call.content[0].type, "toolCall", "then a synthetic tool call...");
	assert.equal(result.role, "toolResult", "...whose result is the instruction — not a user message, which would re-render earlier thinking");
	const instruction = result.content[0].text;
	assert.match(instruction, /## Lessons\nAt most 200 words/, "200 words per part unless the roster says otherwise");
	assert.match(instruction, /## Next steps\nAt most 200 words/, instruction);
	assert.doesNotMatch(instruction, /Findings so far/, "only review steps are asked for findings");
	assert.equal(first.o.maxTokens, 4000, "0.8 x reserveTokens, as pi's own compaction uses");
	const shaped = first.o.onPayload({ messages: [] });
	assert.ok("temperature" in shaped && "presence_penalty" in shaped, "the request is shaped like a normal turn (sampler, thinking switch)");

	calls.length = 0;
	replies = [cut, ok];
	const out2 = await compactHook(event("## Lessons\nold lesson"), cctx);
	assert.equal(out2?.compaction?.summary, "## Lessons\nx\n## Next steps\ny", "a failed in-context summary falls back to the serialized one");
	const prompt = calls[1].c.messages[0].content[0].text;
	assert.match(prompt, /<previous-summary>\n## Lessons\nold lesson\n<\/previous-summary>/, "the serialized prompt carries the previous summary");
	assert.match(prompt, /<conversation>[\s\S]*build the thing[\s\S]*<\/conversation>/, "and the conversation");

	replies = [cut, cut];
	assert.equal(await compactHook(event(), cctx), undefined, "when both fail, pi's own compaction runs");

	// pi's reserve is the roster's largest; a model with a smaller maxTokens
	// holds a threshold compaction off until its own threshold (window - its reserve).
	calls.length = 0;
	const small = { ...cctx, model: { ...cctx.model, contextWindow: 16384 } };
	const early = event();
	early.preparation.tokensBefore = 7000;
	assert.deepEqual(await compactHook(early, small), { cancel: true }, "7000 of 16384 is below 16384 - 6144: too early for a 4096-maxTokens model");
	assert.equal(calls.length, 0, "and no summary is requested");
	early.preparation.tokensBefore = 10300;
	replies = [ok];
	assert.ok((await compactHook(early, small))?.compaction, "past its own threshold it compacts");
}
pass("compaction: in context first (same prompt, tools, payload; instruction as a tool result), then serialized, then pi's own");

// The session log: settings, effective system prompt, every response.
rec3.handlers.get("before_agent_start")({ prompt: "hi", systemPrompt: "BASE PROMPT" }, ctx3);
const logFile = readdirSync(sessionDir).find((f) => f.startsWith("session-"));
assert.ok(logFile, "a session log is written");
const records = readFileSync(join(sessionDir, logFile!), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const types = new Set(records.map((r) => r.type));
for (const t of ["session", "system_prompt", "response", "compaction"]) assert.ok(types.has(t), `session log has a ${t} record: ${[...types].join(",")}`);
const promptRec = records.find((r) => r.type === "system_prompt");
assert.equal(promptRec.chars, `BASE PROMPT\n\n${SESSION_STYLE}`.length, "the prompt's length is recorded");
assert.match(promptRec.sha256, /^[0-9a-f]{12}$/, "and its hash — pi does not persist the prompt itself");
assert.ok(records.some((r) => r.type === "session" && r.thinking === "off" && r.sampler.temp === 0.7), "the session record carries the mode and the sampler actually used");
pass("each session logs its settings, its effective system prompt (length + hash) and every response's cost");

await rec3.handlers.get("session_shutdown")({}, ctx3);
for (const k of ["PI_SMALL_ROSTER", "PI_SMALL_MODEL", "PI_SMALL_STUB_ARGS_LOG", "PI_SMALL_SESSION_LOG_DIR"]) delete process.env[k];

console.log(`\n${results.length} checks passed. Logs: ${LOGS}`);
process.exit(0);
