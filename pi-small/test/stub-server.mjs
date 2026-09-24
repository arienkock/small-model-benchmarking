#!/usr/bin/env node
/**
 * stub-server.mjs — a fake llama-server, for exercising pi-small without a GPU.
 *
 * It speaks the four endpoints the plugin depends on (/health, /v1/models,
 * /props, /v1/chat/completions, streaming and not) and nothing else. It accepts
 * llama-server's flags and records them, so a test can assert that the plugin
 * built the right command line — including the per-model template flags.
 *
 * Behaviour of the chat endpoint, chosen so a live session is self-verifying:
 *   - a probe asking for a tool (`tools` present + "Use the bash tool") gets a
 *     real tool_calls response, so probe_tool_calls passes
 *   - a user message starting with "!" becomes a bash tool call for the rest of
 *     the line, so the tool path can be driven by hand
 *   - anything else is answered with the sampler settings the request carried,
 *     so /sm-temp and /sm-ctx are visible in the reply itself
 *   - /props reports the sampler it was started with (from its own argv), the
 *     way llama-server does, so the startup verification can be exercised
 *   - thinking follows the template switch: `chat_template_kwargs` on the
 *     request, else `--chat-template-kwargs` on the command line, else off.
 *     A thinking reply carries `reasoning_content`.
 *
 * Usage: node stub-server.mjs [llama-server flags...]
 *        PI_SMALL_STUB_ARGS_LOG=<path> to record argv as JSON.
 *        PI_SMALL_STUB_IGNORE_THINKING_SWITCH=1 to think no matter what the
 *        switch says — the real failure where `--reasoning-budget 0` was set
 *        and the model kept thinking, for testing that it is DETECTED.
 *        PI_SMALL_STUB_CRASH_ABOVE_CTX=<n> to exit(1) immediately instead of
 *        starting, for any -c greater than <n> — simulates a GPU-memory crash
 *        at load time, for testing ServerManager's context ladder fallback.
 */

import { createServer } from "node:http";
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);

function flag(name, fallback) {
	const i = argv.indexOf(name);
	return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback;
}

const alias = flag("--alias", "stub-model");
const ctx = Number(flag("-c", "16384"));
const port = Number(flag("--port", "8123"));
const host = flag("--host", "127.0.0.1");
const serverTemp = flag("--temp", "unset");
const num = (name) => (flag(name) === undefined ? undefined : Number(flag(name)));
const serverParams = {
	temperature: num("--temp"),
	top_p: num("--top-p"),
	top_k: num("--top-k"),
	min_p: num("--min-p"),
	repeat_penalty: num("--repeat-penalty"),
	presence_penalty: num("--presence-penalty"),
};
let serverKwargs = {};
try {
	serverKwargs = JSON.parse(flag("--chat-template-kwargs", "{}"));
} catch {}

/** Does this request think? Request kwargs win over the server's, as in llama-server. */
function thinks(payload) {
	if (process.env.PI_SMALL_STUB_IGNORE_THINKING_SWITCH === "1") return true;
	const req = payload.chat_template_kwargs?.enable_thinking;
	if (typeof req === "boolean") return req;
	return serverKwargs.enable_thinking === true;
}

const crashAboveCtx = Number(process.env.PI_SMALL_STUB_CRASH_ABOVE_CTX);
if (Number.isFinite(crashAboveCtx) && ctx > crashAboveCtx) {
	console.log(`stub-server: simulating a GPU-memory crash at ctx=${ctx} (> PI_SMALL_STUB_CRASH_ABOVE_CTX=${crashAboveCtx})`);
	process.exit(1);
}

const argsLog = process.env.PI_SMALL_STUB_ARGS_LOG;
if (argsLog) {
	writeFileSync(argsLog, JSON.stringify({ argv, alias, ctx, port, temp: serverTemp }, null, 2));
}

console.log(`stub-server: alias=${alias} ctx=${ctx} temp=${serverTemp} listening on ${host}:${port}`);
console.log(`stub-server: argv = ${JSON.stringify(argv)}`);

const json = (res, code, body) => {
	const text = JSON.stringify(body);
	res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
	res.end(text);
};

