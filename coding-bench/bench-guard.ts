/**
 * bench-guard.ts — sandbox guard for the coding benchmark.
 *
 * Loaded explicitly via `-e` (works alongside --no-extensions). Its job is to
 * KEEP THE AGENT INSIDE ITS WORKSPACE even when the model ignores the system
 * prompt (small models ignore instructions; this enforces them).
 *
 *   write/edit : paths are normalized to the workspace. Hallucinated absolute
 *                paths (/d/llama.cpp/..., D:\..., /testbed, /home/ubuntu) and the
 *                run-root truncation pattern are rewritten to the file's
 *                basename IN THE WORKSPACE (correct content, correct place —
 *                graded instead of lost). Anything else outside the workspace
 *                is blocked. prompt.txt is read-only (it is the grading baseline).
 *   read       : hallucinated paths are rewritten; real absolute paths that
 *                exist (e.g. /etc/..., /tmp/server.log) are allowed through.
 *   bash       : hallucinated absolute paths in commands are rewritten to '.'.
 *                A denylist blocks machine-level damage and package installs.
 *                Bash timeouts are clamped into [30s, 120s].
 *
 * ---------------------------------------------------------------------------
 * 2026-09-12: URL-MANGLING FIX (this was the single biggest harness defect)
 *
 * The previous Windows-path rule was:
 *
 *     cmd.replace(/[A-Za-z]:[\\/][^\s;&|'"]*​/g, ".")
 *
 * `[A-Za-z]:[\\/]` matches the "p://" inside "http://". Every command
 * containing a URL was destroyed before it ran:
 *
 *     curl -s http://localhost:8000/api/todos      ->  curl -s htt.
 *     curl "http://host/api?distance=240&hours=5"  ->  curl "htt.&hours=5"
 *
 * That produced the `curl: (6) Could not resolve host: htt.` seen in nearly
 * every transcript of the 20260911-143308 run, for BOTH models, and is why
 * almost no HTTP verification succeeded. See bench-findings-143308.md §0.
 *
 * The fix is two-layer:
 *   1. URLs are masked out before any path rewriting and restored afterwards,
 *      so no path rule can ever touch a URL again regardless of its shape.
 *   2. The drive-letter rule additionally requires a real drive letter — a
 *      single character not preceded by another word character.
 * ---------------------------------------------------------------------------
 */

