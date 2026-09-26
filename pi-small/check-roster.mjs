#!/usr/bin/env node
/**
 * check-roster.mjs — resolve every roster entry without starting anything.
 *
 * The pi-small equivalent of run-filter-bench.sh --check-models: says, for each
 * model, whether the weights are on this machine (and where), or whether the
 * run would fall back to -hf and download them. Uses lib/roster.ts, the same
 * module the plugin uses, so it cannot drift from what a real session does --
 * and that module imports nothing from pi, so this runs under plain node on the
 * serving machine with no dev dependencies installed.
 *
 *   node check-roster.mjs
 */
import { loadRoster, resolveMaxTokens, resolveTools, validateSpec, weightsSource } from "./lib/roster.ts";

const roster = loadRoster();
const cache = process.env.LLAMA_CACHE ?? roster.defaults.llamaCache ?? "(unset)";
console.log(`LLAMA_CACHE: ${cache}\n`);

let local = 0;
let remote = 0;
let missing = 0;
for (const m of roster.models) {
	const { local: hit } = weightsSource(m);
	const tools = resolveTools(m, roster.defaults);
	const flags = [
		m.default ? "default" : "",
		m.ctx ? `ctx=${m.ctx}` : "",
		m.thinking ? `thinking=${m.thinking}${m.samplers ? "(per-mode sampler)" : ""}` : "",
		m.ngl !== undefined ? `ngl=${m.ngl}` : "",
		m.maxTokens !== undefined ? `maxTokens=${resolveMaxTokens(m, roster.defaults)}` : "",
		m.chatTemplate ? `template=${m.chatTemplate}` : "",
		m.serverArgs?.length ? `args=${m.serverArgs.join(" ")}` : "",
		m.ctxCandidates ? `ctxCandidates=${m.ctxCandidates.join(",")}` : "",
		m.tools ? `tools=${tools.join(",")}` : "",
		m.toolOptions ? `toolOptions=${Object.keys(m.toolOptions).join(",")}` : "",
		m.systemPrompt ? "systemPrompt=custom" : "",
	].filter(Boolean).join(" ");
	if (hit) {
		const gb = (await import("node:fs")).statSync(hit).size / 1e9;
		console.log(`LOCAL   ${m.alias.padEnd(32)} ${gb.toFixed(2)} GB  ${flags}`);
		console.log(`        ${hit}`);
		local++;
	} else if (m.repo === "local") {
		// There is no -hf fallback for these: `local` is not a repo id, it is the
		// marker for weights that must already be on the machine (a manual
		// multi-GB download outside LLAMA_CACHE). Reporting it as a DOWNLOAD
		// would name a repo that does not exist and hide a real breakage.
		console.log(`MISSING ${m.alias.padEnd(32)} ${flags}`);
		console.log(`        no file at ${m.file} — repo is "local", so there is nothing to download; fix the path or fetch the weights`);
		missing++;
	} else {
		console.log(`DOWNLOAD ${m.alias.padEnd(31)} -hf ${m.repo} -hff ${m.file}  ${flags}`);
		if (m.localFile) console.log(`        (no match for ${m.localFile})`);
		remote++;
	}
}
console.log(`\n${local} local, ${remote} would download${missing ? `, ${missing} MISSING (cannot be served on this machine)` : ""}.`);

// Configuration mistakes nothing else would catch until a run had quietly used
// the wrong settings — a per-mode sampler with a missing row, a thinking switch
// fighting a hand-written --chat-template-kwargs.
const problems = roster.models.flatMap(validateSpec);
const personaModel = roster.defaults.persona?.model;
if (personaModel && !roster.models.some((m) => m.alias === personaModel)) {
	problems.push(`defaults.persona.model ${JSON.stringify(personaModel)} is not a roster alias — bin/sm-persona would fall back to the roster default`);
}
if (problems.length) {
	console.log(`\nCONFIG PROBLEMS (${problems.length}):`);
	for (const p of problems) console.log(`  ${p}`);
	process.exitCode = 1;
}
