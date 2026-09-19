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
import { loadRoster, weightsSource } from "./lib/roster.ts";

const roster = loadRoster();
const cache = process.env.LLAMA_CACHE ?? roster.defaults.llamaCache ?? "(unset)";
console.log(`LLAMA_CACHE: ${cache}\n`);

let local = 0;
let remote = 0;
for (const m of roster.models) {
	const { local: hit } = weightsSource(m);
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
		if (m.localFile) console.log(`        (no match for ${m.localFile})`);
		remote++;
	}
}
console.log(`\n${local} local, ${remote} would download.`);
