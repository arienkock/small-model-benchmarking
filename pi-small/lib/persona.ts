/**
 * persona.ts — the conversational persona mode (PI_SMALL_MODE=persona), with NO
 * dependency on pi, so persona/server.mjs and the tests can import it under
 * plain node. See persona/DESIGN.md.
 *
 * What lives here: the constraint layer of the system prompt (PERSONA_STYLE),
 * prompt assembly, the memory file and its guards, the compaction instruction
 * that maintains the memory tiers, the per-message timestamp, and the speech
 * sanitiser the server applies to replies.
 *
 * One rule runs through all of it: constrain the MEDIUM, not the voice. The
 * text below says what the situation is and what a reply has to survive (being
 * read aloud, being short). It never scripts wording: no example replies, no
 * quoted phrases, no example memory entries. The personality comes from
 * persona.md and from the model itself.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PLUGIN_DIR } from "./roster.ts";

// ------------------------------------------------------------------ prompt --

/**
 * What the medium forces, phrased as facts and limits. The two
 * speech-recognition rules (garbled input, unknown speaker) are the ones a
 * small model is most likely to ignore; the eval checks them first.
 */
export const PERSONA_STYLE = [
	"You are speaking, not writing: everything you say is read aloud by a speech synthesizer.",
	"Keep answers short, a few sentences at most. If a full answer would be long, give the short version and offer to say more.",
	"No lists, tables, headings, markdown, emoji or code.",
	"Say numbers and symbols the way a person would say them.",
	"What you receive comes from speech recognition. It can be misheard, cut off, or background talk that was not meant for you. If a message is garbled, a fragment, or does not make sense as a question or a statement, do not guess; ask for clarification.",
	"Several people may talk to you and you cannot tell who is speaking. Do not assume; use a name only if the speaker says who they are.",
	"Each message starts with the date and time it was said, in square brackets. It is there for you; do not repeat it.",
].join("\n");

/** Added when the model has tools: a constraint on behaviour, not on wording. */
export const PERSONA_TOOL_STYLE =
	"Tools take a few seconds and the people you talk to hear nothing meanwhile. When you call one, say briefly what you are doing in the same reply, before the call; the result reaches you afterwards and you then tell them what you found.";

export interface MemoryWords {
	permanent: number;
	ongoing: number;
	recent: number;
}

export const DEFAULT_MEMORY_WORDS: MemoryWords = { permanent: 300, ongoing: 200, recent: 120 };

/** The two tiers kept in the memory file; the third (recent) is pi's compaction summary. */
export interface Memory {
	permanent: string;
	ongoing: string;
	/** ISO time of the compaction (or hand edit) that wrote it, when known. */
	updated?: string;
}

/**
 * The system prompt: persona.md (personality), PERSONA_STYLE (constraints),
 * then the memory. Nothing in it changes between compactions — the time rides
 * on each user message instead — so every turn reuses the server's prompt
 * cache.
 */
export function buildPersonaSystemPrompt(o: { persona: string; memory: Memory | null; tools?: boolean }): string {
	const parts: string[] = [];
	if (o.persona.trim()) parts.push(o.persona.trim());
	parts.push(o.tools ? `${PERSONA_STYLE}\n${PERSONA_TOOL_STYLE}` : PERSONA_STYLE);
	const m = o.memory;
	if (m && (m.permanent.trim() || m.ongoing.trim())) {
		parts.push(
			[
				"Your memory from earlier conversations, which you wrote yourself:",
				"",
				"## Permanent",
				m.permanent.trim() || "(nothing yet)",
				"",
				"## Ongoing",
				m.ongoing.trim() || "(nothing yet)",
			].join("\n"),
		);
	}
	return parts.join("\n\n");
}

// ------------------------------------------------------------- compaction --

function tierSpec(w: MemoryWords): string[] {
	return [
		`## Permanent\nAt most ${w.permanent} words. Facts about the people you talk to that will almost never change: names, who is who, relationships, home, lasting likes and dislikes, how they want you to talk. Keep every earlier permanent fact unless you were told it is wrong.`,
		"",
		`## Ongoing\nAt most ${w.ongoing} words. What is true for now but will change: plans, projects, upcoming events with their dates, how people are doing. Drop what is over or no longer true. Write dates as dates, not as "tomorrow".`,
		"",
		`## Recent\nAt most ${w.recent} words. What you were just talking about, and anything left open.`,
		"",
		"Short plain sentences, one fact per line. Say who a fact is about only when the conversation made that clear; the speaker is never identified automatically. Leave out anything that came from misheard or garbled messages.",
	];
}

/**
 * The in-context instruction, sent as a user message appended to the
 * session's own messages so the request shares its whole prefix with the last
 * turn. (Coding sessions send theirs as a synthetic tool result, to keep Qwen
 * templates from re-rendering earlier thinking; persona mode runs with thinking
 * off, so that reason does not apply, and a user message is what a
 * conversational model answers most naturally.)
 */
