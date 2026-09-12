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
 *                is blocked.
 *   read       : hallucinated paths are rewritten; real absolute paths that
 *                exist (e.g. /etc/..., /tmp/server.log) are allowed through.
 *   bash       : hallucinated absolute paths in commands are rewritten to '.'.
 *                A small denylist blocks machine-level damage (taskkill, wmic,
 *                docker, killall, rm -rf /, killing PID 1 or pi itself).
 *                Short bash timeouts are raised to 30s so server+curl
 *                verification can complete.
 *
 * This is belt-and-braces on top of the docker sandbox: the container already
 * prevents host damage; this guard makes sure work lands where the grader
 * looks, and stops self-sabotage inside the container.
 */

export default function (pi: ExtensionAPI) {
	const CWD = process.cwd();

	// ---------------------------------------------------------------- paths --
	// Does a path reference something outside the workspace in a way that is
	// certainly a hallucination (observed patterns from the 2026-09-11 runs)?
	const HALLUCINATION = /llama\.cpp|coding-bench|testbed|home\/ubuntu/i;

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

	// ---------------------------------------------------------------- hook --
	pi.on("tool_call", async (event: any, _ctx: any) => {
		const tool = event.toolName as string;
		const input = event.input as any;

		// ------------------------------------------------------ write / edit --
		if (tool === "write" || tool === "edit") {
			if (typeof input.path === "string") {
				const inside = resolveInsideCwd(input.path);
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

			// Rewrite hallucinated absolute paths in commands:
			//   /d/llama.cpp/...  D:\llama.cpp\...  /testbed  /home/ubuntu  /c/...
			// Replaced with '.' so `cd <path> && cmd` becomes `cd . && cmd`.
			cmd = cmd
				.replace(
					/(?:[A-Za-z]:[\\/]|\/[A-Za-z]\/)?[^\s;&|'"]*(?:llama\.cpp|coding-bench|testbed|home\/ubuntu)[^\s;&|'"]*/gi,
					"."
				)
				.replace(/[A-Za-z]:[\\/][^\s;&|'"]*/g, ".")
				.replace(/\/[A-Za-z]\/(?:Users|Windows|Program Files)[^\s;&|'"]*/g, ".");

			// Denylist: machine-level damage or self-sabotage. In the docker
			// sandbox these are mostly impossible anyway; cheap to keep.
			const denied: [RegExp, string][] = [
				[/\b(taskkill|wmic|shutdown|killall)\b/i, "not available in this environment"],
				[/\bdocker\b/i, "docker is not available to the agent"],
				[/\bpowershell|\bcmd\.exe\b/i, "Windows tools are not available in this environment"],
				[/\brm\s+[^&;|]*\s\/(\s|$)/, "refusing to delete the filesystem root"],
				[/\bkill\s+(-\S+\s+)?(1|\$PPID)\b/, "refusing to kill PID 1 or the parent process"],
				[/\bpkill\b[^&;|]*(\bnode\b|\bpi\b)/i, "refusing to kill the agent process"],
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

			// Server + curl verification needs more than the 3-10s the models pick.
			if (typeof input.timeout === "number" && input.timeout < 15) {
				input.timeout = 30;
			}
			return;
		}
	});
}
