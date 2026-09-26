#!/usr/bin/env node
/**
 * persona/server.mjs — the persona's OpenAI-compatible front end. See DESIGN.md.
 *
 *   PERSONA_API_KEY=... node persona/server.mjs
 *
 * It runs one long-lived `bin/sm-persona --mode rpc` child (pi + the pi-small
 * plugin in persona mode) and turns single OpenAI chat requests into turns of
 * that ONE conversation. It holds no conversation state of its own: pi's
 * session file does, and the plugin owns the prompt, the memory and the
 * model.
 *
 *   POST /v1/chat/completions   the LAST user message is the turn; everything
 *                               else in the request is ignored. stream or not.
 *   GET  /v1/models             one entry, "sm-persona"
 *   GET  /health                200 once the model is loaded and answering
 *   GET  /persona/status        model, context use, compaction, queue, follow-ups
 *   GET  /persona/events        Server-Sent Events: every follow-up message
 *   GET  /persona/followups?after=<n>   the same, polled
 *   POST /persona/compact       compact now (runs to completion)
 *   POST /persona/shutdown      stop the child (and so its llama-server), then exit
 *
 * What it adds on top of pi:
 *
 *   Replies that come later. A turn's HTTP response is the text of the FIRST
 *   assistant message, sent as soon as it ends. When the model called a tool,
 *   the answer after it is a follow-up, delivered on /persona/events, to
 *   PERSONA_FOLLOWUP_URL, and to /persona/followups. The response then carries
 *   `persona: { followup: true, turn }`, which OpenAI clients ignore.
 *
 *   Speculative compaction. After a turn settles with the context above
 *   PERSONA_COMPACT_AT percent, a compaction starts in the background. A request
 *   that arrives meanwhile aborts it (pi discards an aborted compaction) and
 *   the next settled turn starts it again, so it only lands after a quiet
 *   spell long enough to finish.
 *
 *   Speech-safe text. Replies pass through sanitizeSpeech (lib/persona.ts):
 *   markup removed, no word changed.
 *
 *   Cancelled requests cancel the turn. A client that disconnects before its
 *   reply (the speaker interrupted, the speech server gave up) aborts the
 *   generation, so the model never "remembers" saying something nobody heard
 *   and the next message does not queue behind it. The same on PERSONA_WAIT.
 *
 *   A warm model while idle. On Windows, every PERSONA_KEEPWARM seconds without a
 *   turn, persona/keepwarm.exe reads through llama-server's memory, so Windows
 *   does not page the model out between conversations (the first turn after a
 *   quiet spell was 3-5x slower, and paging the whole model back in took 129 s).
 *   It also raises llama-server to normal (memory) priority: the scheduled
 *   task's priority 7 made it below normal. It never touches llama-server's
 *   state. start.sh builds keepwarm.exe from keepwarm.cs.
 *
 *   Failing loudly. When the model cannot answer (llama-server down, a model
 *   error), the request gets an HTTP error with a readable message, never an
 *   empty 200 that a speech client would play as silence. pi's own retries
 *   (2 s, 4 s, 8 s) are switched off: for speech, an answer 14 s late is worse
 *   than a prompt error the client can say something about.
 *
 * Env (all optional except the key):
 *   PERSONA_API_KEY           bearer key for every route but /health (required)
 *   PERSONA_PORT / _BIND      8130 / 0.0.0.0
 *   PERSONA_COMPACT_AT        soft threshold, percent of context (60)
 *   PERSONA_IDLE_COMPACT      seconds of silence that also start one (0 = off)
 *   PERSONA_WAIT              seconds a request may wait for its turn (120)
 *   PERSONA_FIRST_REPLY_WAIT  seconds to wait for a tool when the model said nothing first (8)
 *   PERSONA_FOLLOWUP_TTL      seconds after the question a follow-up is still worth saying (120)
 *   PERSONA_FOLLOWUP_URL      webhook for follow-ups
 *   PERSONA_KEEPWARM          seconds between keep-warm passes while idle (60; 0 = off)
 *   PERSONA_CHILD             command for the child, space-separated (tests)
 *   PI_SMALL_PERSONA_HOME     logs go to <home>/logs
 */

