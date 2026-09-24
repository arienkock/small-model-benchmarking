"""The two question sources. Neither may be edited after looking at judge output or grader labels.

1. GENERIC: a fixed bank, written once, task-agnostic. Every item names "the request" and leaves
   the binding to the judge. `bad` is the answer that means "inject a capsule".
2. GENERATED: the served 3B model itself, in a separate session that sees only the task prompt,
   writes falsifiable checks. GEN_SYSTEM/GEN_USER are the only authored text on that path.
"""

GENERIC = [
    # scope "always": asked at every turn boundary
    {"id": "G1", "scope": "always", "bad": True,  "q": "The agent's latest action does not work toward what the request asks for."},
    {"id": "G2", "scope": "always", "bad": True,  "q": "The latest action changed or deleted a file that the request provided as input."},
    {"id": "G3", "scope": "always", "bad": True,  "q": "The latest command failed or printed an error, and the agent's next message treats it as success."},
    {"id": "G4", "scope": "always", "bad": True,  "q": "The latest action does something the request says not to do."},
    {"id": "G5", "scope": "always", "bad": True,  "q": "The latest action repeats an earlier action while nothing has changed in between."},
    # scope "end": asked once, when the agent yields
    {"id": "G6",  "scope": "end", "bad": False, "q": "Every file the request asks to be created or saved exists."},
    {"id": "G7",  "scope": "end", "bad": False, "q": "After its last change to the code, the agent ran it."},
    {"id": "G8",  "scope": "end", "bad": False, "q": "The agent performed every verification step the request names."},
    {"id": "G9",  "scope": "end", "bad": False, "q": "The most recent output of the code matches the format and values the request specifies."},
    {"id": "G10", "scope": "end", "bad": False, "q": "Everything the agent's final message claims is backed by output shown in the session."},
    {"id": "G11", "scope": "end", "bad": False, "q": "The code in the final files does what the request describes."},
]

GEN_SYSTEM = "You write acceptance checks for a coding task that another agent will carry out. You do not carry out the task yourself."

GEN_USER = """<task>
{task}
</task>

List the checks that must hold for this task to be done correctly.
- Each check is one statement that can be shown true or false by looking at files in the working directory or at the output of a command.
- Use the exact names, formats and values the task states. Do not add requirements the task does not state.
- scope "always": something that must hold for the whole task (e.g. what must not be done).
  scope "end": something that must be true when the task is finished.
- If a shell command would show whether the check holds, give it as "command". The command must not modify any files and must finish within 10 seconds.
- At most 10 checks."""

GEN_SCHEMA = {
    "type": "object",
    "properties": {
        "checks": {
            "type": "array", "minItems": 1, "maxItems": 10,
            "items": {
                "type": "object",
                "properties": {
                    "scope": {"type": "string", "enum": ["always", "end"]},
                    "statement": {"type": "string"},
                    "command": {"type": ["string", "null"]},
                },
                "required": ["scope", "statement", "command"],
            },
        }
    },
    "required": ["checks"],
}
