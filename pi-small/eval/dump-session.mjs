// dump-session.mjs — flatten one pi session .jsonl into readable turns.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const dir = join(process.argv[2], ".home/.pi/agent/sessions/--workspace--");
const file = readdirSync(dir).filter((f) => f.endsWith(".jsonl"))[0];
const limit = Number(process.argv[3] ?? 600);
for (const line of readFileSync(join(dir, file), "utf8").trim().split("\n")) {
	let j;
	try { j = JSON.parse(line); } catch { continue; }
	const m = j.message ?? j;
	const role = m.role ?? j.type;
	const c = m.content;
	if (role === "toolResult") {
		const t = (Array.isArray(c) ? c.map((p) => p.text ?? "").join("") : String(c));
		console.log(`[tool_result] ${t.slice(0, limit)}\n`);
		continue;
	}
	if (typeof c === "string") { console.log(`[${role}] ${c.slice(0, limit)}\n`); continue; }
	if (!Array.isArray(c)) continue;
	for (const p of c) {
		if (p.type === "text") console.log(`[${role}] ${p.text.slice(0, limit)}\n`);
		else if (p.type === "toolCall") console.log(`[tool_call ${p.name}] ${JSON.stringify(p.arguments).slice(0, limit)}\n`);
	}
}