/** Decide what the "model" should say. */
function respond(payload) {
	const messages = payload.messages ?? [];
	const lastUser = [...messages].reverse().find((m) => m.role === "user");
	const text = typeof lastUser?.content === "string"
		? lastUser.content
		: (lastUser?.content ?? []).map((p) => p.text ?? "").join(" ");

	const hasTools = Array.isArray(payload.tools) && payload.tools.length > 0;

	// Once a tool result comes back, answer in prose. Without this the stub would
	// re-issue the same tool call forever, because the triggering user message is
	// still the last USER message in the conversation.
	const last = messages[messages.length - 1];
	if (last?.role === "tool") {
		const out = typeof last.content === "string" ? last.content : JSON.stringify(last.content);
		return { kind: "text", text: `stub saw the tool result (${out.length} chars):\n${out.slice(0, 400)}` };
	}

	if (hasTools && /use the bash tool/i.test(text)) {
		return { kind: "tool", command: "ls -la" };
	}
	if (hasTools && text.trim().startsWith("!")) {
		return { kind: "tool", command: text.trim().slice(1).trim() || "true" };
	}
	return {
		kind: "text",
		text:
			`stub reply from ${alias}\n` +
			`request temperature=${payload.temperature ?? "unset"} top_p=${payload.top_p ?? "unset"} top_k=${payload.top_k ?? "unset"}\n` +
			`server ctx=${ctx}, max_tokens=${payload.max_tokens ?? "unset"}, tools offered=${(payload.tools ?? []).map((t) => t.function?.name).join(",") || "none"}\n` +
			`you said: ${text.slice(0, 200)}`,
	};
}

function nonStreaming(res, payload) {
	const r = respond(payload);
	const message =
		r.kind === "tool"
			? {
					role: "assistant",
					content: "",
					tool_calls: [
						{
							id: "call_stub_1",
							type: "function",
							function: { name: "bash", arguments: JSON.stringify({ command: r.command }) },
						},
					],
				}
			: { role: "assistant", content: r.text };
	if (thinks(payload)) message.reasoning_content = "stub thoughts";
	json(res, 200, {
		id: "chatcmpl-stub",
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model: alias,
		choices: [{ index: 0, message, finish_reason: r.kind === "tool" ? "tool_calls" : "stop" }],
		usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
	});
}

function streaming(res, payload) {
	const r = respond(payload);
	res.writeHead(200, {
		"Content-Type": "text/event-stream",
		"Cache-Control": "no-cache",
		Connection: "keep-alive",
	});
	const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
	const base = {
		id: "chatcmpl-stub",
		object: "chat.completion.chunk",
		created: Math.floor(Date.now() / 1000),
		model: alias,
	};

	send({ ...base, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
	if (thinks(payload)) send({ ...base, choices: [{ index: 0, delta: { reasoning_content: "stub thoughts" }, finish_reason: null }] });

	if (r.kind === "tool") {
		send({
			...base,
			choices: [
				{
					index: 0,
					delta: {
						tool_calls: [
							{
								index: 0,
								id: "call_stub_1",
								type: "function",
								function: { name: "bash", arguments: JSON.stringify({ command: r.command }) },
							},
						],
					},
					finish_reason: null,
				},
			],
		});
		send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
	} else {
		for (const chunk of r.text.match(/.{1,24}/gs) ?? []) {
			send({ ...base, choices: [{ index: 0, delta: { content: chunk }, finish_reason: null }] });
		}
		send({ ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
	}

	if (payload.stream_options?.include_usage) {
		send({ ...base, choices: [], usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } });
	}
	res.write("data: [DONE]\n\n");
	res.end();
}

createServer((req, res) => {
	const url = new URL(req.url, `http://${host}:${port}`);

	if (req.method === "GET" && url.pathname === "/health") {
		return json(res, 200, { status: "ok" });
	}
	if (req.method === "GET" && url.pathname === "/v1/models") {
		return json(res, 200, { object: "list", data: [{ id: alias, object: "model", owned_by: "stub" }] });
	}
	if (req.method === "GET" && url.pathname === "/props") {
		// PI_SMALL_STUB_REPORT_CTX fakes llama-server capping -c at the model's
		// training context, which is the case the plugin must never mis-read.
		return json(res, 200, {
			default_generation_settings: { n_ctx: Number(process.env.PI_SMALL_STUB_REPORT_CTX) || ctx, params: serverParams },
			model_path: `stub/${alias}`,
			chat_template: "stub",
		});
	}
	if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
		let body = "";
		req.on("data", (d) => (body += d));
		req.on("end", () => {
			let payload;
			try {
				payload = JSON.parse(body);
			} catch {
				return json(res, 400, { error: "bad json" });
			}
			console.log(`stub-server: chat request temp=${payload.temperature} top_p=${payload.top_p} top_k=${payload.top_k} stream=${!!payload.stream} tools=${(payload.tools ?? []).length} kwargs=${JSON.stringify(payload.chat_template_kwargs ?? null)}`);
			console.log(`stub-server: system prompt = ${JSON.stringify(payload.messages?.find((m) => m.role === "system")?.content ?? null)}`);
			return payload.stream ? streaming(res, payload) : nonStreaming(res, payload);
		});
		return;
	}
	json(res, 404, { error: "not found" });
}).listen(port, host);

for (const sig of ["SIGTERM", "SIGINT"]) {
	process.on(sig, () => {
		console.log(`stub-server: ${sig}, exiting`);
		process.exit(0);
	});
}