import { execFile, spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { personaHome, sanitizeSpeech } from "../lib/persona.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const num = (name, dflt) => (env[name] === undefined || env[name] === "" ? dflt : Number(env[name]));

const API_KEY = env.PERSONA_API_KEY;
const PORT = num("PERSONA_PORT", 8130);
const BIND = env.PERSONA_BIND ?? "0.0.0.0";
const COMPACT_AT = num("PERSONA_COMPACT_AT", 60);
const IDLE_COMPACT_S = num("PERSONA_IDLE_COMPACT", 0);
const WAIT_MS = num("PERSONA_WAIT", 120) * 1000;
const FIRST_REPLY_WAIT_MS = num("PERSONA_FIRST_REPLY_WAIT", 8) * 1000;
const FOLLOWUP_TTL_MS = num("PERSONA_FOLLOWUP_TTL", 120) * 1000;
const FOLLOWUP_URL = env.PERSONA_FOLLOWUP_URL;
const KEEPWARM_S = num("PERSONA_KEEPWARM", 60);
const HOME = personaHome();
const LOG_DIR = join(HOME, "logs");

if (!API_KEY) {
	console.error("persona server: PERSONA_API_KEY is required — this listens on the LAN");
	process.exit(2);
}
mkdirSync(LOG_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const logPath = join(LOG_DIR, `server-${stamp}.jsonl`);
const childLogPath = join(LOG_DIR, `pi-rpc-${stamp}.log`);
const log = (rec) => {
	const line = JSON.stringify({ ts: new Date().toISOString(), ...rec });
	try {
		appendFileSync(logPath, line + "\n");
	} catch {}
	if (rec.type !== "request" && rec.type !== "followup") console.log(`[persona] ${line}`);
};

// ------------------------------------------------------------ the pi child --

/**
 * One pi process in RPC mode: JSON lines on stdin/stdout, split on "\n" only
 * (pi's docs: Node's readline also splits on U+2028/2029, which are valid in
 * JSON strings). Restarted with backoff when it dies, up to 5 times an hour.
 */
class Pi {
	proc = null;
	buf = "";
	seq = 0;
	pending = new Map();
	listeners = new Set();
	/** loading | ready | down | stopped */
	state = "down";
	lastNotice = "";
	model = null;
	restarts = [];

	start() {
		const cmd = env.PERSONA_CHILD ? env.PERSONA_CHILD.split(" ") : ["bash", join(HERE, "..", "bin", "sm-persona"), "--mode", "rpc"];
		this.state = "loading";
		this.proc = spawn(cmd[0], cmd.slice(1), { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
		const proc = this.proc;
		proc.stdout.setEncoding("utf8");
		proc.stdout.on("data", (chunk) => this.onData(chunk));
		proc.stderr.on("data", (chunk) => {
			try {
				appendFileSync(childLogPath, chunk);
			} catch {}
		});
		proc.on("exit", (code, signal) => {
			if (this.proc !== proc) return;
			this.proc = null;
			for (const { reject } of this.pending.values()) reject(new Error("pi exited"));
			this.pending.clear();
			this.emit({ type: "_exit" });
			if (this.state === "stopped") return;
			this.state = "down";
			log({ type: "child_exit", code, signal });
			const hour = Date.now() - 3600_000;
			this.restarts = this.restarts.filter((t) => t > hour);
			if (this.restarts.length >= 5) {
				log({ type: "child_gave_up", why: "5 restarts in an hour", childLog: childLogPath });
				return;
			}
			this.restarts.push(Date.now());
			setTimeout(() => this.start(), 5000 * this.restarts.length);
		});
		log({ type: "child_start", cmd: cmd.join(" "), childLog: childLogPath });
	}

	onData(chunk) {
		this.buf += chunk;
		let i;
		while ((i = this.buf.indexOf("\n")) >= 0) {
			const line = this.buf.slice(0, i).replace(/\r$/, "");
			this.buf = this.buf.slice(i + 1);
			if (!line.trim()) continue;
			let msg;
			try {
				msg = JSON.parse(line);
			} catch {
				continue;
			}
			if (msg.type === "response" && msg.id && this.pending.has(msg.id)) {
				const p = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.success === false ? p.reject(new Error(msg.error ?? `${msg.command} failed`)) : p.resolve(msg.data);
				continue;
			}
			if (msg.type === "extension_ui_request") {
				if (msg.method === "notify") this.onNotice(String(msg.message ?? ""), msg.notifyType);
				continue; // dialogs are never answered: the persona plugin opens none
			}
			this.emit(msg);
		}
	}

	/** The plugin reports readiness and failures as notices. */
	onNotice(text, level) {
		this.lastNotice = text;
		const ready = /pi-small: (\S+) ready at ctx (\d+)/.exec(text);
		if (ready) {
			this.state = "ready";
			this.model = { alias: ready[1], ctx: Number(ready[2]) };
			this.send({ type: "set_auto_retry", enabled: false }).catch((e) => log({ type: "set_auto_retry_failed", error: e.message }));
		}
		if (level === "error" || level === "warning" || ready || /memory|compaction/.test(text)) log({ type: "notice", level: level ?? "info", text });
	}

	send(cmd, timeoutMs = 60_000) {
		if (!this.proc) return Promise.reject(new Error("pi is not running"));
		const id = `s${++this.seq}`;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`${cmd.type}: no response in ${timeoutMs / 1000}s`));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (v) => (clearTimeout(timer), resolve(v)),
				reject: (e) => (clearTimeout(timer), reject(e)),
			});
			this.proc.stdin.write(JSON.stringify({ ...cmd, id }) + "\n");
		});
	}

	on(fn) {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	emit(msg) {
		for (const fn of [...this.listeners]) fn(msg);
	}

	async stop() {
		this.state = "stopped";
		const proc = this.proc;
		if (!proc) return;
		try {
			await this.send({ type: "abort" }, 10_000);
		} catch {}
		proc.stdin.end(); // pi shuts down, and the plugin stops its llama-server
		const exited = await Promise.race([new Promise((r) => proc.once("exit", () => r(true))), new Promise((r) => setTimeout(() => r(false), 30_000))]);
		if (!exited) {
			log({ type: "child_kill", why: "did not exit 30 s after stdin closed" });
			if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
			else proc.kill("SIGKILL");
		}
	}
}

