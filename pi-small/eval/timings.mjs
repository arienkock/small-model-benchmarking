#!/usr/bin/env node
/**
 * timings.mjs — what a session actually cost, from llama-server's own
 * `print_timing` lines.
 *
 *   node eval/timings.mjs <llama-server log> [...]
 *   node eval/timings.mjs --session <pi session .jsonl> <llama-server log>
 *   node eval/timings.mjs --after 11.13 --before 20.00 <llama-server log>
 *
 * Per log: prompt-processing and generation totals and rates, the share of
 * server compute that was prompt, and a per-request table (new prompt tokens →
 * ms/token), which is what showed that small agent turns cost far more per
 * token than llama-bench's pp512 suggests.
 *
 * One server often serves several sessions — serve.mjs adopts a live server
 * of the right model — so a log has to be split by time. The stamps in the log
 * are elapsed time since the server started, as TOTAL MINUTES.seconds.ms.µs —
 * `85.05.014.924` is 85 min 5.014 s into an 85-minute run, not 85 hours — and
 * not zero-padded, so they are compared as numbers, never as strings.
 * --after/--before take the same form (`11.13` = 11 min 13 s).
 *
 * --session does the split for you: it reads the session's first and last
 * wall-clock timestamps and converts them using the server's start time, which
 * serve.mjs and the plugin both put in the log file name
 * (llama-<alias>[-c<ctx>]-<ISO time>.log).
 */
import { readFileSync } from "node:fs";
import { basename } from "node:path";

const RE_PP = /^([\d.]+)\s+I slot print_timing.*prompt eval time =\s*([\d.]+) ms \/\s*(\d+) tokens/;
const RE_TG = /^([\d.]+)\s+I slot print_timing.*\|\s+eval time =\s*([\d.]+) ms \/\s*(\d+) tokens/;

const args = process.argv.slice(2);
const opt = (name) => {
	const i = args.indexOf(name);
	return i >= 0 ? args.splice(i, 2)[1] : null;
};
// minutes.seconds[.ms[.µs]] -> seconds. A missing field is 0, never NaN — NaN
// silently disables every comparison.
const secs = (stamp) => {
	const [min = 0, sec = 0, ms = 0] = String(stamp).split(".");
	return Number(min) * 60 + Number(sec) + Number(ms) / 1000;
};

let afterS = opt("--after");
let beforeS = opt("--before");
afterS = afterS === null ? null : secs(afterS);
beforeS = beforeS === null ? null : secs(beforeS);
const session = opt("--session");

/** Server start time from the log's file name. */
function serverStart(logPath) {
	const m = basename(logPath).match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.log$/);
	return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null;
}

/** First and last wall-clock timestamps in a pi session record (or a pi-small session log). */
function sessionWindow(path) {
	const stamps = readFileSync(path, "utf8")
		.trim()
		.split("\n")
		.map((l) => {
			try {
				return Date.parse(JSON.parse(l).timestamp ?? JSON.parse(l).ts);
			} catch {
				return NaN;
			}
		})
		.filter(Number.isFinite);
	if (stamps.length === 0) throw new Error(`${path}: no timestamps`);
	return [Math.min(...stamps), Math.max(...stamps)];
}

for (const path of args) {
	let text;
	try {
		text = readFileSync(path, "utf8");
	} catch (e) {
		console.log(`${path}: ${e.message}`);
		continue;
	}
	let lo = afterS;
	let hi = beforeS;
	if (session) {
		const start = serverStart(path);
		if (!start) {
			console.log(`${path}: cannot read the server start time from the file name, so --session cannot place the window`);
			continue;
		}
		const [a, b] = sessionWindow(session);
		// Five seconds of slack either side, no more. A timing line is printed as
		// its response finishes and pi records the message immediately after, so
		// the lines belonging to a session sit inside its timestamps. A wider
		// margin pulls the NEXT session's startup probes into this one when two
		// sessions run back to back against one adopted server.
		lo = (a - start.getTime()) / 1000 - 5;
		hi = (b - start.getTime()) / 1000 + 5;
	}
	const inWindow = (at) => (lo === null || secs(at) >= lo) && (hi === null || secs(at) <= hi);

	let ppMs = 0, ppTok = 0, tgMs = 0, tgTok = 0;
	const rows = [];
	for (const line of text.split(/\r?\n/)) {
		let m = line.match(RE_PP);
		if (m && inWindow(m[1])) {
			ppMs += Number(m[2]);
			ppTok += Number(m[3]);
			rows.push({ at: m[1], tok: Number(m[3]), ms: Number(m[2]), gen: null });
			continue;
		}
		m = line.match(RE_TG);
		if (m && inWindow(m[1])) {
			tgMs += Number(m[2]);
			tgTok += Number(m[3]);
			if (rows.length) rows[rows.length - 1].gen = Number(m[3]);
		}
	}
	const rate = (tok, ms) => (ms > 0 ? (tok / (ms / 1000)).toFixed(2) : "?");
	const compute = ppMs + tgMs;
	console.log(`\n${path}${session ? `  (window from ${basename(session)})` : ""}`);
	console.log(`  requests:   ${rows.length}`);
	console.log(`  prompt:     ${ppTok} tok / ${(ppMs / 1000).toFixed(1)} s  = ${rate(ppTok, ppMs)} t/s`);
	console.log(`  generation: ${tgTok} tok / ${(tgMs / 1000).toFixed(1)} s  = ${rate(tgTok, tgMs)} t/s`);
	if (compute > 0) console.log(`  server compute: ${(compute / 60000).toFixed(1)} min (${((ppMs / compute) * 100).toFixed(0)}% of it prompt)`);
	if (rows.length) {
		console.log("  per request:      at   new-prompt  ms/tok    t/s   generated");
		for (const r of rows) {
			console.log(`    ${r.at.padStart(14)}  ${String(r.tok).padStart(8)}  ${(r.ms / r.tok).toFixed(0).padStart(6)}  ${rate(r.tok, r.ms).padStart(6)}  ${String(r.gen ?? "?").padStart(9)}`);
		}
		const cap = rows.filter((r) => r.gen === 4096).length;
		if (cap) console.log(`  !! ${cap} request(s) generated exactly 4096 tokens — the default max_tokens; likely truncated`);
	}
}
