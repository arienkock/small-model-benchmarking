/**
 * persona-test.ts — persona mode (PI_SMALL_MODE=persona) without a GPU:
 * lib/persona.ts on its own, then the plugin in persona mode against the stub
 * server with a fake ExtensionAPI, the same way test/plugin-test.ts drives
 * coding mode.
 *
 *   node test/persona-test.ts
 */

import assert from "node:assert";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	acceptTiers,
	buildMemoryInstruction,
	buildPersonaSystemPrompt,
	forgetInMemory,
	parseTiers,
	PERSONA_STYLE,
	PERSONA_TOOL_STYLE,
	readMemory,
	readPersonaPrompt,
	sanitizeSpeech,
	timestamp,
	TIMESTAMP_RE,
	writeMemory,
} from "../lib/persona.ts";
import { formatWeather } from "../lib/persona-tools.ts";
import { loadRoster, personaDefaultModel, resolvePersona } from "../lib/roster.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const pass = (name: string) => console.log(`PASS  ${name}`);
const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));

// ================================================================ unit ===

// --- the prompt never scripts wording -------------------------------------
{
	for (const text of [PERSONA_STYLE, PERSONA_TOOL_STYLE, buildMemoryInstruction({ permanent: 1, ongoing: 1, recent: 1 })]) {
		// A quoted phrase in the persona's instructions is a phrase it will parrot.
		// The one allowed quote is the "tomorrow" example of what NOT to write in memory.
		const quotes = (text.match(/"[^"]+"/g) ?? []).filter((q) => q !== '"tomorrow"');
		assert.deepEqual(quotes, [], `no quoted phrasings in persona instructions: ${quotes.join(", ")}`);
	}
	const bare = buildPersonaSystemPrompt({ persona: "", memory: null });
	assert.equal(bare, PERSONA_STYLE, "no persona.md and no memory: just the constraints");
	assert.ok(!bare.includes(PERSONA_TOOL_STYLE), "tool rule only when there are tools");
	const full = buildPersonaSystemPrompt({ persona: "You are P.", memory: { permanent: "A is a person.", ongoing: "" }, tools: true });
	assert.ok(full.startsWith("You are P."), "persona.md first");
	assert.ok(full.includes(PERSONA_TOOL_STYLE), "tool rule present with tools");
	assert.ok(full.includes("## Permanent\nA is a person.") && full.includes("## Ongoing\n(nothing yet)"), "memory rendered under its headings");
	assert.ok(!/\d{2}:\d{2}/.test(full), "no time in the system prompt (it would defeat the prompt cache)");
	pass("system prompt: persona.md, then constraints, then memory; no scripted phrases, no time");
}

// --- persona.md: the home copy wins, and comments are stripped ------------
{
	const home = tmp("persona-home-");
	const repo = readPersonaPrompt(home);
	assert.ok(repo.path.endsWith(join("persona", "persona.md")), "falls back to the repo default");
	assert.ok(!repo.text.includes("<!--"), "HTML comments are notes for editors, not for the model");
	writeFileSync(join(home, "persona.md"), "<!-- note -->\nYou are Q.\n");
	assert.equal(readPersonaPrompt(home).text, "You are Q.", "the persona home's copy wins");
	pass("persona.md: the home copy wins over the repo's; comments stripped");
}

// --- tiers -----------------------------------------------------------------
{
	assert.deepEqual(parseTiers("## Permanent\nA\n\n## Ongoing\nB\n\n## Recent\nC"), { permanent: "A", ongoing: "B", recent: "C" });
	assert.deepEqual(parseTiers("**Permanent:**\nA\n### ongoing\nB\nRECENT\nC"), { permanent: "A", ongoing: "B", recent: "C" }, "tolerant of what small models do to headings");
	assert.deepEqual(parseTiers("Permanent facts are the hard ones to keep.\n## Recent\nC"), { recent: "C" }, "a sentence starting with the word is not a heading");
	assert.deepEqual(parseTiers("no headings at all"), {}, "nothing guessed");
	pass("parseTiers: headings in their small-model variations, nothing guessed");

	const old = { permanent: "x".repeat(200), ongoing: "o" };
	let r = acceptTiers(old, { permanent: "short", ongoing: "new", recent: "r" }, "T");
	assert.equal(r.memory.permanent, old.permanent, "a Permanent tier that collapses keeps the old one");
	assert.equal(r.memory.ongoing, "new", "Ongoing may shrink — dropping what is over is its job");
	assert.equal(r.rejected.length, 1);
	r = acceptTiers(old, { recent: "r" }, "T");
	assert.equal(r.memory.permanent, old.permanent, "a missing tier keeps the old one");
	assert.equal(r.memory.ongoing, "o");
	r = acceptTiers(old, { permanent: "y".repeat(190), ongoing: "n" }, "T");
	assert.equal(r.memory.permanent, "y".repeat(190), "a Permanent tier of similar size is accepted");
	assert.deepEqual(r.rejected, []);
	r = acceptTiers(null, { permanent: "tiny", ongoing: "" }, "T");
	assert.equal(r.memory.permanent, "tiny", "no old memory: anything goes");
	pass("acceptTiers: a collapsed or missing tier keeps what was known");
}

// --- the memory file ---------------------------------------------------------
{
	const home = tmp("persona-mem-");
	assert.equal(readMemory(home), null);
	writeMemory(home, { permanent: "P1\nP2 likes tea", ongoing: "O1", updated: "2026-09-26T10:00:00.000Z" });
	assert.deepEqual(readMemory(home), { permanent: "P1\nP2 likes tea", ongoing: "O1", updated: "2026-09-26T10:00:00.000Z" }, "round trip");
	writeMemory(home, { permanent: "P1\nP2 likes tea", ongoing: "O2", updated: "2026-09-26T11:00:00.000Z" });
	assert.equal(readdirSync(join(home, "memory-history")).length, 1, "the previous version is kept");
	assert.equal(forgetInMemory(home, "TEA", "2026-09-26T12:00:00.000Z"), 1, "forget is case-insensitive");
	assert.equal(readMemory(home)!.permanent, "P1");
	assert.equal(forgetInMemory(home, "nothing like this", "x"), 0);
	pass("memory.md: round trip, history kept, forget removes lines");
}

// --- time ---------------------------------------------------------------------
{
	const t = timestamp(new Date(2026, 8, 26, 9, 5));
	assert.equal(t, "[Sat 26 Sep 2026, 09:05]");
	assert.ok(TIMESTAMP_RE.test(`${t} hello`));
	pass("timestamp: local, absolute, recognisable");
}

// --- speech sanitiser ------------------------------------------------------------
{
	const cases: Array<[string, string, boolean]> = [
		["Plain reply. Nothing to do.", "Plain reply. Nothing to do.", false],
		["2 * 3 is six.", "2 * 3 is six.", false],
		["**Sure.** Three kinds:\n- apples\n- pears 🍐\n1. plums", "Sure. Three kinds: apples, pears, plums.", true],
		["| a | b |\n|---|---|\n| 1 | 2 |", "a, b, 1, 2.", true],
		["<think>hmm</think>It's *fine*, see [docs](http://x).", "It's fine, see docs.", true],
		["[Sat 26 Sep 2026, 14:02] Hello.", "Hello.", true],
		["# Title\nSome text.", "Title, Some text.", true],
	];
	for (const [input, want, changed] of cases) {
		const got = sanitizeSpeech(input);
		assert.equal(got.text, want, `sanitize ${JSON.stringify(input)}`);
		assert.equal(got.changed, changed, `changed flag for ${JSON.stringify(input)}`);
	}
	pass("sanitizeSpeech: strips markup, keeps every word, flags when it had to");
}

// --- weather text -----------------------------------------------------------------
{
	const out = formatWeather("Utrecht", {
		current: { temperature_2m: 14.4, weather_code: 3, wind_speed_10m: 11.2 },
		daily: { time: ["2026-09-26", "2026-09-27"], weather_code: [61, 0], temperature_2m_min: [9.2, 8], temperature_2m_max: [15.6, 17], precipitation_probability_max: [80, 5] },
	});
	assert.ok(out.includes("Now: overcast, 14 degrees Celsius, wind 11 km/h."), out);
	assert.ok(out.includes("Tomorrow (2026-09-27): clear sky, 8 to 17 degrees, 5 percent chance of rain."), out);
	pass("weather: plain text the model can retell");
}

// --- roster ----------------------------------------------------------------------------
{
	const roster = loadRoster();
	assert.equal(personaDefaultModel(roster).alias, "Qwen3.6-35B-A3B-Q4_K_M", "the persona's default is Qwen3.6");
	assert.ok(roster.models.find((m) => m.default)!.alias !== "Qwen3.6-35B-A3B-Q4_K_M", "…and the coding default is untouched");
	const p = resolvePersona(personaDefaultModel(roster), roster.defaults);
	assert.equal(p.thinking, "off");
	assert.equal(p.maxTokens, 300);
	assert.deepEqual(p.tools, ["weather"]);
	pass("roster: persona defaults to Qwen3.6, thinking off, 300 tokens, weather");
}

// ============================================================== plugin ===

const PORT = 8198;
const LOGS = tmp("persona-logs-");
const HOME = tmp("persona-plugin-home-");
const rosterPath = join(LOGS, "roster.json");
{
	// The real roster, with the persona pointed at a model the stub can "serve"
	// on a machine without the weights (Qwen3.6 is repo "local"). Granite 4.2 3B
	// thinks by default, so this also checks that persona mode turns it off.
	const r = JSON.parse(readFileSync(join(HERE, "..", "roster.json"), "utf8"));
	r.defaults.persona.model = "Granite-4.2-3B-Q8_0";
	writeFileSync(rosterPath, JSON.stringify(r));
}
Object.assign(process.env, {
	PI_SMALL_MODE: "persona",
	PI_SMALL_PERSONA_HOME: HOME,
	PI_SMALL_ROSTER: rosterPath,
	PI_SMALL_PORT: String(PORT),
	PI_SMALL_LOG_DIR: LOGS,
	PI_SMALL_START_TIMEOUT: "30",
	PI_SMALL_LLAMA_BIN: resolve(HERE, "stub-server.mjs"),
});
delete process.env.PI_SMALL_MODEL;
delete process.env.PI_SMALL_THINKING;
if (process.platform === "win32") {
	const shim = join(LOGS, "stub-server.cmd");
	writeFileSync(shim, `@echo off\r\nnode "${resolve(HERE, "stub-server.mjs")}" %*\r\n`);
	process.env.PI_SMALL_LLAMA_BIN = shim;
}

const handlers = new Map<string, any>();
const tools = new Map<string, any>();
const commands = new Map<string, any>();
let activeTools: string[] = [];
const providers: any[] = [];
const notices: string[] = [];
const pi = {
	registerProvider: (_n: string, cfg: any) => providers.push(cfg),
	registerTool: (t: any) => tools.set(t.name, t),
	registerCommand: (n: string, o: any) => commands.set(n, o),
	on: (e: string, h: any) => handlers.set(e, h),
	setActiveTools: (n: string[]) => (activeTools = n),
	getActiveTools: () => activeTools,
	getAllTools: () => [...tools.values()],
	setModel: async () => true,
};

// A session with a compaction entry in it, for the reconcile check below.
const sessionEntries: any[] = [];
let completeReply = "";
const ctx: any = {
	hasUI: true,
	ui: { notify: (m: string) => notices.push(m), setStatus: () => {} },
	modelRegistry: {
		find: (provider: string, id: string) => ({ provider, id }),
		complete: async () => ({ content: [{ type: "text", text: completeReply }], stopReason: "stop", usage: {} }),
	},
	sessionManager: { getSessionId: () => "t", getSessionFile: () => null, getEntries: () => sessionEntries, getLeafId: () => null },
	getSystemPrompt: () => "sys",
};

try {
	// A session that already holds a compaction newer than memory.md (a crash
	// between commit and write): the start restores the file from it.
	sessionEntries.push({ type: "compaction", details: { persona: { memory: { permanent: "From the session.", ongoing: "", updated: "2026-09-26T09:00:00.000Z" } } } });

	const { default: createExtension } = await import("../extensions/small.ts");
	createExtension(pi as any);
	await handlers.get("session_start")({}, ctx);

	assert.equal(readMemory(HOME)?.permanent, "From the session.", "memory.md restored from the session's newest compaction");
	pass("session start: memory.md behind the session is restored from it");

	assert.deepEqual(activeTools, ["weather"], "persona tools only — never bash");
	const model = providers.at(-1).models.find((m: any) => m.id === "Granite-4.2-3B-Q8_0");
	assert.equal(model.maxTokens, 300, "persona reply cap");
	const payload = handlers.get("before_provider_request")({ payload: { messages: [] } });
	assert.deepEqual(payload.chat_template_kwargs, { enable_thinking: false }, "persona thinking off on a model that thinks by default");
	assert.equal(payload.temperature, 1.0, "vendor sampler kept (no flattened temperature)");
	assert.ok(notices.some((n) => n.includes("probes OK")), `probes pass, tool probe included: ${notices.join(" | ")}`);
	pass("persona session: weather tool only, 300-token cap, thinking off, vendor sampler, probes OK");

	// --- system prompt ---------------------------------------------------------
	let sp = handlers.get("before_agent_start")({ systemPrompt: " \nCurrent working directory: /x" }, ctx).systemPrompt;
	assert.ok(sp.includes(PERSONA_STYLE) && sp.includes(PERSONA_TOOL_STYLE), "constraints and the tool rule");
	assert.ok(sp.includes("From the session."), "memory in the prompt");
	assert.ok(!sp.includes("Current working directory"), "pi's coding-agent line is replaced");
	writeMemory(HOME, { permanent: "Edited by hand.", ongoing: "", updated: "2026-09-26T09:30:00.000Z" });
	sp = handlers.get("before_agent_start")({ systemPrompt: "" }, ctx).systemPrompt;
	assert.ok(sp.includes("Edited by hand."), "a hand edit applies to the next turn");
	pass("system prompt: persona + constraints + memory, re-read each turn");

	// --- timestamp ---------------------------------------------------------------
	const input = handlers.get("input");
	const out = input({ text: "what time is it", source: "rpc" });
	assert.equal(out.action, "transform");
	assert.ok(TIMESTAMP_RE.test(out.text) && out.text.endsWith("what time is it"));
	assert.equal(input({ text: "/sm-persona", source: "interactive" }).action, "continue", "commands untouched");
	assert.equal(input({ text: out.text, source: "rpc" }).action, "continue", "never stamped twice");
	pass("input: each message stamped with its time, once; commands left alone");

	// --- compaction ----------------------------------------------------------------
	const compact = handlers.get("session_before_compact");
	const prep = (tokensBefore: number) => ({
		preparation: { messagesToSummarize: [], turnPrefixMessages: [], tokensBefore, firstKeptEntryId: "e1", previousSummary: undefined, settings: { reserveTokens: 6144 } },
		signal: new AbortController().signal,
	});
	const window = model.contextWindow;
	let res = await compact({ ...prep(window - 7000), reason: "threshold" }, { ...ctx, model: { contextWindow: window } });
	assert.deepEqual(res, { cancel: true }, "pi's threshold is held back until the hard backstop");

	completeReply = "## Permanent\nEdited by hand.\nThey have a cat.\n\n## Ongoing\nA trip on 3 Oct 2026.\n\n## Recent\nTalked about the trip.";
	res = await compact({ ...prep(1000), reason: "manual" }, { ...ctx, model: { contextWindow: window } });
	assert.equal(res.compaction.summary, "Talked about the trip.", "pi keeps the Recent tier as its summary");
	assert.equal(res.compaction.details.persona.memory.ongoing, "A trip on 3 Oct 2026.");
	assert.equal(readMemory(HOME)?.permanent, "Edited by hand.", "memory.md is NOT written before the compaction is committed");

	await handlers.get("session_compact")({ compactionEntry: { details: res.compaction.details }, reason: "manual" }, ctx);
	assert.equal(readMemory(HOME)?.permanent, "Edited by hand.\nThey have a cat.", "written once committed");
	pass("compaction: threshold deferred; tiers split between pi's summary and memory.md, written only on commit");

	completeReply = "I would rather not.";
	res = await compact({ ...prep(1000), reason: "manual" }, { ...ctx, model: { contextWindow: window } });
	assert.equal(res, undefined, "a reply with no tiers falls through to pi's own compaction");
	assert.equal(readMemory(HOME)?.ongoing, "A trip on 3 Oct 2026.", "and memory is untouched");
	pass("compaction: a reply without tiers never touches memory");

	// --- /sm-persona ---------------------------------------------------------------------
	notices.length = 0;
	await commands.get("sm-persona").handler("forget cat", ctx);
	assert.ok(notices[0].includes("removed 1"), notices[0]);
	assert.ok(!readMemory(HOME)!.permanent.includes("cat"));
	await commands.get("sm-persona").handler("", ctx);
	assert.ok(notices[1].includes("## Permanent"));
	pass("/sm-persona: show and forget");
} finally {
	await handlers.get("session_shutdown")?.();
}
console.log("\npersona tests passed");
assert.ok(existsSync(HOME));