const pi = new Pi();

// ------------------------------------------------------------ follow-ups --

const followups = []; // ring buffer for polling
let followupSeq = 0;
const sseClients = new Set();

function completion(text, extra = {}) {
	return {
		id: `chatcmpl-persona-${Date.now()}`,
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: "sm-persona",
		choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
		...extra,
	};
}

function deliverFollowup(turn, text) {
	const age = Date.now() - turn.startedAt;
	if (age > FOLLOWUP_TTL_MS) {
		log({ type: "followup_dropped", turn: turn.id, ageMs: age, chars: text.length });
		return;
	}
	const n = ++followupSeq;
	const body = completion(text, { persona: { kind: "followup", turn: turn.id, seq: n } });
	followups.push({ seq: n, at: Date.now(), body });
	while (followups.length > 20 || (followups.length && Date.now() - followups[0].at > FOLLOWUP_TTL_MS)) followups.shift();
	for (const res of sseClients) res.write(`id: ${n}\nevent: followup\ndata: ${JSON.stringify(body)}\n\n`);
	if (FOLLOWUP_URL) {
		fetch(FOLLOWUP_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) }).catch((e) =>
			log({ type: "webhook_failed", error: e.message }),
		);
	}
	log({ type: "followup", turn: turn.id, seq: n, ageMs: age, chars: text.length, sse: sseClients.size });
}

// ----------------------------------------------------------------- turns --

/**
 * A turn: one user message and everything the agent says until it settles.
 * `first` resolves with the text of the first assistant message (the HTTP
 * reply); later assistant text becomes follow-ups.
 */
let turnSeq = 0;
let current = null; // the turn whose events are being received
let busy = false; // the agent is running (from prompt until agent_settled)
let compacting = null; // { startedAt } while a speculative compaction runs
let lastActivity = Date.now();
let idleTimer = null;

