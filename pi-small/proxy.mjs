#!/usr/bin/env node
/**
 * proxy.mjs — the host side of a containerised pi-small that can switch models.
 *
 *   node proxy.mjs                          # listen on the roster port (8123); serve the roster default
 *   node proxy.mjs --model Granite-4.2-3B-Q8_0
 *   node proxy.mjs --model X --thinking off
 *   PI_SMALL_BACKEND_PORT=8125 node proxy.mjs
 *
 * llama-server and the GPU are on the host; pi-small runs in a container and
 * cannot start, stop or switch them. serve.mjs fixes the model at launch. This
 * proxy stays up and lets the container change it:
 *
 *   every OpenAI route   passed through unchanged to llama-server, which it
 *                        runs on a loopback-only backend port (default 8125)
 *   GET  /pi-small/status        { alias, thinking, ctx, state, backendPort }
 *   POST /pi-small/model         { alias, thinking? } -> switch, then the status
 *
 * Switching reuses serve.mjs — same command line, same context ladder, same
 * sampler and thinking verification, same refusal to kill a server it did not
 * start — pointed at the backend port. While a switch runs, pass-through
 * requests wait for it (up to PI_SMALL_PROXY_WAIT seconds, default 900) instead
 * of hitting a half-started server. The plugin's remote mode finds the proxy
 * through /pi-small/status and uses it for /sm-model and for the workflow's
 * model rotation, so pi never has to exit to change models.
 *
 * It binds 0.0.0.0 (the container reaches the host as host.docker.internal) and
 * requires the API key on every request, as llama-server does.
 */

import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadRoster } from "./lib/roster.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const value = (name, fallback) => {
	const i = argv.indexOf(name);
	return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};

const roster = loadRoster();
const port = Number(process.env.PI_SMALL_PORT ?? roster.defaults.port);
const backendPort = Number(process.env.PI_SMALL_BACKEND_PORT ?? 8125);
const apiKey = process.env.PI_SMALL_API_KEY ?? roster.defaults.apiKey;
const bindHost = value("--host", process.env.PI_SMALL_BIND ?? "0.0.0.0");
const waitMs = Number(process.env.PI_SMALL_PROXY_WAIT ?? 900) * 1000;

const log = (msg) => console.log(`[proxy ${new Date().toISOString().slice(11, 19)}] ${msg}`);

/** What the backend is doing. `switching` holds requests; `down` fails them. */
const status = { alias: null, thinking: null, ctx: null, state: "down", error: null, backendPort };
let switching = null; // Promise while a switch runs

async function readBackend() {
	const h = { Authorization: `Bearer ${apiKey}` };
	try {
		const m = await fetch(`http://127.0.0.1:${backendPort}/v1/models`, { headers: h, signal: AbortSignal.timeout(3000) });
		if (!m.ok) return null;
		const alias = (await m.json())?.data?.[0]?.id ?? null;
		let ctx = null;
		try {
			const p = await fetch(`http://127.0.0.1:${backendPort}/props`, { headers: h, signal: AbortSignal.timeout(3000) });
			if (p.ok) ctx = (await p.json())?.default_generation_settings?.n_ctx ?? null;
		} catch {}
		return { alias, ctx };
	} catch {
		return null;
	}
}

