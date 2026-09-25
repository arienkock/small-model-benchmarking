/**
 * fix-script.mjs — plays the model for the fix-loop end-to-end test
 * (test/fix-e2e.ts), loaded by stub-server.mjs via PI_SMALL_STUB_SCRIPT.
 *
 * The seed is test/fixtures/books-reference with one crash put back in: the
 * `id=` filter's int() without its try/except (fix-e2e.ts does that). The
 * scripted run takes every path of lib/fix-loop.ts once:
 *
 *   round 1  the probe's fuzzer finds the crash → no review. The first fix
 *            attempt breaks app.py (a syntax error) and stops without
 *            report_done → the host's gate fails → the workspace is reverted
 *            and the NEXT fixer gets the same finding plus "An earlier
 *            attempt … failed" → it restores the try/except, adds a test,
 *            and calls report_done.
 *   round 2  the probe is clean → a review (told what the machine checks
 *            cover) submits one medium and one low finding → a fix session
 *            for the medium one only.
 *   round 3  the probe is clean → the review submits only a low finding →
 *            the loop ends "clean".
 *
 * Sessions are told apart by their first user message: "# Fix" or "# Review",
 * and for a fix, which findings it lists. The two reviews ask the same thing,
 * so the reviewer looks before it answers, like a real one: its first turn
 * greps app.py for the round-2 fix's marker, and its second submits based on
 * that tool result. Nothing is kept in this module — the stub restarts on
 * every model switch.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REFERENCE_APP = readFileSync(join(HERE, "books-reference", "app.py"), "utf8");

const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content ?? []).map((p) => p.text ?? "").join(""));
const tool = (name, args) => ({ kind: "tool", name, args });
const write = (path, content) => tool("bash", { command: `mkdir -p tests && cat > ${path} <<'PYEOF'\n${content.trimEnd()}\nPYEOF` });

/** test/fix-e2e.ts expects exactly these two. */
export const MEDIUM = { priority: "medium", title: "GET /books ignores a blank q", where: "app.py", detail: "q= with an empty value should match every book" };
export const LOW = { priority: "low", title: "error messages could name the field", where: "app.py", detail: "cosmetic" };

const ID_TEST = `
import threading
import unittest
import urllib.error
import urllib.request

from app import create_server


class IdFilterTests(unittest.TestCase):
    def setUp(self):
        self.server = create_server(0)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def test_id_filter_that_is_not_an_integer_is_400(self):
        url = f"http://127.0.0.1:{self.server.server_address[1]}/books?id=abc"
        with self.assertRaises(urllib.error.HTTPError) as e:
            urllib.request.urlopen(url, timeout=5)
        self.assertEqual(e.exception.code, 400)
`;

/** What the round-2 fix appends to app.py, and what the reviewer greps for. */
const MARKER = "# q: reviewed";

const FIX_SEQ = {
	// Round 1, first attempt: makes things worse and never reports.
	breaks: [tool("bash", { command: "echo 'def broken(:' >> app.py" }), { kind: "text", text: "Done." }],
	// Round 1, the retry: the reference app.py (with its try/except) and a test for the crash.
	repairs: [write("app.py", REFERENCE_APP), write("tests/test_fix_id.py", ID_TEST), tool("report_done", { summary: "id= that is not an integer now answers 400; test added" })],
	// Round 2: the review's medium finding. A real (harmless) edit, then report.
	medium: [tool("bash", { command: `printf '\\n${MARKER}\\n' >> app.py` }), tool("report_done", { summary: "looked at q" })],
};

export function respond(payload) {
	const messages = payload.messages ?? [];
	const first = textOf(messages.find((m) => m.role === "user"));
	const turn = messages.filter((x) => x.role === "assistant").length;

	if (/^# Review\b/.test(first)) {
		if (turn === 0) return tool("bash", { command: `grep -c '${MARKER}' app.py || true` });
		if (turn > 1) return { kind: "text", text: "Nothing more to do." };
		const result = textOf(messages.filter((m) => m.role === "tool" || m.role === "toolResult").at(-1)).trim();
		const fixed = /^[1-9]/.test(result);
		return tool("submit_findings", { findings: fixed ? [LOW] : [MEDIUM, LOW] });
	}
	if (/^# Fix\b/.test(first)) {
		const seq = first.includes(MEDIUM.title)
			? FIX_SEQ.medium
			: /## An earlier attempt at these fixes failed/.test(first)
				? FIX_SEQ.repairs
				: FIX_SEQ.breaks;
		return seq[turn] ?? { kind: "text", text: "Nothing more to do." };
	}
	return undefined; // the plugin's own probes: default stub behaviour
}