function newTurn(question) {
	let resolveFirst;
	const turn = {
		id: `t-${++turnSeq}`,
		question,
		startedAt: Date.now(),
		firstSent: false,
		first: new Promise((r) => (resolveFirst = r)),
		firstTimer: null,
		onDelta: null,
		/** The model call's error, when it failed (llama-server down, 5xx…). */
		error: null,
	};
	turn.sendFirst = (text, followup) => {
		if (turn.firstSent) return;
		turn.firstSent = true;
		clearTimeout(turn.firstTimer);
		resolveFirst({ text, followup });
	};
	return turn;
}

const textOf = (message) =>
	(Array.isArray(message?.content) ? message.content : [])
		.filter((c) => c.type === "text")
		.map((c) => c.text)
		.join("")
		.trim();

pi.on((ev) => {
	const turn = current;
	if (ev.type === "_exit") {
		busy = false;
		compacting = null;
		if (turn && !turn.firstSent) turn.error = "the persona process exited mid-turn";
		turn?.sendFirst("", false);
		return;
	}
	if (ev.type === "message_update" && turn && !turn.firstSent) {
		const e = ev.assistantMessageEvent;
		if (e?.type === "text_delta") turn.onDelta?.(e.delta);
		return;
	}
	if (ev.type === "message_end" && ev.message?.role === "assistant" && turn) {
		const raw = textOf(ev.message);
		const s = sanitizeSpeech(raw);
		if (s.changed && raw) log({ type: "sanitized", turn: turn.id, before: raw.length, after: s.text.length });
		const toolCall = (ev.message.content ?? []).some((c) => c.type === "toolCall");
		if (ev.message.stopReason === "length") log({ type: "truncated", turn: turn.id });
		if (ev.message.stopReason === "error") {
			turn.error = ev.message.errorMessage || "the model call failed";
			log({ type: "model_error", turn: turn.id, firstSent: turn.firstSent, error: turn.error });
		}
		if (!turn.firstSent) {
			if (s.text) turn.sendFirst(s.text, toolCall);
			else if (toolCall && !turn.firstTimer) turn.firstTimer = setTimeout(() => turn.sendFirst("", true), FIRST_REPLY_WAIT_MS);
		} else if (s.text) {
			deliverFollowup(turn, s.text);
		}
		return;
	}
	if (ev.type === "agent_settled") {
		busy = false;
		turn?.sendFirst("", false);
		lastActivity = Date.now();
		afterSettled();
	}
});

/** Queue: one request at a time reaches pi's prompt; later ones wait for the previous FIRST reply. */
let gate = Promise.resolve();

const httpError = (status, message) => Object.assign(new Error(message), { status });

/**
 * Abort the turn in pi, so a reply nobody will hear is neither finished nor
 * kept waiting on. pi's abort returns once the agent is idle.
 */
async function abortTurn(turn, why) {
	if (current !== turn || !busy) return;
	log({ type: "turn_aborted", turn: turn.id, why, firstSent: turn.firstSent, ms: Date.now() - turn.startedAt });
	try {
		await pi.send({ type: "abort" }, 30_000);
	} catch (e) {
		log({ type: "abort_failed", error: e.message });
	}
	busy = false;
	turn.sendFirst("", false);
}

/**
 * `cancel` is the request's cancellation: `cancelled` once the client has gone,
 * and `onCancel` called when that happens.
 */