export default function (pi: ExtensionAPI) {
	const CWD = process.cwd();

	// ---------------------------------------------------------------- paths --
	// Does a path reference something outside the workspace in a way that is
	// certainly a hallucination (observed patterns from the 2026-09-11 runs)?
	const HALLUCINATION = /llama\.cpp|coding-bench|testbed|home\/ubuntu/i;

	// The task prompt is the grading baseline. LFM2.5 overwrote it in two
	// separate tasks of the 143308 run; never let that happen again.
	const PROTECTED = /^(?:\.\/)?prompt\.txt$/;

	function toPosix(p: string): string {
		return String(p).replace(/\\/g, "/");
	}

	// Strip Windows drive roots (D:/, C:\) and MSYS roots (/d/, /c/).
	function stripRoots(s: string): string {
		s = s.replace(/^[A-Za-z]:\//, "/");
		s = s.replace(/^\/[A-Za-z]\//, "/");
		return s;
	}

	// Decide the in-workspace replacement for a path.
	function workspacePath(p: string): string {
		const parts = toPosix(p).split("/").filter((x) => x.length > 0);
		// basename is right for every observed hallucination: the model meant
		// "<file> in my working directory"
		return parts[parts.length - 1] || ".";
	}

	function resolveInsideCwd(p: string): string | null {
		// returns normalized in-cwd path, or null if it escapes
		const s = toPosix(p);
		if (!s.startsWith("/")) {
			// relative: must not escape via ..
			const parts = s.split("/");
			let depth = 0;
			for (const part of parts) {
				if (part === "" || part === ".") continue;
				if (part === "..") {
					depth--;
					if (depth < 0) return null;
				} else depth++;
			}
			return s;
		}
		const stripped = stripRoots(s);
		if (stripped === CWD || stripped.startsWith(CWD + "/")) {
			return stripped.slice(CWD.length + 1) || ".";
		}
		return null;
	}

	// ------------------------------------------------------------ url masking --
	// Any scheme://rest token is replaced by an opaque placeholder for the
	// duration of path rewriting. NUL cannot appear in a model-authored command,
	// so the placeholder can never collide with real content.
	const URL_TOKEN = /[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s;&|'"`]*/g;

	function maskUrls(cmd: string): { masked: string; urls: string[] } {
		const urls: string[] = [];
		const masked = cmd.replace(URL_TOKEN, (m) => {
			urls.push(m);
			return `\u0000U${urls.length - 1}\u0000`;
		});
		return { masked, urls };
	}

	function unmaskUrls(cmd: string, urls: string[]): string {
		return cmd.replace(/\u0000U(\d+)\u0000/g, (_m, i) => urls[Number(i)] ?? "");
	}

	// ---------------------------------------------------------------- hook --
	pi.on("tool_call", async (event: any, _ctx: any) => {
		const tool = event.toolName as string;
		const input = event.input as any;

		// ------------------------------------------------------ write / edit --
		if (tool === "write" || tool === "edit") {
			if (typeof input.path === "string") {
				const inside = resolveInsideCwd(input.path);
				if (inside !== null && PROTECTED.test(inside)) {
					return {
						block: true,
						reason:
							"Blocked: prompt.txt is the task description and is read-only. " +
							"Write your deliverables to the filenames the task asks for.",
					};
				}
				if (inside !== null) {
					input.path = inside;
				} else if (HALLUCINATION.test(input.path)) {
					input.path = workspacePath(input.path);
				} else if (toPosix(input.path).startsWith("/tmp/")) {
					// /tmp is inside the container: allow (logs), harmless
				} else {
					return {
						block: true,
						reason:
							`Blocked: "${input.path}" is outside the working directory. ` +
							`Write files by their bare name (e.g. server.py) in the current directory.`,
					};
				}
			}
			return;
		}

		// -------------------------------------------------------------- read --
		if (tool === "read") {
			if (typeof input.path === "string" && HALLUCINATION.test(input.path)) {
				const inside = resolveInsideCwd(input.path);
				input.path = inside !== null ? inside : workspacePath(input.path);
			}
			return; // real absolute reads (/etc, /tmp, ...) pass through
		}

		// -------------------------------------------------------------- bash --
		if (tool === "bash") {
			let cmd: string = input.command ?? "";

			// URLs are taken out of play first — see the header comment. Every
			// path rule below operates on a command with no URLs left in it.
			const { masked, urls } = maskUrls(cmd);
			cmd = masked;

			// Rewrite hallucinated absolute paths in commands:
			//   /d/llama.cpp/...  D:\llama.cpp\...  /testbed  /home/ubuntu  /c/Users/...
			// Replaced with '.' so `cd <path> && cmd` becomes `cd . && cmd`.
			cmd = cmd
				.replace(
					/(?:[A-Za-z]:[\\/]|\/[A-Za-z]\/)?[^\s;&|'"]*(?:llama\.cpp|coding-bench|testbed|home\/ubuntu)[^\s;&|'"]*/gi,
					"."
				)
				// A drive letter is ONE character and is never preceded by another
				// word character. Without this guard the rule ate "http://...".
				.replace(/(?<![A-Za-z0-9_])[A-Za-z]:[\\/][^\s;&|'"]*/g, ".")
				.replace(/\/[A-Za-z]\/(?:Users|Windows|Program Files)[^\s;&|'"]*/g, ".");

			cmd = unmaskUrls(cmd, urls);

			// Denylist: machine-level damage, self-sabotage, or rule-breaking.
			const denied: [RegExp, string][] = [
				[/\b(taskkill|wmic|shutdown|killall)\b/i, "not available in this environment"],
				[/\bdocker\b/i, "docker is not available to the agent"],
				[/\bpowershell|\bcmd\.exe\b/i, "Windows tools are not available in this environment"],
				[/\brm\s+[^&;|]*\s\/(\s|$)/, "refusing to delete the filesystem root"],
				[/\bkill\s+(-\S+\s+)?(1|\$PPID)\b/, "refusing to kill PID 1 or the parent process"],
				[/\bpkill\b[^&;|]*(\bnode\b|\bpi\b)/i, "refusing to kill the agent process"],
				// The tasks say "do not install packages" and "run TypeScript with
				// node file.ts". MiniCPM5 ran `npm install typescript` and npx
				// ts-node/tsx/esbuild in the 143308 run, which both breaks the rule
				// and hides the model's actual TypeScript ability behind a toolchain.
				[
					/\b(?:npm|pnpm|yarn)\s+(?:i|install|add)\b/i,
					"package installation is disabled in this benchmark",
				],
				[/\bnpx\b/i, "npx is disabled — run TypeScript directly with `node file.ts`"],
				[
					/\bpip3?\s+install\b/i,
					"package installation is disabled — use the Python standard library",
				],
			];
			for (const [re, why] of denied) {
				if (re.test(cmd)) {
					return {
						block: true,
						reason:
							`Blocked: "${(cmd.match(re) || [""])[0]}" — ${why}. ` +
							`Work in the current directory; stop your own background servers with the pid from $!.`,
					};
				}
			}

			input.command = cmd;

			// Timeout clamping, both directions:
			//   floor 30s — server + curl verification needs more than the 3-10s
			//               the models pick for themselves.
			//   ceiling 120s — a server started in the FOREGROUND never returns.
			//               In the 143308 run that burned the entire 30-minute
			//               budget on several tasks (MiniCPM5 tasks 1, 9, 10).
			//               Capping it costs the model 2 minutes and gives it a
			//               timeout message it can actually react to.
			const t = input.timeout;
			if (typeof t !== "number" || t < 30) input.timeout = 30;
			else if (t > 120) input.timeout = 120;
			return;
		}
	});
}
