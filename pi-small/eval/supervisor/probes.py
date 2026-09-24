"""Evidence the supervisor gathers itself, against the FINAL workspace of each run.

  generic    - the files in the workspace, read back (done here, no execution)
             - a re-run of the last command in the transcript that executed code
  generated  - every command the model's own checklists proposed

Commands run on the laptop in coding-bench-agent (the image the agents ran in), no network, a
fresh copy of the workspace per command, 10 s limit, process group killed afterwards.

  python3 probes.py plan <generic|generated>      -> out/probe-jobs-<batch>/  (copy to the laptop, run run-probes-laptop.sh)
  python3 probes.py collect <batch> <dir-with-results>   -> appends to out/probes.jsonl
"""
import json, os, re, shutil, sys
from corpus import corpus, turns

HERE = os.path.dirname(os.path.abspath(__file__))
EXEC_RE = re.compile(r"\b(node|python3?|npx|tsx|deno|bun|curl)\b|(^|[\s;&|])\./")


def last_exec_command(run):
    last = None
    for t in turns(run["msgs"]):
        for c in t["assistant"]["content"]:
            if c.get("type") == "toolCall" and c["name"] == "bash":
                cmd = str((c.get("arguments") or {}).get("command", ""))
                if EXEC_RE.search(cmd): last = cmd
    return last


def files_evidence(run, limit=2500):
    out = [f"$ ls\n" + "\n".join(run["files"])]
    for f in run["files"]:
        if f == "prompt.txt": continue   # the input, not something the agent made; G2 sees the diff below
        body = open(os.path.join(run["dir"], f), errors="replace").read()
        out.append(f"$ cat {f}\n" + (body if len(body) <= limit else body[:limit] + f"\n[... {len(body) - limit} more chars]"))
    original = run["msgs"][0]["content"]
    orig_text = "".join(c.get("text", "") for c in original) if isinstance(original, list) else str(original)
    changed = run["prompt"].strip() not in orig_text
    out.append("input files changed since the start: " + ("prompt.txt" if changed else "none"))
    return "\n".join(out)


def checklists():
    p = os.path.join(HERE, "out", "checklists.jsonl")
    out = {}
    if os.path.exists(p):
        for line in open(p):
            e = json.loads(line)
            out.setdefault((e["model"], e["prompt_id"]), []).append(e)
    return out


def plan(batch):
    """batch 'generic': the last-exec re-run only; 'generated': every checklist command."""
    cls = checklists() if batch.startswith("generated") else {}
    only = os.environ.get("PROBE_MODELS")   # e.g. a batch for one late model
    if only: cls = {k: v for k, v in cls.items() if k[0] in only.split(",")}
    jobdir = os.path.join(HERE, "out", f"probe-jobs-{batch}")
    shutil.rmtree(jobdir, ignore_errors=True)
    index = {}
    for r in corpus():
        cmds = {}
        le = last_exec_command(r) if batch == "generic" else None
        if le: cmds[le] = ["generic:last_exec"]
        for cl in cls.get((r["model"], r["prompt_id"]), []):
            for i, ch in enumerate(cl["checks"]):
                if ch.get("command"): cmds.setdefault(ch["command"], []).append(f"gen:{cl['k']}:{i}")
        rid = r["id"].replace("/", "__")
        d = os.path.join(jobdir, rid, "cmds")
        os.makedirs(d)
        for n, cmd in enumerate(cmds):
            open(os.path.join(d, str(n)), "w").write(cmd)
        index[rid] = {"run": r["id"], "src": f"/d/llama.cpp/coding-bench/{r['round']}/{os.path.basename(r['dir'])}",
                      "cmds": [{"n": n, "cmd": c, "keys": k} for n, (c, k) in enumerate(cmds.items())]}
    json.dump(index, open(os.path.join(jobdir, "index.json"), "w"), indent=1)
    print(len(index), "runs,", sum(len(v["cmds"]) for v in index.values()), "commands ->", jobdir)


def collect(resdir, batch):
    index = json.load(open(os.path.join(HERE, "out", f"probe-jobs-{batch}", "index.json")))
    with open(os.path.join(HERE, "out", "probes.jsonl"), "a") as f:
        for rid, job in index.items():
            for c in job["cmds"]:
                base = os.path.join(resdir, rid, "out", str(c["n"]))
                out = open(base + ".out", errors="replace").read() if os.path.exists(base + ".out") else None
                rc = open(base + ".rc").read().strip() if os.path.exists(base + ".rc") else None
                f.write(json.dumps({"run": job["run"], "cmd": c["cmd"], "keys": c["keys"], "out": out, "rc": rc}) + "\n")
    print("collected")


if __name__ == "__main__":
    {"plan": lambda: plan(sys.argv[2]), "collect": lambda: collect(sys.argv[3], sys.argv[2])}[sys.argv[1]]()
