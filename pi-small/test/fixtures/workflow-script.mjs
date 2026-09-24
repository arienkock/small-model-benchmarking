/**
 * workflow-script.mjs — plays the model for the workflow end-to-end test
 * (test/workflow-e2e.ts), loaded by stub-server.mjs via PI_SMALL_STUB_SCRIPT.
 *
 * It recognises the step from the "# Workflow step: <kind> [Tk]" header of the
 * session's first user message and replays a fixed sequence, indexed by how
 * many assistant turns the session already has. The sequences deliberately
 * take every recovery path the harness has, once:
 *
 *   scenarios     in batches: 5 happy, then a batch with a bad item -> tool error, then the 3 unhappy with done: true
 *   breakdown     ends with prose and no tool call -> host nudges (pi --continue) -> valid
 *   implement T1  writes a failing test -> report_done refused by check.py -> fixes -> accepted
 *   integrate T2  T2 has an earlier task, so the harness asks for integration tests
 *
 * The code it "writes" is test/fixtures/books-reference, which also passes the
 * acceptance grader, so the e2e test checks the grader's verdict too.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REF = join(dirname(fileURLToPath(import.meta.url)), "books-reference");
const file = (p) => readFileSync(join(REF, p), "utf8");

const textOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content ?? []).map((p) => p.text ?? "").join(""));
const tool = (name, args) => ({ kind: "tool", name, args });
const say = (text) => ({ kind: "text", text });
const write = (path, content) => tool("bash", { command: `mkdir -p tests && cat > ${path} <<'PYEOF'\n${content.trimEnd()}\nPYEOF` });
const done = (summary) => tool("report_done", { summary });

const sc = (kind, title, given, when, then) => ({ kind, title, given, when, then });
const SCENARIOS = [
	sc("happy", "Create a book", "an empty store", "POST /books with title Dune, author Frank Herbert, isbn 9780441013593", "201 with the book and id 1"),
	sc("happy", "Get a book", "book 1 exists", "GET /books/1", "200 with that book"),
	sc("happy", "Filter by author", "books by Herbert and Austen", "GET /books?author=austen", "200 with only the Austen book"),
	sc("happy", "Update a book", "book 1 exists", "PUT /books/1 with title Dune Messiah", "200 and title is Dune Messiah"),
	sc("happy", "Delete a book", "book 1 exists", "DELETE /books/1", "204, then GET /books/1 is 404"),
	sc("unhappy", "Create without title", "an empty store", 'POST /books with {"author": "A", "isbn": "1"}', "400 with an error field"),
	sc("unhappy", "Unknown id", "an empty store", "GET /books/99", "404 with an error field"),
	sc("unhappy", "Unknown query parameter", "any store", "GET /books?colour=red", "400 with an error field"),
];

const SEQ = {
	scenarios: [
		tool("submit_scenarios", { scenarios: SCENARIOS.filter((s) => s.kind === "happy"), done: false }),
		tool("submit_scenarios", { scenarios: [{ ...SCENARIOS[5], then: "" }], done: false }),
		tool("submit_scenarios", { scenarios: SCENARIOS.filter((s) => s.kind === "unhappy"), done: true }),
	],
	breakdown: [
		say("I would build an in-memory store first and the HTTP layer second."),
		tool("submit_breakdown", {
			tasks: [
				{ title: "In-memory book store", goal: "store.py holds books in memory with validation, ids and search.", files: ["store.py", "tests/test_t1_store.py"], covers: [] },
				{
					title: "HTTP API",
					goal: "app.py serves the REST endpoints over the store on $PORT.",
					files: ["app.py", "tests/test_t2_api.py"],
					covers: ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"],
				},
			],
		}),
	],
	"task_plan T1": [
		tool("submit_task_plan", {
			scenarios: [
				sc("happy", "Ids increase", "an empty store", "create two books", "ids are 1 and 2"),
				sc("unhappy", "Missing title rejected", "an empty store", "create without title", "ValidationError is raised"),
			],
			logic: ["BookStore keeps a dict id -> book and a next-id counter", "validate() checks required non-empty strings"],
		}),
	],
	"task_plan T2": [
		tool("submit_task_plan", {
			scenarios: [
				sc("happy", "Post then list", "an empty server", "POST a book then GET /books", "200 with one book"),
				sc("unhappy", "Invalid JSON", "a running server", "POST /books with body {nope", "400"),
			],
			logic: ["ThreadingHTTPServer with a handler per method", "Route /books and /books/{id} with a regex"],
		}),
	],
	"implement T1": [
		write("store.py", file("store.py")),
		write("tests/test_t1_store.py", file("tests/test_t1_store.py").replace("(1, 2)", "(1, 3)")),
		done("Store implemented."),
		write("tests/test_t1_store.py", file("tests/test_t1_store.py")),
		done("Store implemented; fixed the id test."),
	],
	"implement T2": [write("app.py", file("app.py")), write("tests/test_t2_api.py", file("tests/test_t2_api.py")), done("HTTP API implemented.")],
	"integrate T2": [write("tests/test_integration_t2.py", file("tests/test_integration_t2.py")), done("Integration test added.")],
};

export function respond(payload) {
	const messages = payload.messages ?? [];
	const first = messages.find((m) => m.role === "user");
	const m = /# Workflow step: (\w+)(?: (T\d+))?/.exec(textOf(first));
	if (!m) return undefined; // not a workflow session (the plugin's probes): default stub behaviour
	const seq = SEQ[m[2] ? `${m[1]} ${m[2]}` : m[1]];
	if (!seq) return say(`workflow-script: no sequence for ${m[0]}`);
	const turn = messages.filter((x) => x.role === "assistant").length;
	return seq[turn] ?? say("Nothing more to do.");
}
