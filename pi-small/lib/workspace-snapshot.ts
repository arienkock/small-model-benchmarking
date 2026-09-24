/**
 * workspace-snapshot.ts — save and restore a workspace, for WorkflowConfig
 * retryWorkspace "reset": a retried step starts from the files the step
 * started with, not from the failed attempt's.
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const safe = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, "_");

/** Copy `ws` to `<store>/<key>`. An existing copy is kept (a resumed run keeps the step's original) unless `replace`. */
export function snapshotWorkspace(ws: string, store: string, key: string, replace = false): void {
	const to = join(store, safe(key));
	if (existsSync(to)) {
		if (!replace) return;
		rmSync(to, { recursive: true, force: true });
	}
	mkdirSync(to, { recursive: true });
	for (const e of readdirSync(ws)) cpSync(join(ws, e), join(to, e), { recursive: true });
}

/** Empty `ws` (the directory itself stays: it may be a mount) and copy `<store>/<key>` back into it. */
export function restoreWorkspace(ws: string, store: string, key: string): void {
	const from = join(store, safe(key));
	if (!existsSync(from)) throw new Error(`no workspace snapshot ${from}`);
	for (const e of readdirSync(ws)) rmSync(join(ws, e), { recursive: true, force: true });
	for (const e of readdirSync(from)) cpSync(join(from, e), join(ws, e), { recursive: true });
}