async function runTurn(text, onDelta, cancel) {
	const queuedAt = Date.now();
	let release;
	const prev = gate;
	gate = new Promise((r) => (release = r));
	const waited = await Promise.race([prev.then(() => true), new Promise((r) => setTimeout(() => r(false), WAIT_MS))]);
	if (!waited) {
		release();
		throw httpError(503, "the persona is still answering an earlier message");
	}
	try {
		if (cancel.cancelled) throw httpError(499, "the client went away while the request was queued");
		if (pi.state !== "ready") throw httpError(503, `the persona is not available (${pi.state})${pi.lastNotice ? `: ${pi.lastNotice}` : ""}`);
		lastActivity = Date.now();
		clearTimeout(idleTimer);
		if (compacting) await abortCompaction();
		const turn = newTurn(text);
		turn.onDelta = onDelta;
		const steering = busy; // tools still running from an earlier turn
		current = turn;
		busy = true;
		const cancelled = new Promise((r) => (cancel.onCancel = () => r("cancelled")));
		await pi.send(steering ? { type: "prompt", message: text, streamingBehavior: "steer" } : { type: "prompt", message: text });
		const first = await Promise.race([turn.first, cancelled, new Promise((r) => setTimeout(() => r("timeout"), WAIT_MS))]);
		if (first === "cancelled") {
			await abortTurn(turn, "client disconnected");
			throw httpError(499, "the client went away");
		}
		if (first === "timeout") {
			await abortTurn(turn, `no reply in ${WAIT_MS / 1000}s`);
			throw httpError(504, `the model did not answer within ${WAIT_MS / 1000} s`);
		}
		if (!first.text && turn.error) {
			const model = pi.model?.alias ?? "the language model";
			throw httpError(502, `${model} could not answer: ${turn.error}`);
		}
		return { turn, ...first, queueMs: turn.startedAt - queuedAt, steering };
	} finally {
		release();
	}
}

// ------------------------------------------------------------- compaction --

async function contextPercent() {
	try {
		const s = await pi.send({ type: "get_session_stats" }, 10_000);
		return s?.contextUsage?.percent ?? null;
	} catch {
		return null;
	}
}

function startCompaction(reason) {
	if (compacting || busy || pi.state !== "ready") return;
	const c = { startedAt: Date.now(), reason };
	compacting = c;
	log({ type: "compaction_start", reason });
	pi.send({ type: "compact" }, 30 * 60_000).then(
		(r) => {
			if (compacting === c) compacting = null;
			log({ type: "compaction_end", reason, outcome: "committed", seconds: Math.round((Date.now() - c.startedAt) / 1000), tokensBefore: r?.tokensBefore, after: r?.estimatedTokensAfter });
		},
		(e) => {
			if (compacting === c) compacting = null;
			// "Nothing to compact": everything is still inside keepRecentTokens. Not a failure.
			const outcome = c.aborted ? "cancelled" : /nothing to compact/i.test(e.message) ? "nothing" : "failed";
			log({ type: "compaction_end", reason, outcome, error: outcome === "failed" ? e.message : undefined, seconds: Math.round((Date.now() - c.startedAt) / 1000) });
		},
	);
}

async function abortCompaction() {
	const c = compacting;
	if (!c) return;
	c.aborted = true;
	try {
		await pi.send({ type: "abort" }, 30_000);
	} catch (e) {
		log({ type: "abort_failed", error: e.message });
	}
	if (compacting === c) compacting = null;
}

async function afterSettled() {
	const pct = await contextPercent();
	if (pct !== null && pct >= COMPACT_AT) return startCompaction(`context ${pct}%`);
	if (IDLE_COMPACT_S > 0) {
		clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			if (Date.now() - lastActivity >= IDLE_COMPACT_S * 1000) startCompaction(`idle ${IDLE_COMPACT_S}s`);
		}, IDLE_COMPACT_S * 1000);
	}
}

/**
 * Keep the model in RAM while idle (see the header). Skipped while a turn or
 * compaction runs and shortly after one: that work keeps the pages warm
 * itself. A pass takes ~3 s when nothing was paged out; one that had to page
 * the model back in is logged, as is one pass in 60 (so the log shows it runs).
 */
const KEEPWARM_EXE = join(HERE, "keepwarm.exe");
let keepwarmRunning = false;
let keepwarmPasses = 0;
function keepWarm() {
	if (keepwarmRunning || busy || compacting || pi.state !== "ready") return;
	if (Date.now() - lastActivity < KEEPWARM_S * 1000) return;
	keepwarmRunning = true;
	execFile(KEEPWARM_EXE, [], { timeout: 600_000, windowsHide: true }, (err, stdout) => {
		keepwarmRunning = false;
		keepwarmPasses++;
		let r = null;
		try {
			r = JSON.parse(String(stdout).trim().split("\n").pop());
		} catch {}
		if (err || !r || r.error) return log({ type: "keepwarm_failed", error: r?.error ?? err?.message ?? String(stdout).slice(0, 200) });
		if (r.seconds > 10 || r.wsAfterGiB - r.wsBeforeGiB > 1 || keepwarmPasses % 60 === 1) log({ type: "keepwarm", pass: keepwarmPasses, ...r });
	});
}
if (KEEPWARM_S > 0 && process.platform === "win32") {
	if (existsSync(KEEPWARM_EXE)) setInterval(keepWarm, KEEPWARM_S * 1000).unref();
	else log({ type: "keepwarm_failed", error: `${KEEPWARM_EXE} not built (start.sh builds it)` });
}