export function buildMemoryInstruction(words: MemoryWords): string {
	return [
		"This is not part of the conversation. The conversation so far is about to be cleared from your context. Write your memory of it now: you will keep only what you write here, plus the memory shown at the top. Rewrite all three parts in full, including the memory you already had and any earlier summary of recent conversation.",
		"",
		"Reply with these three parts and nothing else:",
		"",
		...tierSpec(words),
	].join("\n");
}

/** Fallback: the same, over a serialized copy of the conversation in a fresh request. */
export function buildMemoryPrompt(o: { conversation: string; previousSummary?: string; memory: Memory | null; words: MemoryWords }): string {
	const parts = [
		"Below is a conversation you had, spoken through speech recognition, and the memory you kept before it. Write your memory of everything now; you will keep only what you write here.",
		"",
		"Reply with these three parts and nothing else:",
		"",
		...tierSpec(o.words),
	];
	if (o.memory) parts.push("", `<memory>\n## Permanent\n${o.memory.permanent.trim()}\n\n## Ongoing\n${o.memory.ongoing.trim()}\n</memory>`);
	if (o.previousSummary?.trim()) parts.push("", `<earlier-recent>\n${o.previousSummary.trim()}\n</earlier-recent>`);
	parts.push("", `<conversation>\n${o.conversation}\n</conversation>`);
	return parts.join("\n");
}

export interface Tiers {
	permanent?: string;
	ongoing?: string;
	recent?: string;
}

/**
 * Split a reply into its tiers by heading. Tolerant of what small models do to
 * headings: any number of #, bold markers, a trailing colon, any case. A tier
 * that does not appear is left undefined, never guessed.
 */
