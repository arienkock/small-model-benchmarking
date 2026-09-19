/**
 * plugin-test.ts — drives the pi-small plugin against the stub server with a
 * fake ExtensionAPI, so the parts that are expensive to reach through the TUI
 * (switching models, resizing the context, refusing to kill a foreign server)
 * are checked without a GPU.
 *
 *   node test/plugin-test.ts
 */

import assert from "node:assert";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = 8199;
const LOGS = mkdtempSync(join(tmpdir(), "pi-small-test-"));

process.env.PI_SMALL_PORT = String(PORT);
process.env.PI_SMALL_LLAMA_BIN = resolve(HERE, "stub-server.mjs");
process.env.PI_SMALL_LOG_DIR = LOGS;
process.env.PI_SMALL_START_TIMEOUT = "30";

// ------------------------------------------------------------ fake pi API ---

interface Recorded {
	providers: Array<{ name: string; cfg: any }>;
	tools: any[];
	commands: Map<string, any>;
	handlers: Map<string, any>;
	activeTools: string[];
	model: any;
	notices: string[];
}

function fakePi() {
	const rec: Recorded = {
		providers: [],
		tools: [],
		commands: new Map(),
		handlers: new Map(),
		activeTools: [],
		model: null,
		notices: [],
	};
	const pi = {
		registerProvider: (name: string, cfg: any) => rec.providers.push({ name, cfg }),
		unregisterProvider: () => {},
		registerTool: (t: any) => rec.tools.push(t),
		registerCommand: (name: string, opts: any) => rec.commands.set(name, opts),
		on: (evt: string, h: any) => rec.handlers.set(evt, h),
		setActiveTools: (names: string[]) => {
			rec.activeTools = names;
		},
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
	};
	return { pi, ctx, rec };
}

// ---------------------------------------------------------------- helpers ---

const lastProvider = (rec: Recorded) => rec.providers[rec.providers.length - 1].cfg;
const logCount = () => readdirSync(LOGS).length;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

const results: string[] = [];
function pass(name: string) {
	results.push(`PASS  ${name}`);
	console.log(`PASS  ${name}`);
}

// ------------------------------------------------------------------- run ---

const { default: createExtension } = await import("../extensions/small.ts");
const { pi, ctx, rec } = fakePi();
createExtension(pi as any);

// --- registration happens during the factory, before any server exists -----
assert.equal(rec.providers.length, 1, "provider registered during factory");
assert.equal(rec.providers[0].name, "small-local");
assert.equal(rec.tools.length, 1, "exactly one tool registered");
assert.equal(rec.tools[0].name, "bash", "the one tool is bash");
pass("factory registers the provider and exactly one tool (bash)");

// --- session_start brings the server up -----------------------------------
await rec.handlers.get("session_start")({}, ctx);
assert.equal(await servedAlias(), "Spark-X2.5-4B-Q6_K", "stub is serving the default model");
assert.deepEqual(rec.activeTools, ["bash"], "active tools locked to bash");
assert.equal(lastProvider(rec).models[0].id, "Spark-X2.5-4B-Q6_K");
assert.equal(lastProvider(rec).models[0].contextWindow, 16384);
assert.equal(lastProvider(rec).models[0].maxTokens, 8192, "maxTokens is half the window, capped at 8192");
assert.equal(rec.model.id, "Spark-X2.5-4B-Q6_K", "session model set");
assert.ok(
	rec.notices.some((n) => n.includes("probes OK")),
	`probes should pass against the stub; notices were: ${rec.notices.join(" | ")}`,
);
pass("session_start starts llama-server, probes it, and points the session at it");

// --- temperature: no restart ----------------------------------------------
const beforeRequest = rec.handlers.get("before_provider_request");
assert.equal(beforeRequest({ payload: { messages: [] } }).temperature, 0.7);
const logsBefore = logCount();
await rec.commands.get("sm-temp").handler("0.25", ctx);
assert.equal(beforeRequest({ payload: { messages: [] } }).temperature, 0.25, "temp applies to the next request");
assert.equal(beforeRequest({ payload: { messages: [] } }).top_p, 0.95, "top_p still injected");
assert.equal(logCount(), logsBefore, "changing temperature must NOT restart the server");
pass("/sm-temp changes the next request and does not restart the server");

// --- model switch: restart, re-register, keep the sampler ------------------
await rec.commands.get("sm-model").handler("Granite-4.2-3B-Q8_0", ctx);
assert.equal(await servedAlias(), "Granite-4.2-3B-Q8_0", "stub now serves Granite");
assert.equal(lastProvider(rec).models[0].id, "Granite-4.2-3B-Q8_0", "provider re-registered for the new model");
assert.equal(rec.model.id, "Granite-4.2-3B-Q8_0", "session model followed the switch");
assert.equal(beforeRequest({ payload: {} }).temperature, 0.25, "sampler settings survive a model switch");
assert.ok(logCount() > logsBefore, "a switch starts a new server (new log file)");
pass("/sm-model restarts the server, re-registers the provider, keeps the sampler");

// --- context switch, including llama-server capping it ---------------------
process.env.PI_SMALL_STUB_REPORT_CTX = "4096";
await rec.commands.get("sm-ctx").handler("8192", ctx);
assert.equal(
	lastProvider(rec).models[0].contextWindow,
	4096,
	"the provider must use the context the SERVER reports, not the one we asked for",
);
assert.equal(lastProvider(rec).models[0].maxTokens, 2048, "maxTokens follows the real window");
assert.ok(
	rec.notices.some((n) => n.includes("actually serves 4096")),
	"the cap is reported, not swallowed",
);
delete process.env.PI_SMALL_STUB_REPORT_CTX;
pass("/sm-ctx restarts at the new size and believes the server about what it got");

// --- a server we did not start is never killed -----------------------------
await rec.handlers.get("session_shutdown")({}, ctx);
assert.equal(await servedAlias(), null, "session_shutdown stopped our server");
pass("session_shutdown stops the server we started");

const foreign: ChildProcess = spawn(
	process.env.PI_SMALL_LLAMA_BIN!,
	["--alias", "SomeoneElsesBenchRun", "-c", "16384", "--port", String(PORT), "--host", "127.0.0.1"],
	{ stdio: "ignore" },
);
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
foreign.kill("SIGKILL");
await sleep(500);
const ours: ChildProcess = spawn(
	process.env.PI_SMALL_LLAMA_BIN!,
	["--alias", "Spark-X2.5-4B-Q6_K", "-c", "16384", "--port", String(PORT), "--host", "127.0.0.1"],
	{ stdio: "ignore" },
);
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
ours.kill("SIGKILL");
pass("a server already serving the wanted model is adopted and not killed on exit");

console.log(`\n${results.length} checks passed. Logs: ${LOGS}`);
process.exit(0);
