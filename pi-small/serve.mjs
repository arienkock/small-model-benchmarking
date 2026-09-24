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
 *   node serve.mjs Qwen3.6-35B-A3B-Q4_K_M --thinking off   # the model's other mode
 *
 * Thinking: a model with a `thinking` mode in roster.json starts in that mode;
 * `--thinking on|off` or PI_SMALL_THINKING overrides it, and the sampler moves
 * with it (samplers.thinking / samplers.instruct). A server already serving the
 * right model in the WRONG mode is restarted when serve.mjs started it, never
 * silently adopted.
 *
 * Verification: after every start or adopt, /props is compared against the
 * roster sampler, and a thinking-off model is sent one tiny request to confirm
 * no reasoning comes back — the failure `--reasoning-budget 0` produced on
 * three models without a word of warning. A mismatch on a server serve.mjs
 * started itself exits 3 (the server is left running, so it can be inspected);
 * on an adopted one it is a loud warning. --no-verify skips both checks.
 *
 * It builds the command line with the same buildServerArgs the plugin uses, so
 * the containerised session is served exactly what a local one would be.
 *
 * It binds 0.0.0.0 by default, not the roster's loopback: a container reaches
 * the host through host.docker.internal, which does not resolve to 127.0.0.1 on
 * the server side. That does expose the endpoint to the LAN, which is why
 * --api-key is always set. Pass --host 127.0.0.1 to keep it local.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	buildServerArgs,
	compareProps,
	ctxUsabilityWarning,
	loadRoster,
	PLUGIN_DIR,
	quoteForCmdShell,
	resolveCtxLadder,
	resolveSampler,
	resolveThinking,
	thinkingKwargs,
	thinkingOverrideWarning,
	weightsSource,
} from "./lib/roster.ts";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback) => {
	const i = argv.indexOf(name);
	return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
};
// Flags that consume the next argument, so it is not mistaken for a model name.
const VALUE_FLAGS = new Set(["--ctx", "--host", "--thinking"]);
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
// What serve.mjs started, beyond the pid: /props does not report the template
// kwargs, so the thinking mode of a live server is only knowable from here.
const STATEFILE = join(tmpdir(), `pi-small-server-${d.port}.json`);

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
	if (process.platform === "win32") {
		// Same reason as ServerManager.stop() in extensions/small.ts, and the two
		// must agree: process.kill maps to TerminateProcess, which reaches only
		// the process spawn() created. When bin is a .cmd/.bat started with
		// shell:true that process is cmd.exe, and the real server is a grandchild
		// that survives and keeps holding the port — so the next start reports
		// "already serving" and refuses to touch what looks like someone else's
		// server. taskkill /T kills the tree, which is what "stop the server we
		// started" means.
		spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
	} else {
		try {
			process.kill(pid, "SIGTERM");
		} catch {
			// already gone
		}
	}
	rmSync(PIDFILE, { force: true });
	rmSync(STATEFILE, { force: true });
	return true;
}

/** The recorded state of the server serve.mjs started, if it is still the live one. */
function ourState() {
	try {
		const st = JSON.parse(readFileSync(STATEFILE, "utf8"));
		return st && st.pid === ourPid() ? st : null;
	} catch {
		return null;
	}
}

function resolveBinary() {
	if (process.env.PI_SMALL_LLAMA_BIN) return process.env.PI_SMALL_LLAMA_BIN;
	for (const name of ["llama-server.exe", "llama-server"]) {
		const p = join(PLUGIN_DIR, "..", name);
		if (existsSync(p)) return p;
	}
	return "llama-server";
}

/**
 * Poll /health until it answers or `timeoutMs` elapses. `isAlive` reports
 * whether the process being waited on is still running; once it says no this
 * gives up immediately rather than polling a dead process for the rest of the
 * timeout. Without that, a GPU-memory crash — which happens within seconds of
 * the spawn — is indistinguishable from a slow load, and nothing fails for up
 * to PI_SMALL_START_TIMEOUT (900s). Walking a ladder of candidates multiplies
 * that across every size that also does not fit, which would make the fallback
 * below unusable. Mirrors waitHealthy in extensions/small.ts.
 */
async function waitHealthy(timeoutMs, isAlive) {
	const started = Date.now();
	while (Date.now() - started < timeoutMs) {
		if (!isAlive()) return false;
		try {
			const res = await fetch(api("/health"), { headers, signal: AbortSignal.timeout(3000) });
			if (res.status === 200) return true;
		} catch {}
		await new Promise((r) => setTimeout(r, 2000));
	}
	return false;
}