/** Run serve.mjs against the backend port. Resolves with its exit code and output tail. */
function runServe(args) {
	return new Promise((resolve) => {
		const p = spawn(process.execPath, [join(HERE, "serve.mjs"), ...args, "--host", "127.0.0.1"], {
			env: { ...process.env, PI_SMALL_PORT: String(backendPort), PI_SMALL_API_KEY: apiKey },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let out = "";
		const keep = (d) => {
			out += d;
			process.stdout.write(d);
		};
		p.stdout.on("data", keep);
		p.stderr.on("data", keep);
		p.on("close", (code) => resolve({ code, tail: out.trim().split("\n").slice(-12).join("\n") }));
	});
}

/** Switch the backend to `alias` (optionally in a thinking mode). Serialised: one switch at a time. */
async function switchTo(alias, thinking) {
	while (switching) await switching.catch(() => {});
	if (status.state === "ready" && status.alias === alias && (!thinking || status.thinking === thinking)) return status;
	status.state = "switching";
	status.error = null;
	log(`switching to ${alias}${thinking ? ` (thinking ${thinking})` : ""} …`);
	switching = (async () => {
		const r = await runServe([alias, ...(thinking ? ["--thinking", thinking] : [])]);
		const live = await readBackend();
		if (r.code !== 0 || !live || live.alias !== alias) {
			status.state = live ? "ready" : "down";
			Object.assign(status, live ?? { alias: null, ctx: null });
			status.error = `serve.mjs ${alias} exited ${r.code}: ${r.tail}`;
			log(`switch to ${alias} FAILED (exit ${r.code})`);
			throw new Error(status.error);
		}
		Object.assign(status, { alias: live.alias, ctx: live.ctx, thinking: thinking ?? roster.models.find((m) => m.alias === alias)?.thinking ?? null, state: "ready" });
		log(`serving ${alias} (ctx ${live.ctx})`);
	})();
	try {
		await switching;
	} finally {
		switching = null;
	}
	return status;
}

function json(res, code, body) {
	const text = JSON.stringify(body);
	res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
	res.end(text);
}

const authorised = (req) => (req.headers.authorization ?? "") === `Bearer ${apiKey}`;

async function readBody(req) {
	const chunks = [];
	for await (const c of req) chunks.push(c);
	return Buffer.concat(chunks);
}

/** Pass a request through to llama-server, streaming both ways (SSE included). */
async function passThrough(req, res) {
	if (switching) await Promise.race([switching.catch(() => {}), new Promise((r) => setTimeout(r, waitMs))]);
	if (status.state !== "ready") {
		// Maybe someone started the backend by hand; look once before failing.
		const live = await readBackend();
		if (live) Object.assign(status, { ...live, state: "ready" });
		else return json(res, 503, { error: { message: `pi-small proxy: no model is being served (${status.state})${status.error ? `: ${status.error}` : ""}` } });
	}
	const body = await readBody(req);
	const up = httpRequest(
		{ host: "127.0.0.1", port: backendPort, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${backendPort}` } },
		(upRes) => {
			res.writeHead(upRes.statusCode ?? 502, upRes.headers);
			upRes.pipe(res);
		},
	);
	up.on("error", (e) => {
		if (!res.headersSent) json(res, 502, { error: { message: `pi-small proxy: backend error: ${e.message}` } });
		else res.end();
	});
	// A client that goes away (pi aborting a session) cancels the backend request too.
	res.on("close", () => {
		if (!res.writableFinished) up.destroy();
	});
	up.end(body);
}

createServer(async (req, res) => {
	try {
		const url = new URL(req.url, "http://proxy");
		if (url.pathname.startsWith("/pi-small/")) {
			if (!authorised(req)) return json(res, 401, { error: "missing or wrong API key" });
			if (req.method === "GET" && url.pathname === "/pi-small/status") {
				if (status.state !== "switching") {
					const live = await readBackend();
					Object.assign(status, live ? { ...live, state: "ready" } : { state: "down" });
				}
				return json(res, 200, status);
			}
			if (req.method === "POST" && url.pathname === "/pi-small/model") {
				let body;
				try {
					body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
				} catch {
					return json(res, 400, { error: "body must be JSON" });
				}
				if (!body.alias || !roster.models.some((m) => m.alias === body.alias)) {
					return json(res, 400, { error: `unknown roster alias ${JSON.stringify(body.alias)}` });
				}
				try {
					return json(res, 200, await switchTo(body.alias, body.thinking));
				} catch (e) {
					return json(res, 500, { ...status, error: e.message });
				}
			}
			return json(res, 404, { error: "unknown pi-small endpoint" });
		}
		return await passThrough(req, res);
	} catch (e) {
		if (!res.headersSent) json(res, 500, { error: { message: `pi-small proxy: ${e.message}` } });
	}
}).listen(port, bindHost, async () => {
	log(`listening on ${bindHost}:${port}, llama-server on 127.0.0.1:${backendPort}`);
	const live = await readBackend();
	if (live) Object.assign(status, { ...live, state: "ready" });
	const first = value("--model", undefined);
	if (first) {
		try {
			await switchTo(first, value("--thinking", undefined));
		} catch (e) {
			log(`initial model failed: ${e.message}`);
		}
	}
});

for (const sig of ["SIGTERM", "SIGINT"]) {
	process.on(sig, () => {
		log(`${sig}: exiting (llama-server keeps running; stop it with PI_SMALL_PORT=${backendPort} node serve.mjs --stop)`);
		process.exit(0);
	});
}
