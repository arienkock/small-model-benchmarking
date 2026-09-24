#!/usr/bin/env node
/**
 * session-shape.mjs — how much work a session actually did, from pi's own
 * session record.
 *
 *   node eval/session-shape.mjs <workspace dir> [...]
 *   node eval/session-shape.mjs --run 'wordfreq\.py' <workspace dir> [...]
 *
 * Counts assistant messages, tool calls, and how many of those calls EXECUTED
 * the thing under test (--run: a regex matched against the command with heredoc
 * bodies removed; default, any `node`/`python` invocation), plus the characters
 * of thinking. A call that runs the script three times counts once: this is
 * "tool calls that executed it", not executions. The 2026-09-22
 * round is why the execution count matters: the one model that got the task
 * wrong ran its own script seven times — more checking than any correct run —
 * so "did it check" is not the question; "did checking change its conclusion"
 * is, and that needs the count next to the result.
 *
 * <workspace dir> is a pi-small workspace: the session record is under
 * .home/.pi/agent/sessions/ (the container's HOME is the workspace).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const ri = args.indexOf("--run");
const runRe = ri >= 0 ? new RegExp(args.splice(ri, 2)[1]) : /\b(node|python3?)\s/;

/**
 * The command with every heredoc BODY removed. Models write files with
 * `cat > x.py << 'EOF' ... EOF`, and the body of a Python script contains
 * "python3" (shebang) and often its own file name (usage text) — so without
 * this, writing the script counted as running it. The first version of this
 * counter did exactly that and overstated five of seven runs in the
 * 2026-09-22 report.
 */
function withoutHeredocBodies(cmd) {
	return cmd.replace(/(<<-?\s*['"]?(\w+)['"]?[^\n]*)\n[\s\S]*?\n\s*\2\b/g, "$1");
}

for (const dir of args) {
	const sessions = join(dir, ".home/.pi/agent/sessions/--workspace--");
	if (!existsSync(sessions)) {
		console.log(`${dir}: no pi session record under ${sessions}`);
		continue;
	}
	const file = readdirSync(sessions).find((f) => f.endsWith(".jsonl"));
	let messages = 0, withText = 0, calls = 0, runs = 0, thinking = 0;
	for (const line of readFileSync(join(sessions, file), "utf8").trim().split("\n")) {
		let j;
		try {
			j = JSON.parse(line);
		} catch {
			continue;
		}
		const m = j.message ?? {};
		if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
		messages++;
		if (m.content.some((p) => p.type === "text" && String(p.text ?? "").trim())) withText++;
		for (const p of m.content) {
			if (p.type === "thinking") thinking += String(p.thinking ?? "").length;
			// pi records a call as {type:"toolCall", name, arguments} — not an
			// Anthropic-style tool_use block.
			if (p.type !== "toolCall") continue;
			calls++;
			if (runRe.test(withoutHeredocBodies(String(p.arguments?.command ?? JSON.stringify(p.arguments ?? ""))))) runs++;
		}
	}
	// "with text" is the count the 2026-09-22/23 reports call "assistant turns".
	console.log(
		`${dir}: assistant messages ${messages} (${withText} with text), tool calls ${calls}, ` +
			`runs matching ${runRe} ${runs}, thinking ${thinking} chars`,
	);
}