/**
 * Check the live server against what the roster asked for. Returns the exit
 * code: 0 when it matches (or --no-verify), 3 when a server serve.mjs started
 * itself does not — our own command line is then wrong, and a session on it
 * would be measuring something other than what its config says. An adopted
 * server only warns: the plugin injects the sampler per request, so the session
 * is still correct even if the server's own defaults are not.
 *
 * A function declaration, so it is hoisted; it reads `spec`, `sampler` and
 * `mode`, which are all initialised before either call site runs.
 */
async function verify({ ours, servedCtx }) {
	if (flag("--no-verify")) return 0;
	const failures = [];
	let props = null;
	try {
		const r = await fetch(api("/props"), { headers, signal: AbortSignal.timeout(5000) });
		if (r.ok) props = await r.json();
	} catch {}
	const mismatches = props ? compareProps(props, sampler, servedCtx ?? undefined) : ["could not read /props"];
	failures.push(...mismatches.map((m) => `sampler ${m}`));

	// Thinking-off must produce no reasoning. Sent WITHOUT a request-level kwarg
	// on purpose: this checks the server's own default, which is what every
	// client that does not inject the kwarg (a benchmark script, curl) will get.
	// The plugin repeats the check with the kwarg, as a session sends it.
	if (mode === "off") {
		const timeoutMs = Number(process.env.PI_SMALL_PROBE_TIMEOUT ?? 600) * 1000;
		try {
			const r = await fetch(api("/v1/chat/completions"), {
				method: "POST",
				headers,
				body: JSON.stringify({ messages: [{ role: "user", content: "Reply with exactly: OK" }], max_tokens: 32 }),
				signal: AbortSignal.timeout(timeoutMs),
			});
			const body = r.ok ? await r.json() : null;
			const reasoning = body?.choices?.[0]?.message?.reasoning_content;
			if (!body) failures.push("thinking check: no response");
			else if (reasoning) {
				failures.push(
					`thinking is OFF in the roster but the server returned ${String(reasoning).length} chars of reasoning_content — ` +
						`the template switch did not take (thinkingKwargs: ${JSON.stringify(thinkingKwargs(mode))})`,
				);
			}
		} catch (e) {
			failures.push(`thinking check failed: ${e.message}`);
		}
	}

	if (failures.length === 0) {
		console.log(`verified: live sampler matches the roster${mode === "off" ? "; thinking off confirmed (no reasoning_content)" : ""}`);
		return 0;
	}
	const label = ours ? "VERIFY FAIL" : "VERIFY WARN";
	for (const f of failures) console.error(`${label}: ${f}`);
	if (!ours) {
		console.error(`${label}: this server was not started by serve.mjs with these settings; the plugin's per-request sampler still applies to sessions.`);
		return 0;
	}
	console.error(`${label}: the server is still running — inspect it, or rerun with --restart once fixed (--no-verify to skip).`);
	return 3;
}

// ------------------------------------------------------------------ status --

const live = await current();

