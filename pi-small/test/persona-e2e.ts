/**
 * persona-e2e.ts — the whole persona path without a GPU: persona/server.mjs
 * running a real `pi --mode rpc` (bin/sm-persona) with the pi-small plugin in
 * persona mode, against the stub llama-server (a script plays the model,
 * test/fixtures/persona-script.mjs) and a fake Open-Meteo.
 *
 *   node test/persona-e2e.ts
 *
 * Needs pi: node_modules/.bin/pi (npm install) or PI_SMALL_PI_BIN.
 */

import assert from "node:assert";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readMemory } from "../lib/persona.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const HOME = mkdtempSync(join(tmpdir(), "persona-e2e-"));
const LLAMA_PORT = 8197;
const PORT = 8196;
const WEATHER_PORT = 8195;
const KEY = "sk-persona-test";
const pass = (name: string) => console.log(`PASS  ${name}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const piBin = process.env.PI_SMALL_PI_BIN ?? join(ROOT, "node_modules", ".bin", "pi");
if (!existsSync(piBin)) {
	console.error(`persona-e2e: pi not found at ${piBin} (npm install, or set PI_SMALL_PI_BIN)`);
	process.exit(1);
}

// --- a fake Open-Meteo, slow enough that a tool call is visibly "in the background"
const WEATHER_DELAY_MS = 1500;
const weather = createServer((req, res) => {
	setTimeout(() => {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(
			JSON.stringify({
				current: { temperature_2m: 14, weather_code: 3, wind_speed_10m: 10 },
				daily: { time: ["2026-09-26", "2026-09-27"], weather_code: [3, 61], temperature_2m_min: [9, 8], temperature_2m_max: [15, 13], precipitation_probability_max: [10, 70] },
			}),
		);
	}, WEATHER_DELAY_MS);
}).listen(WEATHER_PORT, "127.0.0.1");

// --- the roster, with the persona on a model the stub can "serve" here ------------
const roster = JSON.parse(readFileSync(join(ROOT, "roster.json"), "utf8"));
roster.defaults.persona.model = "Granite-4.2-3B-Q8_0";
const rosterPath = join(HOME, "roster.json");
writeFileSync(rosterPath, JSON.stringify(roster));
writeFileSync(join(HOME, "config.json"), JSON.stringify({ home: { name: "Testville", latitude: 52, longitude: 5 } }));
// A conversation this short is all inside the real keepRecentTokens (1536), and
// pi refuses to compact it; keep almost nothing verbatim so there is something to compact.
mkdirSync(join(HOME, "pi"), { recursive: true });
writeFileSync(join(HOME, "pi", "settings.json"), JSON.stringify({ compaction: { reserveTokens: 6144, keepRecentTokens: 1 } }));

const server = spawn(process.execPath, [join(ROOT, "persona", "server.mjs")], {
	stdio: ["ignore", "pipe", "pipe"],
	env: {
		...process.env,
		PERSONA_API_KEY: KEY,
		PERSONA_PORT: String(PORT),
		PERSONA_BIND: "127.0.0.1",
		PERSONA_COMPACT_AT: "0", // compact after every settled turn: exercises cancel and commit
		PERSONA_FIRST_REPLY_WAIT: "5",
		PERSONA_TEST_COMPACT_DELAY_MS: "3000",
		PI_SMALL_PERSONA_HOME: HOME,
		PI_SMALL_ROSTER: rosterPath,
		PI_SMALL_PORT: String(LLAMA_PORT),
		PI_SMALL_LLAMA_BIN: join(HERE, "stub-server.mjs"),
		PI_SMALL_STUB_SCRIPT: join(HERE, "fixtures", "persona-script.mjs"),
		PI_SMALL_PI_BIN: piBin,
		PI_SMALL_START_TIMEOUT: "30",
		PI_SMALL_WEATHER_API: `http://127.0.0.1:${WEATHER_PORT}`,
		LLAMA_CACHE: HOME,
		PI_SMALL_MODEL: "",
		PI_SMALL_THINKING: "",
	},
});
let serverOut = "";
server.stdout.on("data", (d) => (serverOut += d));
server.stderr.on("data", (d) => (serverOut += d));

const base = `http://127.0.0.1:${PORT}`;
const auth = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const chat = async (content: string, extra: any = {}) => {
	const res = await fetch(`${base}/v1/chat/completions`, {
		method: "POST",
		headers: auth,
		body: JSON.stringify({ model: "whatever", messages: [{ role: "system", content: "ignored" }, { role: "user", content }], ...extra }),
	});
	return { status: res.status, body: extra.stream ? await res.text() : ((await res.json()) as any) };
};
const status = async () => (await (await fetch(`${base}/persona/status`, { headers: auth })).json()) as any;
const until = async (what: string, fn: () => Promise<boolean>, ms = 30_000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await fn().catch(() => false)) return;
		await sleep(200);
	}
	throw new Error(`timed out waiting for ${what}`);
};

// Follow-ups arrive on /persona/events.
const followups: any[] = [];
async function listen() {
	const res = await fetch(`${base}/persona/events`, { headers: auth });
	const reader = res.body!.getReader();
	let buf = "";
	for (;;) {
		const { value, done } = await reader.read();
		if (done) return;
		buf += new TextDecoder().decode(value);
		let i;
		while ((i = buf.indexOf("\n\n")) >= 0) {
			const block = buf.slice(0, i);
			buf = buf.slice(i + 2);
			const data = /^data: (.*)$/m.exec(block)?.[1];
			if (data) followups.push(JSON.parse(data));
		}
	}
}

