# workflow/tasks/ — pluggable tasks

The harness (`../run.ts`, `../../lib/workflow*.ts`, `../check.py`) knows nothing
about any particular task: no language, test framework, file layout, dependency
policy or grading. A task is a directory with a `task.json`. The directory is
all it takes to run a task through the workflow:

    node workflow/run.ts --task workflow/tasks/<name> --model <alias>

## task.json

Only `prompt` is required.

| field | meaning |
|---|---|
| `prompt` | The markdown file holding the task text, given to the model verbatim. For a coding-bench task, use the same text the bench gave. |
| `testCommand` | The shell command, run from `/workspace` in the sandbox, that runs the whole test suite. Exit 0 means pass. **If omitted, the breakdown step makes the model propose one** (`test_command`), and every later check uses that. |
| `testFiles` | Globs, relative to `/workspace`, of the files that hold tests. The harness looks for scenario ids there. Omitted: any file whose path contains `test` or `spec`. |
| `testCountPattern` | A regex over the test output whose first group is the number of tests run, e.g. `"^Ran (\\d+) tests?"` for unittest. When set, a run that reports 0 tests, or doesn't match at all, fails. That closes the "exit 0 because nothing ran" hole. |
| `conventions` | Task-specific rules shown in every step: test framework, layout, constraints worth repeating. The harness's own rules are generic. |
| `checks` | `[{ "name", "command" }]`: extra shell commands run from `/workspace` after the suite, each exit 0 = pass. A failing check is fed back to the model like a failing test, with its output. |
| `grader` | A shell command run once after the workflow, in a no-network container, from `/workspace`, with this directory mounted at `/task`. Its output is saved as `grade.json`. If its last line is JSON with `passed` and `total`, that is the score. **The model never sees the grader.** |
| `seed` | A directory copied into the workspace before the first step: existing code to work on. Any file in the workspace at the start counts as existing work, so T1 also gets an integration step. |
| `config` | Overrides for `DEFAULT_CONFIG` that suit this task, e.g. `{ "scenarios": { "minHappy": 2, "minUnhappy": 2 } }` for a small one. |

What the model can see from the task directory: only `checks/`, mounted at
`/task/checks` (read-only), because a check may call a script there and the
model has to be able to pass it. The rest of the directory, including the
grader, is not mounted into the model's container.

Reusable checks that are not part of the harness live in `../checks/`, mounted
at `/opt/pi-small/workflow/checks`:

| script | checks |
|---|---|
| `python_stdlib_only.py` | Python files import only the standard library or workspace modules |

## What the harness always does, whatever the task

- scenarios → breakdown → a plan per task → implement → integrate, each step in
  a fresh session ending with a validated submission;
- every scenario id (`S3`, `T2.S1` → `T2_S1`) must appear in some test file,
  cumulatively. From the second task on, or when a seed existed, the `I<k>`
  integration tokens must appear too. This is a plain-text search, so any
  language works: `def test_T2_S1_x`, `it("T2_S1: x")`, `#[test] fn test_T2_S1_x`;
- the test command must pass within `testTimeoutSec`, and so must every task
  check;
- nudges, fresh retries and the stop rule, as in `../README.md`.

## Porting a coding-bench task

The filter tasks in `coding-bench/prompts-filter.txt` fit this shape directly.
For example, a `debounce` task directory would hold:
- `prompt.md`: the bench prompt, verbatim;
- `task.json`, with:
  - `testCommand` set to the node test runner over the tests the model writes
    (or omitted, so the model proposes one);
  - `checks` running the task's own acceptance rule, e.g. "`node debounce.ts`
    prints `all tests passed`";
  - `grader` wrapping `coding-bench/graders/debounce.grader.ts`, so the score is
    comparable with the bench rounds.

The sandbox image (`../../docker/Dockerfile`) has Python 3, Node 24 with
TypeScript, gcc and Rust. A task that needs another toolchain needs it added
there.

## Tasks

| task | what |
|---|---|
| `books-api/` | A CRUD + search REST API for books. Python standard library only (a task check), unittest (the task's test command), black-box grader with 28 checks. |