if (flag("--status")) {
	if (!live) {
		console.log(`nothing serving on port ${d.port}`);
	} else {
		const st = ourState();
		console.log(
			`serving ${live.alias} on port ${d.port}, ctx ${live.ctx ?? "?"}` +
				(st?.thinking ? `, thinking ${st.thinking}` : "") +
				(ourPid() ? ` (started by serve.mjs, pid ${ourPid()})` : " (not started by serve.mjs)"),
		);
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
const thinkingOverride = value("--thinking", process.env.PI_SMALL_THINKING);
const overrideWarning = thinkingOverrideWarning(spec, thinkingOverride);
if (overrideWarning) console.error(`WARNING: ${overrideWarning}`);
const mode = resolveThinking(spec, thinkingOverride);
// The FULL sampler for the active mode, from the same resolveSampler the
// plugin uses — this file once built its own object, missed two fields when
// they were added, and sent String(undefined) to llama.cpp, which then quietly
// used its own defaults.
const sampler = resolveSampler(spec, d, mode);

/**
 * What to verify at the end, and whether anything still has to be started. Set
 * by the adopt branch below (a server already serving the right model, mode and
 * size), in which case the start code is skipped.
 *
 * The script ENDS rather than calling process.exit() on both success paths. On
 * Windows, process.exit() straight after fetch() can abort node itself —
 * "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file
 * src\win\async.c" — while undici is still closing a keep-alive socket, and
 * pi-small-docker.sh then refuses to start a container on a server that was
 * fine. Setting process.exitCode and letting the event loop drain is safe.
 */
let toVerify = null;

if (live && !flag("--restart")) {
	if (live.alias === spec.alias) {
		// Matching the alias is not enough: a server left over at a different
		// context is still the wrong server. Adopting it silently is how a
		// session ends up in a window nobody asked for — and since pi clamps
		// max_tokens against that window rather than erroring, a stale small
		// one produces a session that answers with a single token and looks
		// like a bad model. Only adopt when the live context is at least what
		// we would have started it with.
		if (live.ctx && live.ctx < ctx) {
			if (!ourPid()) {
				console.error(
					`port ${d.port} is serving ${spec.alias} at ctx ${live.ctx}, smaller than the ${ctx} this roster asks ` +
						`for, and serve.mjs did not start it — refusing to kill it. Stop it yourself, or use PI_SMALL_PORT.`,
				);
				process.exit(1);
			}
			console.log(`serving ${spec.alias} at ctx ${live.ctx}, but ${ctx} was asked for — restarting ...`);
			stopOurs();
			await new Promise((r) => setTimeout(r, 2000));
		} else if (mode !== null && ourState() && ourState().thinking !== mode) {
			// Same alias, same window, other mode: a different server as far as the
			// session is concerned — the template switch and the sampler both differ.
			console.log(`serving ${spec.alias} with thinking ${ourState().thinking}, but ${mode} was asked for — restarting ...`);
			stopOurs();
			await new Promise((r) => setTimeout(r, 2000));
		} else {
			if (mode !== null && !ourState()) {
				console.log(`note: ${spec.alias} was not started by serve.mjs, so its thinking mode is unknown — verifying it instead`);
			}
			console.log(`already serving ${spec.alias} on port ${d.port} (ctx ${live.ctx ?? "?"}) — nothing to do`);
			toVerify = { ours: ourPid() !== null && ourState() !== null, servedCtx: live.ctx };
		}
	} else {
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
	}
} else if (live && flag("--restart")) {
	if (!ourPid()) {
		console.error(`refusing to restart a server serve.mjs did not start (serving "${live.alias}")`);
		process.exit(1);
	}
	stopOurs();
	await new Promise((r) => setTimeout(r, 2000));
}

const bin = resolveBinary();

if (toVerify === null) {
	const logs = process.env.PI_SMALL_LOG_DIR ?? join(PLUGIN_DIR, ".logs");
	mkdirSync(logs, { recursive: true });

	console.log(`model:   ${spec.alias}`);
	console.log(`weights: ${weightsSource(spec).description}`);
	console.log(`cache:   ${d.llamaCache ?? "(LLAMA_CACHE unset)"}`);
	console.log(`bind:    ${bindHost}:${d.port}`);
	console.log(`thinking: ${mode ?? "n/a (no thinking mode)"}`);
	console.log(
		`sampler: temp=${sampler.temp} top_p=${sampler.topP} top_k=${sampler.topK} min_p=${sampler.minP} ` +
			`repeat_penalty=${sampler.repeatPenalty} presence_penalty=${sampler.presencePenalty}`,
	);

	// Fail on a missing local file BEFORE the ladder, not inside it: the weights
	// path does not depend on the context, so every candidate would throw the same
	// way, and buildServerArgs' error would surface as an unhandled rejection with
	// a stack trace rather than something a reader can act on.
	if (spec.repo === "local" && weightsSource(spec).local === null) {
		console.error(`${spec.alias}: repo is "local" but no file matched ${spec.file} on this machine.`);
		process.exit(1);
	}

	/**
	 * One start attempt at exactly `attemptCtx`. Resolves to the pid on success,
	 * or null after cleaning up whatever it spawned.
	 */
	async function attempt(attemptCtx) {
		const args = buildServerArgs(spec, d, attemptCtx, sampler, bindHost, mode);
		const logPath = join(logs, `llama-${spec.alias}-c${attemptCtx}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
		const fd = openSync(logPath, "a");
		console.log(`log:     ${logPath}`);

		// See quoteForCmdShell: through a .cmd/.bat wrapper, cmd.exe would strip the
		// quotes from the JSON thinking switch; a native binary is spawned as-is.
		const viaShell = process.platform === "win32" && /\.(cmd|bat)$/i.test(bin);
		const child = spawn(bin, viaShell ? args.map(quoteForCmdShell) : args, {
			cwd: dirname(resolve(bin)),
			stdio: ["ignore", fd, fd],
			windowsHide: true,
			detached: true,
			// Node refuses to spawn a .cmd/.bat directly (EINVAL) unless the caller
			// opts in with shell:true — a deliberate fix for an old cmd.exe injection
			// hole. bin is normally llama-server.exe, a native binary this never
			// touches; it matters when PI_SMALL_LLAMA_BIN points at a wrapper script,
			// as test/serve-test.ts does on Windows. extensions/small.ts makes the
			// same exception, and the two must agree or the host half fails where the
			// plugin half works.
			shell: viaShell,
			env: d.llamaCache ? { ...process.env, LLAMA_CACHE: d.llamaCache } : process.env,
		});
		// Detached on purpose: this script exits, the server keeps serving the
		// container that outlives it. unref() only stops the child from holding the
		// event loop open — the exit event below is still delivered while we wait.
		child.unref();
		writeFileSync(PIDFILE, String(child.pid));
		writeFileSync(STATEFILE, JSON.stringify({ pid: child.pid, alias: spec.alias, ctx: attemptCtx, thinking: mode }));

		// Held in an object because the assignment happens in a callback.
		const exit = { info: null };
		child.on("exit", (code, signal) => { exit.info = { code, signal }; });
		child.on("error", (err) => { console.error(`failed to spawn ${bin}: ${err.message}`); });

		process.stdout.write(`waiting for the model to load at ctx ${attemptCtx} `);
		const timer = setInterval(() => process.stdout.write("."), 2000);
		const ok = await waitHealthy(Number(process.env.PI_SMALL_START_TIMEOUT ?? 900) * 1000, () => exit.info === null);
		clearInterval(timer);
		console.log();

		if (ok) return child.pid;
		console.error(
			exit.info
				? `ctx ${attemptCtx}: llama-server exited (code ${exit.info.code}, signal ${exit.info.signal}) — likely out of GPU memory at that size`
				: `ctx ${attemptCtx}: llama-server never became healthy — see ${logPath}`,
		);
		stopOurs();
		await new Promise((r) => setTimeout(r, 2000));
		return null;
	}

	// Walk the same ladder the in-process plugin walks (resolveCtxLadder): the
	// requested size first, then progressively smaller candidates. There is no way
	// to know ahead of time whether a model's weights plus its KV cache fit in the
	// VRAM that happens to be free — for the hybrid-offload models on this roster
	// the card is already near-full with weights alone — so the only test is to
	// start the server and see. Without this the container path failed outright at
	// a size the plugin would have recovered from, because serve.mjs got one shot.
	const ladder = resolveCtxLadder(spec, d, ctx);
	let started = null;
	let landedCtx = null;
	for (const candidate of ladder) {
		landedCtx = candidate;
		started = await attempt(candidate);
		if (started !== null) break;
		if (candidate !== ladder[ladder.length - 1]) console.log(`falling back to the next smaller context ...`);
	}

	if (started === null) {
		console.error(`${spec.alias} did not come up at any of ctx ${ladder.join(", ")} — giving up rather than leaving something half-started.`);
		process.exit(1);
	}

	const now = await current();
	if (now?.alias !== spec.alias) {
		// Health came from ANOTHER server on this port (ours then failed to bind):
		// 2026-09-24, a leftover MiniCPM answered for a Granite start, and the sampler
		// check passed because the two rosters' samplers are identical.
		console.error(`port ${d.port} answers as ${now?.alias ?? "nothing"}, not ${spec.alias}: another server holds the port. Stop it first.`);
		stopOurs();
		process.exit(4);
	}
	const served = now?.ctx ?? landedCtx;
	const warning = ctxUsabilityWarning(served);
	if (warning) console.error(`WARNING: ${warning}`);

	console.log(
		`ready: ${now?.alias} on port ${d.port}, ctx ${served}` +
			(landedCtx !== ctx ? ` (asked for ${ctx}; fell back — it did not fit)` : "") +
			(now?.ctx && now.ctx !== landedCtx ? ` (asked for ${landedCtx}; capped to the model's training context)` : ""),
	);
	toVerify = { ours: true, servedCtx: served };
}

process.exitCode = await verify(toVerify);