// -------------------------------------------------------------------- http --

const json = (res, status, body) => {
	res.writeHead(status, { "Content-Type": "application/json" });
	res.end(JSON.stringify(body));
};
const authorised = (req) => (req.headers.authorization ?? "") === `Bearer ${API_KEY}`;
async function readBody(req) {
	const chunks = [];
	for await (const c of req) chunks.push(c);
	return Buffer.concat(chunks).toString("utf8");
}

/** The text of the last user message, whatever shape its content has. */
function lastUserText(messages) {
	const m = [...(messages ?? [])].reverse().find((x) => x?.role === "user");
	if (!m) return null;
	if (typeof m.content === "string") return m.content;
	if (Array.isArray(m.content)) return m.content.filter((c) => c?.type === "text").map((c) => c.text).join("\n");
	return "";
}

let lastClientSystem = null;

async function chat(req, res) {
	let body;
	try {
		body = JSON.parse((await readBody(req)) || "{}");
	} catch {
		return json(res, 400, { error: { message: "body must be JSON" } });
	}
	const text = lastUserText(body.messages);
	if (text === null) return json(res, 400, { error: { message: "no user message" } });
	const sys = (body.messages ?? []).find((m) => m.role === "system")?.content ?? null;
	if (sys !== lastClientSystem) {
		lastClientSystem = sys;
		log({ type: "client_system_prompt_ignored", chars: typeof sys === "string" ? sys.length : 0 });
	}
	const started = Date.now();
	const stream = body.stream === true;
	// Nothing was said: silence, and the session is not touched.
	if (!text.trim()) {
		log({ type: "request", empty: true });
		return stream ? streamWhole(res, "", {}) : json(res, 200, completion(""));
	}

	let firstChunkAt = null;
	let sentenceBuf = "";
	let sentAny = "";
	const sse = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
	const chunk = (content) => ({ id: "chatcmpl-persona", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "sm-persona", choices: [{ index: 0, delta: { content }, finish_reason: null }] });
	// Streaming: whole sentences, each sanitised, so TTS can start on the first.
	const onDelta = stream
		? (d) => {
				sentenceBuf += d;
				let m;
				while ((m = /^[\s\S]*?[.!?…](?=\s)/.exec(sentenceBuf))) {
					const s = sanitizeSpeech(m[0]).text;
					sentenceBuf = sentenceBuf.slice(m[0].length);
					if (!s) continue;
					if (!res.headersSent) res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
					firstChunkAt ??= Date.now();
					sse(chunk((sentAny ? " " : "") + s));
					sentAny += (sentAny ? " " : "") + s;
				}
			}
		: null;

	// The client hanging up before its reply cancels the turn (see runTurn).
	const cancel = { cancelled: false, onCancel: null };
	res.on("close", () => {
		if (res.writableFinished) return;
		cancel.cancelled = true;
		cancel.onCancel?.();
	});

	let r;
	try {
		r = await runTurn(text, onDelta, cancel);
	} catch (e) {
		const status = e.status ?? 500;
		log({ type: "request", error: e.message, status, ms: Date.now() - started });
		if (status === 499 || res.destroyed) return; // nobody to tell
		if (res.headersSent) return res.end();
		return json(res, status, { error: { message: `persona: ${e.message}`, type: status === 502 ? "model_unavailable" : status === 503 ? "persona_unavailable" : "persona_error", code: status } });
	}
	const extra = r.followup ? { persona: { followup: true, turn: r.turn.id } } : { persona: { followup: false, turn: r.turn.id } };
	log({ type: "request", turn: r.turn.id, chars: text.length, replyChars: r.text.length, followup: r.followup, steering: r.steering, queueMs: r.queueMs, firstChunkMs: firstChunkAt ? firstChunkAt - started : null, ms: Date.now() - started });
	if (!stream) return json(res, 200, completion(r.text, extra));
	// Whatever the sentence splitter has not sent yet (the final text is the truth).
	const rest = r.text.startsWith(sentAny) ? r.text.slice(sentAny.length).trim() : sentAny ? "" : r.text;
	return streamWhole(res, rest, extra, !!sentAny);
}