export function parseTiers(text: string): Tiers {
	const out: Tiers = {};
	const re = /^[ \t]*(?:#{1,6}[ \t]*)?\**[ \t]*(permanent|ongoing|recent)\b[^\n]*$/gim;
	const marks: Array<{ key: keyof Tiers; start: number; bodyStart: number }> = [];
	for (let m = re.exec(text); m; m = re.exec(text)) {
		// A heading line is short; a sentence that merely starts with the word is not one.
		if (m[0].replace(/[#*:\s]/g, "").length > m[1].length + 12) continue;
		marks.push({ key: m[1].toLowerCase() as keyof Tiers, start: m.index, bodyStart: m.index + m[0].length });
	}
	marks.forEach((mk, i) => {
		const body = text.slice(mk.bodyStart, i + 1 < marks.length ? marks[i + 1].start : text.length).trim();
		if (out[mk.key] === undefined) out[mk.key] = body;
	});
	return out;
}

/**
 * Accept a compaction's tiers into memory, with the guards that keep a small
 * model from silently losing what it knew:
 *
 *  - a missing or empty tier keeps the old one;
 *  - a Permanent tier under `minKeep` of the old one's length keeps the old one
 *    (Ongoing may shrink — dropping what is over is its job).
 *
 * `rejected` names what was kept from before, for the session log.
 */
export function acceptTiers(old: Memory | null, tiers: Tiers, now: string, minKeep = 0.7): { memory: Memory; rejected: string[] } {
	const rejected: string[] = [];
	const oldP = old?.permanent.trim() ?? "";
	const oldO = old?.ongoing.trim() ?? "";
	let permanent = tiers.permanent?.trim() ?? "";
	let ongoing = tiers.ongoing?.trim() ?? "";
	if (!permanent) {
		if (oldP) rejected.push("permanent: missing, kept the previous one");
		permanent = oldP;
	} else if (oldP.length >= 80 && permanent.length < minKeep * oldP.length) {
		rejected.push(`permanent: shrank from ${oldP.length} to ${permanent.length} chars, kept the previous one`);
		permanent = oldP;
	}
	if (!ongoing) {
		if (oldO) rejected.push("ongoing: missing, kept the previous one");
		ongoing = oldO;
	}
	return { memory: { permanent, ongoing, updated: now }, rejected };
}

// ------------------------------------------------------------ memory file --

/**
 * Where the persona keeps its state: memory, its history, sessions, its own pi
 * home and logs. Personal data, so never inside the repo checkout by default.
 */
export function personaHome(): string {
	if (process.env.PI_SMALL_PERSONA_HOME) return process.env.PI_SMALL_PERSONA_HOME;
	return process.platform === "win32" ? "D:/persona" : join(homedir(), ".sm-persona");
}

export const memoryPath = (home: string) => join(home, "memory.md");

/**
 * persona.md: the copy in the persona home if there is one — so it can be
 * edited on the laptop without dirtying the checkout, which would block
 * `git push bench` — else the repo's default.
 */
export function readPersonaPrompt(home: string): { text: string; path: string } {
	for (const path of [process.env.PI_SMALL_PERSONA_PROMPT, join(home, "persona.md"), join(PLUGIN_DIR, "persona", "persona.md")]) {
		// HTML comments are notes for whoever edits the file, not for the model.
		if (path && existsSync(path)) return { text: readFileSync(path, "utf8").replace(/<!--[\s\S]*?-->/g, "").trim(), path };
	}
	return { text: "", path: "(none)" };
}

export function renderMemory(m: Memory): string {
	return [
		"# Persona memory",
		"",
		`<!-- updated: ${m.updated ?? "unknown"}. Written by pi-small at each compaction; hand edits are fine, keep the two headings. -->`,
		"",
		"## Permanent",
		"",
		m.permanent.trim(),
		"",
		"## Ongoing",
		"",
		m.ongoing.trim(),
		"",
	].join("\n");
}

export function parseMemory(text: string): Memory {
	const tiers = parseTiers(text);
	const updated = /<!--\s*updated:\s*([^\s.]+(?:\.\d+)?Z?)/.exec(text)?.[1];
	return { permanent: tiers.permanent ?? "", ongoing: tiers.ongoing ?? "", updated: updated && updated !== "unknown" ? updated : undefined };
}

export function readMemory(home: string): Memory | null {
	const path = memoryPath(home);
	if (!existsSync(path)) return null;
	return parseMemory(readFileSync(path, "utf8"));
}

/**
 * Write the memory file, keeping the previous version in memory-history/.
 * Written to a temp file and renamed, so a crash never leaves half a file.
 */
export function writeMemory(home: string, m: Memory): void {
	mkdirSync(home, { recursive: true });
	const path = memoryPath(home);
	if (existsSync(path)) {
		const hist = join(home, "memory-history");
		mkdirSync(hist, { recursive: true });
		copyFileSync(path, join(hist, `memory-${new Date().toISOString().replace(/[:.]/g, "-")}.md`));
	}
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, renderMemory(m));
	renameSync(tmp, path);
}

/** Drop every memory line containing `needle` (case-insensitive). Returns how many went. */
export function forgetInMemory(home: string, needle: string, now: string): number {
	const m = readMemory(home);
	const n = needle.trim().toLowerCase();
	if (!m || !n) return 0;
	let removed = 0;
	const drop = (s: string) =>
		s
			.split("\n")
			.filter((line) => {
				const hit = line.toLowerCase().includes(n);
				if (hit) removed++;
				return !hit;
			})
			.join("\n");
	const next = { permanent: drop(m.permanent), ongoing: drop(m.ongoing), updated: now };
	if (removed) writeMemory(home, next);
	return removed;
}

// ------------------------------------------------------------------- time --

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `[Sat 26 Sep 2026, 14:02]`, local time — prefixed to each user message, never the system prompt. */
export function timestamp(d = new Date()): string {
	const hh = String(d.getHours()).padStart(2, "0");
	const mm = String(d.getMinutes()).padStart(2, "0");
	return `[${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${hh}:${mm}]`;
}

export const TIMESTAMP_RE = /^\[(Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2}\]\s*/;

// ----------------------------------------------------------------- speech --

/**
 * Remove markup a speech synthesizer would read out, and nothing else: it
 * never rewords, reorders or shortens. `changed` says whether it had to do
 * anything, which the server logs as a prompt-following signal.
 */
export function sanitizeSpeech(input: string): { text: string; changed: boolean } {
	let t = input;
	t = t.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/i, "");
	t = t.replace(TIMESTAMP_RE, "");
	t = t.replace(/^```[^\n]*$/gm, ""); // code fences, keeping what was inside
	t = t.replace(/^[ \t]*\|?[ \t:]*-{3,}[ \t:|-]*$/gm, ""); // table separator rows
	t = t.replace(/^[ \t]*\|/gm, "").replace(/\|[ \t]*$/gm, "").replace(/[ \t]*\|[ \t]*/g, ", "); // table cells
	t = t.replace(/^[ \t]*#{1,6}[ \t]+/gm, ""); // headings
	t = t.replace(/^[ \t]*(?:[-*+•]|\d{1,2}[.)])[ \t]+/gm, ""); // list markers
	t = t.replace(/\[([^\]]+)\]\((?:[^)]+)\)/g, "$1"); // links
	t = t.replace(/(\*\*|__)(.+?)\1/g, "$2").replace(/(^|[^\w*])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1$2").replace(/`([^`]*)`/g, "$1");
	t = t.replace(/\p{Extended_Pictographic}\uFE0F?/gu, "");
	t = t.replace(/,\s*,/g, ",").replace(/(^|\n)\s*,\s*/g, "$1");
	// One line per former list item or table row: join them, with a comma where
	// a line had no punctuation of its own, so the synthesizer still pauses.
	const lines = t
		.split(/\n+/)
		.map((l) => l.trim())
		.filter(Boolean);
	t = lines
		.map((l, i) => (/[.!?,;:…]["')\]]?$/.test(l) || lines.length === 1 ? l : l + (i === lines.length - 1 ? "." : ",")))
		.join(" ")
		.replace(/[ \t]{2,}/g, " ")
		.trim();
	return { text: t, changed: t !== input.trim() };
}