try {
	// --- up ----------------------------------------------------------------------
	await until("the persona to be ready", async () => (await fetch(`${base}/health`)).status === 200, 60_000);
	assert.equal((await fetch(`${base}/v1/models`)).status, 401, "every route but /health needs the key");
	listen().catch(() => {});
	await sleep(200);
	pass("server up: pi in RPC mode, plugin in persona mode, model loaded and probed");

	// --- a plain turn ----------------------------------------------------------------
	let r = await chat("hello there");
	assert.equal(r.status, 200);
	const reply = r.body.choices[0].message.content as string;
	assert.ok(reply.includes("stub reply from Granite-4.2-3B-Q8_0"), reply);
	assert.ok(!reply.includes("\n"), "newlines joined for speech");
	assert.match(reply, /you said: \[\w{3} \d{1,2} \w{3} \d{4}, \d{2}:\d{2}\] hello there/, "the plugin stamped the message with its time");
	assert.ok(reply.includes("max_tokens=300"), "the persona reply cap reached the server");
	assert.ok(reply.includes("tools offered=weather"), "the weather tool, and only it");
	assert.equal(r.body.persona.followup, false);
	pass("plain turn: one reply, timestamped question, 300-token cap, weather tool only");

	// --- a speculative compaction is cancelled by the next request ------------------------
	await until("a speculative compaction to start", async () => (await status()).compacting !== null, 10_000);
	r = await chat("make a list");
	assert.equal(r.body.choices[0].message.content, "Three things: one, two, three.", "markup stripped, every word kept");
	assert.ok(!existsSync(join(HOME, "memory.md")), "the cancelled compaction wrote no memory");
	pass("a request aborts a running speculative compaction, and nothing is written");

	// --- a quiet spell lets the next one finish -----------------------------------------------------
	await until("a compaction to commit memory.md", async () => existsSync(join(HOME, "memory.md")), 20_000);
	assert.equal(readMemory(HOME)!.permanent, "Someone here asked about the weather.");
	pass("a quiet spell long enough lets the speculative compaction commit; memory.md written");

	// --- a tool call in the background ------------------------------------------------------------
	const t0 = Date.now();
	r = await chat("what's the weather tomorrow?");
	const firstMs = Date.now() - t0;
	assert.equal(r.body.choices[0].message.content, "Let me check.");
	assert.equal(r.body.persona.followup, true, "the response says more is coming");
	assert.ok(firstMs < WEATHER_DELAY_MS + 500, `the first reply did not wait for the tool (${firstMs} ms)`);
	await until("the follow-up", async () => followups.length > 0, 10_000);
	assert.equal(followups[0].choices[0].message.content, "Tomorrow looks like light rain.");
	assert.equal(followups[0].persona.turn, r.body.persona.turn);
	const polled = (await (await fetch(`${base}/persona/followups?after=0`, { headers: auth })).json()) as any;
	assert.equal(polled.followups.length, 1, "also available by polling");
	pass("tool call: immediate acknowledgement, the answer as a follow-up on /persona/events");

	// --- a tool call with nothing said first: a fast tool still gives one reply ---------------------------
	r = await chat("check the weather quietly");
	assert.equal(r.body.choices[0].message.content, "Tomorrow looks like light rain.", "waited for the tool, one complete reply");
	assert.equal(r.body.persona.followup, false, "the reply IS the answer: nothing more is coming");
	pass("tool call without a word first: the server waits for it and replies once");

	// --- a new message while the tool still runs is steered in, not refused ----------------------------
	r = await chat("what's the weather tomorrow?");
	assert.equal(r.body.persona.followup, true);
	const again = await chat("hello again");
	assert.equal(again.status, 200);
	assert.match(again.body.choices[0].message.content, /you said: .*hello again/, "answered after the tool, in the same run");
	await until("the run to settle", async () => !(await status()).busy, 10_000);
	pass("a message during a running tool is steered into the run and answered");

	// --- streaming, and silence ---------------------------------------------------------------------------
	const s = await chat("stream this please.", { stream: true });
	assert.equal(s.status, 200);
	assert.ok(s.body.includes('"chat.completion.chunk"') && s.body.trim().endsWith("data: [DONE]"), s.body.slice(0, 300));
	r = await chat("   ");
	assert.equal(r.body.choices[0].message.content, "", "nothing said: silence, session untouched");
	pass("streaming chunks; an empty message gets an empty reply");

	// --- shutdown stops pi and its llama-server -----------------------------------------------------------
	await fetch(`${base}/persona/shutdown`, { method: "POST", headers: auth });
	await until("the server to exit", async () => server.exitCode !== null, 40_000);
	const llama = await fetch(`http://127.0.0.1:${LLAMA_PORT}/health`).then(() => "up", () => "down");
	assert.equal(llama, "down", "pi stopped the llama-server it started");
	pass("shutdown: pi exits and takes its llama-server with it");
	console.log("\npersona e2e passed");
} catch (e) {
	console.error(serverOut.slice(-4000));
	throw e;
} finally {
	if (server.exitCode === null) server.kill("SIGKILL");
	weather.close();
}
