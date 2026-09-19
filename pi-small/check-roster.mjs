#!/usr/bin/env node
/**
 * check-roster.mjs — resolve every roster entry without starting anything.
 *
 * The pi-small equivalent of run-filter-bench.sh --check-models: says, for each
 * model, whether the weights are on this machine (and where), or whether the
 * run would fall back to -hf and download them. Uses the plugin's own resolver,
 * so it cannot drift from what a real session would do.
 *
 *   node check-roster.mjs
 */
import { loadRoster, resolveLocalPath } from "./extensions/small.ts";

const roster = loadRoster();
const cache = process.env.LLAMA_CACHE ?? roster.defaults.llamaCache ?? "(unset)";
console.log(`LLAMA_CACHE: ${cache}\n`);

let local = 0;
let remote = 0;
for (const m of roster.models) {
	const pattern = m.localFile ?? (m.repo === "local" ? m.file : null);
	const hit = pattern ? resolveLocalPath(pattern) : null;
	const flags = [
		m.default ? "default" : "",
		m.ctx ? `ctx=${m.ctx}` : "",
		m.chatTemplate ? `template=${m.chatTemplate}` : "",
		m.serverArgs?.length ? `args=${m.serverArgs.join(" ")}` : "",
	].filter(Boolean).join(" ");
	if (hit) {
		const gb = (await import("node:fs")).statSync(hit).size / 1e9;
		console.log(`LOCAL   ${m.alias.padEnd(32)} ${gb.toFixed(2)} GB  ${flags}`);
		console.log(`        ${hit}`);
		local++;
	} else {
		console.log(`DOWNLOAD ${m.alias.padEnd(31)} -hf ${m.repo} -hff ${m.file}  ${flags}`);
		if (pattern) console.log(`        (no match for ${pattern})`);
		remote++;
	}
}
console.log(`\n${local} local, ${remote} would download.`);
