/**
 * pi-rpc.ts — the one pi-small process of a workflow run, driven over pi's RPC
 * mode (`pi --mode rpc`: JSON lines on stdin/stdout, see pi's docs/rpc.md).
 * run.ts starts it (in the sandbox container, or directly with --local) and
 * sends it one command, `/workflow run <spec>`; the plugin does the rest.
 */

import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";

type Listener = (ev: any) => void;

export class PiRpc {
	private proc: ChildProcess | null = null;
	private buf = "";
	private listeners = new Set<Listener>();
	private seq = 0;

	private readonly command: string;
	private readonly argv: string[];
	private readonly options: { cwd?: string; env?: NodeJS.ProcessEnv };
	private readonly container: string | null;
	private readonly events: string;
	private readonly stderr: string;

	/**
	 * @param command   `docker` (with `run -i … pi-small --mode rpc`) or `bash` (--local)
	 * @param container the container name, for kill; null for a local process
	 * @param events    file every event but streaming deltas is appended to
	 * @param stderr    file stderr is appended to
	 */
	// Plain fields, not constructor parameter properties: Node's built-in type
	// stripping (how these .ts files run) rejects the latter.
	constructor(command: string, argv: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }, container: string | null, events: string, stderr: string) {
		this.command = command;
		this.argv = argv;
		this.options = options;
		this.container = container;
		this.events = events;
		this.stderr = stderr;
	}

	get alive(): boolean {
		return this.proc !== null && this.proc.exitCode === null && this.proc.signalCode === null;
	}

	start(): void {
		const p = spawn(this.command, this.argv, { ...this.options, stdio: ["pipe", "pipe", "pipe"] });
		p.stdout!.on("data", (d: Buffer) => {
			this.buf += d.toString("utf8");
			for (let i = this.buf.indexOf("\n"); i >= 0; i = this.buf.indexOf("\n")) {
				const line = this.buf.slice(0, i).trim();
				this.buf = this.buf.slice(i + 1);
				if (!line) continue;
				let ev: any;
				try {
					ev = JSON.parse(line);
				} catch {
					appendFileSync(this.stderr, `[non-JSON stdout] ${line}\n`);
					continue;
				}
				// Token-by-token deltas would make the log enormous; everything else is kept.
				if (ev.type !== "message_update") appendFileSync(this.events, JSON.stringify({ ts: new Date().toISOString(), ...ev }) + "\n");
				for (const l of [...this.listeners]) l(ev);
			}
		});
		p.stderr!.on("data", (d: Buffer) => appendFileSync(this.stderr, d));
		p.on("close", (code) => {
			appendFileSync(this.stderr, `[pi process exited: ${code}]\n`);
			for (const l of [...this.listeners]) l({ type: "__exit__", code });
		});
		this.proc = p;
	}

	/** Send a command; resolves with its `response` (matched by id). */
	send(cmd: Record<string, unknown>, timeoutMs = 120_000): Promise<any> {
		const id = `wf-${++this.seq}`;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.listeners.delete(l);
				reject(new Error(`no response to ${cmd.type} within ${timeoutMs / 1000} s`));
			}, timeoutMs);
			const l: Listener = (ev) => {
				if (ev.type === "response" && ev.id === id) {
					clearTimeout(timer);
					this.listeners.delete(l);
					resolve(ev);
				} else if (ev.type === "__exit__") {
					clearTimeout(timer);
					this.listeners.delete(l);
					reject(new Error(`pi exited (${ev.code}) before answering ${cmd.type}`));
				}
			};
			this.listeners.add(l);
			this.proc!.stdin!.write(JSON.stringify({ id, ...cmd }) + "\n");
		});
	}

	/**
	 * Resolves true when an event matching `pred` arrives, false after
	 * `timeoutMs`. Register it BEFORE sending the command that causes the event.
	 */
	waitFor(pred: (ev: any) => boolean, timeoutMs: number): Promise<boolean> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.listeners.delete(l);
				resolve(false);
			}, timeoutMs);
			const l: Listener = (ev) => {
				if (pred(ev)) {
					clearTimeout(timer);
					this.listeners.delete(l);
					resolve(true);
				} else if (ev.type === "__exit__") {
					clearTimeout(timer);
					this.listeners.delete(l);
					reject(new Error(`pi exited (${ev.code})`));
				}
			};
			this.listeners.add(l);
		});
	}

	kill(): void {
		if (this.container) spawnSync("docker", ["kill", this.container], { stdio: "ignore" });
		else this.proc?.kill("SIGKILL");
	}

	/** End the process: close stdin, give it a moment, then kill. */
	async close(): Promise<void> {
		if (!this.alive) return;
		const exited = this.waitFor((ev) => ev.type === "__exit__", 15_000).catch(() => true);
		this.proc!.stdin!.end();
		if (!(await exited)) this.kill();
	}
}
