#!/usr/bin/env node
/**
 * serve.mjs — start llama-server on the HOST for a containerised pi-small.
 *
 * When pi-small runs locally the plugin does this itself. When it runs in a
 * container it cannot: llama-server.exe and the GPU are on the Windows host,
 * and the container only has an HTTP route to them. This is the host half.
 *
 *   node serve.mjs                      # the roster default
 *   node serve.mjs Granite-4.2-3B-Q8_0  # a specific model
 *   node serve.mjs LFM2.5-2.6B-Q8_0 --ctx 8192
 *   node serve.mjs --restart            # reload the current model
 *   node serve.mjs --stop               # stop the server we started
 *   node serve.mjs --status             # what is serving right now
 *
 * It builds the command line with the same buildServerArgs the plugin uses, so
 * the containerised session is served exactly what a local one would be.
 *
 * It binds 0.0.0.0 by default, not the roster's loopback: a container reaches
 * the host through host.docker.internal, which does not resolve to 127.0.0.1 on
 * the server side. That does expose the endpoint to the LAN, which is why
 * --api-key is always set. Pass --host 127.0.0.1 to keep it local.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { buildServerArgs, loadRoster, PLUGIN_DIR, weightsSource } from "./lib/roster.ts";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
	const i = argv.indexOf(name);
	return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
// Flags that consume the next argument, so it is not mistaken for a model name.
const VALUE_FLAGS = new Set(["--ctx", "--host"]);
const positional = [];
for (let i = 0; i < argv.length; i++) {
	const a = argv[i];
	if (a.startsWith("--")) {
		if (VALUE_FLAGS.has(a)) i++;
		continue;
	}
	positional.push(a);
}

const roster = loadRoster();
const d = {
	...roster.defaults,
	port: Number(process.env.PI_SMALL_PORT ?? roster.defaults.port),
	apiKey: process.env.PI_SMALL_API_KEY ?? roster.defaults.apiKey,
	llamaCache: process.env.LLAMA_CACHE ?? roster.defaults.llamaCache,
};
const bindHost = value("--host", process.env.PI_SMALL_BIND ?? "0.0.0.0");
const PIDFILE = join(tmpdir(), `pi-small-server-${d.port}.pid`);

const api = (p) => `http://127.0.0.1:${d.port}${p}`;
const headers = { Authorization: `Bearer ${d.apiKey}`, "Content-Type": "application/json" };

async function current() {
	try {
		const res = await fetch(api("/v1/models"), { headers, signal: AbortSignal.timeout(3000) });
		if (!res.ok) return null;
		const body = await res.json();
		const alias = body?.data?.[0]?.id ?? null;
		let ctx = null;
		try {
			const p = await fetch(api("/props"), { headers, signal: AbortSignal.timeout(3000) });
			if (p.ok) ctx = (await p.json())?.default_generation_settings?.n_ctx ?? null;
		} catch {}
		return { alias, ctx };
	} catch {
		return null;
	}
}

function ourPid() {
	try {
		const pid = Number(readFileSync(PIDFILE, "utf8").trim());
		return Number.isFinite(pid) && pid > 0 ? pid : null;
	} catch {
		return null;
	}
}

function stopOurs() {
	const pid = ourPid();
	if (pid === null) return false;
	try {
		process.kill(pid, "SIGTERM");
	} catch {
		// already gone
	}
	rmSync(PIDFILE, { force: true });
	return true;
}

function resolveBinary() {
	if (process.env.PI_SMALL_LLAMA_BIN) return process.env.PI_SMALL_LLAMA_BIN;
	for (const name of ["llama-server.exe", "llama-server"]) {
		const p = join(PLUGIN_DIR, "..", name);
		if (existsSync(p)) return p;
	}
	return "llama-server";
}

async function waitHealthy(timeoutMs) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		try {
			const res = await fetch(api("/health"), { headers, signal: AbortSignal.timeout(3000) });
			if (res.status === 200) return true;
		} catch {}
		await new Promise((r) => setTimeout(r, 2000));
	}
	return false;
}

// ------------------------------------------------------------------ status --

const live = await current();

if (flag("--status")) {
	if (!live) {
		console.log(`nothing serving on port ${d.port}`);
	} else {
		console.log(`serving ${live.alias} on port ${d.port}, ctx ${live.ctx ?? "?"}` + (ourPid() ? ` (started by serve.mjs, pid ${ourPid()})` : " (not started by serve.mjs)"));
	}
	process.exit(0);
}

if (flag("--stop")) {
	if (!live) {
		console.log("nothing to stop");
		process.exit(0);
	}
	if (!stopOurs()) {
		console.error(
			`a server is running on port ${d.port} but serve.mjs did not start it — refusing to kill it. ` +
				`A benchmark run may own it.`,
		);
		process.exit(1);
	}
	console.log("stopped");
	process.exit(0);
}

// ------------------------------------------------------------------- start --

const wanted = positional[0] ?? process.env.PI_SMALL_MODEL ?? live?.alias;
const spec = wanted
	? roster.models.find((m) => m.alias === wanted)
	: roster.models.find((m) => m.default) ?? roster.models[0];

if (!spec) {
	console.error(`unknown model "${wanted}". Roster: ${roster.models.map((m) => m.alias).join(", ")}`);
	process.exit(1);
}

const ctx = Number(value("--ctx", spec.ctx ?? d.ctx));

if (live && !flag("--restart")) {
	if (live.alias === spec.alias) {
		console.log(`already serving ${spec.alias} on port ${d.port} (ctx ${live.ctx ?? "?"}) — nothing to do`);
		process.exit(0);
	}
	if (!ourPid()) {
		console.error(
			`port ${d.port} is serving "${live.alias}" and serve.mjs did not start it — refusing to kill it. ` +
				`A benchmark run may own it. Stop it yourself, or use PI_SMALL_PORT.`,
		);
		process.exit(1);
	}
	console.log(`switching from ${live.alias} to ${spec.alias} ...`);
	stopOurs();
	await new Promise((r) => setTimeout(r, 2000));
} else if (live && flag("--restart")) {
	if (!ourPid()) {
		console.error(`refusing to restart a server serve.mjs did not start (serving "${live.alias}")`);
		process.exit(1);
	}
	stopOurs();
	await new Promise((r) => setTimeout(r, 2000));
}

const sampler = { temp: spec.temp ?? d.temp, topP: spec.topP ?? d.topP, topK: spec.topK ?? d.topK };
const args = buildServerArgs(spec, d, ctx, sampler, bindHost);
const bin = resolveBinary();

const logs = process.env.PI_SMALL_LOG_DIR ?? join(PLUGIN_DIR, ".logs");
mkdirSync(logs, { recursive: true });
const logPath = join(logs, `llama-${spec.alias}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
const fd = openSync(logPath, "a");

console.log(`model:   ${spec.alias}`);
console.log(`weights: ${weightsSource(spec).description}`);
console.log(`cache:   ${d.llamaCache ?? "(LLAMA_CACHE unset)"}`);
console.log(`bind:    ${bindHost}:${d.port}`);
console.log(`log:     ${logPath}`);

const child = spawn(bin, args, {
	cwd: dirname(resolve(bin)),
	stdio: ["ignore", fd, fd],
	windowsHide: true,
	detached: true,
	env: d.llamaCache ? { ...process.env, LLAMA_CACHE: d.llamaCache } : process.env,
});
// Detached on purpose: this script exits, the server keeps serving the
// container that outlives it.
child.unref();
writeFileSync(PIDFILE, String(child.pid));

process.stdout.write("waiting for the model to load ");
const timer = setInterval(() => process.stdout.write("."), 2000);
const ok = await waitHealthy(Number(process.env.PI_SMALL_START_TIMEOUT ?? 900) * 1000);
clearInterval(timer);
console.log();

if (!ok) {
	console.error(`llama-server did not become healthy — see ${logPath}`);
	stopOurs();
	process.exit(1);
}

const now = await current();
console.log(`ready: ${now?.alias} on port ${d.port}, ctx ${now?.ctx ?? ctx}${now?.ctx && now.ctx !== ctx ? ` (asked for ${ctx}; capped to the model's training context)` : ""}`);