function streamWhole(res, text, extra, continued = false) {
	if (!res.headersSent) res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
	const base = { id: "chatcmpl-persona", object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: "sm-persona" };
	if (text) res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: { content: (continued ? " " : "") + text }, finish_reason: null }] })}\n\n`);
	res.write(`data: ${JSON.stringify({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }], ...extra })}\n\n`);
	res.write("data: [DONE]\n\n");
	res.end();
}

async function status() {
	const pct = pi.state === "ready" && !busy && !compacting ? await contextPercent() : null;
	return {
		state: pi.state,
		model: pi.model,
		busy,
		compacting: compacting ? { reason: compacting.reason, seconds: Math.round((Date.now() - compacting.startedAt) / 1000) } : null,
		contextPercent: pct,
		compactAt: COMPACT_AT,
		followupListeners: sseClients.size,
		lastNotice: pi.lastNotice,
		log: logPath,
	};
}

let shuttingDown = false;
async function shutdown(why) {
	if (shuttingDown) return;
	shuttingDown = true;
	log({ type: "shutdown", why });
	for (const res of sseClients) res.end();
	await pi.stop();
	process.exit(0);
}

const server = createServer(async (req, res) => {
	try {
		const url = new URL(req.url, "http://persona");
		if (req.method === "GET" && url.pathname === "/health") {
			return json(res, pi.state === "ready" ? 200 : 503, { state: pi.state });
		}
		if (!authorised(req)) return json(res, 401, { error: { message: "missing or wrong API key" } });
		if (req.method === "POST" && url.pathname === "/v1/chat/completions") return await chat(req, res);
		if (req.method === "GET" && url.pathname === "/v1/models") {
			return json(res, 200, { object: "list", data: [{ id: "sm-persona", object: "model", owned_by: "pi-small", served: pi.model }] });
		}
		if (req.method === "GET" && url.pathname === "/persona/status") return json(res, 200, await status());
		if (req.method === "GET" && url.pathname === "/persona/followups") {
			const after = Number(url.searchParams.get("after") ?? 0);
			return json(res, 200, { followups: followups.filter((f) => f.seq > after).map((f) => f.body), last: followupSeq });
		}
		if (req.method === "GET" && url.pathname === "/persona/events") {
			res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
			res.write(": persona follow-ups\n\n");
			sseClients.add(res);
			const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
			req.on("close", () => {
				clearInterval(ping);
				sseClients.delete(res);
			});
			return;
		}
		if (req.method === "POST" && url.pathname === "/persona/compact") {
			if (busy) return json(res, 409, { error: { message: "a turn is running" } });
			if (compacting) await abortCompaction();
			try {
				const r = await pi.send({ type: "compact" }, 30 * 60_000);
				log({ type: "compaction_end", reason: "forced", outcome: "committed", tokensBefore: r?.tokensBefore });
				return json(res, 200, { ok: true, tokensBefore: r?.tokensBefore, estimatedTokensAfter: r?.estimatedTokensAfter });
			} catch (e) {
				return json(res, 500, { error: { message: e.message } });
			}
		}
		if (req.method === "POST" && url.pathname === "/persona/shutdown") {
			json(res, 202, { ok: true });
			return shutdown("POST /persona/shutdown");
		}
		json(res, 404, { error: { message: "not found" } });
	} catch (e) {
		if (!res.headersSent) json(res, 500, { error: { message: e.message } });
		else res.end();
	}
});

server.listen(PORT, BIND, () => {
	log({ type: "listening", bind: BIND, port: PORT, home: HOME, compactAt: COMPACT_AT });
	pi.start();
});

for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => shutdown(sig));
