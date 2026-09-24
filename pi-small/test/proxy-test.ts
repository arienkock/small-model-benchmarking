/**
 * proxy-test.ts — proxy.mjs against the stub server: pass-through (streaming
 * too), model switching through serve.mjs, requests held during a switch, auth.
 *
 *   node test/proxy-test.ts
 */

import assert from "node:assert";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const PORT = 8196;
const BACKEND = 8197;
const KEY = "sk-bench";
const LOGS = mkdtempSync(join(tmpdir(), "pi-small-proxy-test-"));

const stubServerPath = resolve(HERE, "stub-server.mjs");
let stubBin = stubServerPath;
if (process.platform === "win32") {
	stubBin = join(LOGS, "stub-server.cmd");
	writeFileSync(stubBin, `@echo off\r\nnode "${stubServerPath}" %*\r\n`);
}
const env = {
	...process.env,
	PI_SMALL_LLAMA_BIN: stubBin,
	PI_SMALL_PORT: String(PORT),
	PI_SMALL_BACKEND_PORT: String(BACKEND),
	PI_SMALL_LOG_DIR: LOGS,
	PI_SMALL_START_TIMEOUT: "30",
	PI_SMALL_API_KEY: KEY,
};

let passed = 0;
const pass = (what: string) => {
	passed++;
	console.log(`PASS  ${what}`);
};

const base = `http://127.0.0.1:${PORT}`;
const auth = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const status = async () => (await fetch(`${base}/pi-small/status`, { headers: auth })).json();
const chat = async (stream = false) => {
	const r = await fetch(`${base}/v1/chat/completions`, {
		method: "POST",
		headers: auth,
		body: JSON.stringify({ model: "x", stream, messages: [{ role: "user", content: "hello" }] }),
	});
	return { code: r.status, text: await r.text() };
};

async function waitFor(pred: () => Promise<boolean>, ms: number, what: string) {
	const t0 = Date.now();
	while (Date.now() - t0 < ms) {
		try {
			if (await pred()) return;
		} catch {}
		await new Promise((r) => setTimeout(r, 300));
	}
	throw new Error(`timed out waiting for ${what}`);
}

let proxy: ChildProcess | null = null;
try {
	proxy = spawn(process.execPath, [join(ROOT, "proxy.mjs"), "--host", "127.0.0.1", "--model", "Granite-4.2-3B-Q8_0"], { env, stdio: ["ignore", "inherit", "inherit"] });
	await waitFor(async () => (await status()).state === "ready", 60_000, "the proxy's first model");
	const s = await status();
	assert.equal(s.alias, "Granite-4.2-3B-Q8_0");
	assert.equal(s.thinking, "on", "the roster's thinking mode is reported");
	pass("starts the requested model behind it and reports it");

	const plain = await chat();
	assert.equal(plain.code, 200);
	assert.match(plain.text, /stub reply from Granite-4\.2-3B-Q8_0/);
	const streamed = await chat(true);
	assert.match(streamed.text, /data: /);
	assert.match(streamed.text, /\[DONE\]/);
	const models = await (await fetch(`${base}/v1/models`, { headers: auth })).json();
	assert.equal(models.data[0].id, "Granite-4.2-3B-Q8_0");
	pass("passes chat completions (plain and streaming) and /v1/models through unchanged");

	const switching = fetch(`${base}/pi-small/model`, { method: "POST", headers: auth, body: JSON.stringify({ alias: "LFM2.5-2.6B-Q8_0" }) });
	await waitFor(async () => (await status()).state === "switching", 10_000, "the switch to start");
	const during = chat(); // sent while the backend is being replaced
	const sw = await (await switching).json();
	assert.equal(sw.state, "ready");
	assert.equal(sw.alias, "LFM2.5-2.6B-Q8_0");
	const held = await during;
	assert.equal(held.code, 200, held.text);
	assert.match(held.text, /stub reply from LFM2\.5-2\.6B-Q8_0/, "a request made during the switch waits and is answered by the NEW model");
	pass("switches models through serve.mjs; a request made mid-switch waits and gets the new model");

	const same = await (await fetch(`${base}/pi-small/model`, { method: "POST", headers: auth, body: JSON.stringify({ alias: "LFM2.5-2.6B-Q8_0" }) })).json();
	assert.equal(same.alias, "LFM2.5-2.6B-Q8_0");
	pass("switching to the model already served is a no-op");

	assert.equal((await fetch(`${base}/pi-small/status`)).status, 401);
	const bad = await fetch(`${base}/pi-small/model`, { method: "POST", headers: auth, body: JSON.stringify({ alias: "No-Such-Model" }) });
	assert.equal(bad.status, 400);
	pass("management endpoints require the API key and reject unknown aliases");
} finally {
	proxy?.kill();
	spawnSync(process.execPath, [join(ROOT, "serve.mjs"), "--stop"], { env: { ...env, PI_SMALL_PORT: String(BACKEND) }, stdio: "ignore" });
}
console.log(`\n${passed} proxy checks passed. Logs: ${LOGS}`);
