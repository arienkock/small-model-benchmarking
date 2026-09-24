"""Source 2: have each model write its own checklists, from the task prompt alone.

  python3 gen_checks.py <alias> [--n 5] [--url http://127.0.0.1:18123]

The model must already be served (pi-small serve.mjs <alias>, on the laptop, tunnelled here).
Sampler = the model's roster entry, as a pi-small session would get it. Output is constrained by
json_schema. Appends to out/checklists.jsonl; skips (alias, prompt, k) already done.
"""
import argparse, json, os, re, time, urllib.request
from corpus import corpus
from questions import GEN_SCHEMA, GEN_SYSTEM, GEN_USER

NO_SCHEMA_FORMAT = 'Reply with only a JSON object of this shape: {"checks": [{"scope": "always" or "end", "statement": "...", "command": "..." or null}]}'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "out", "checklists.jsonl")


def repair(content):
    """No-grammar output only: take the outermost object and escape stray backslashes (shell
    commands inside JSON strings), which a schema grammar would have prevented."""
    content = content[content.find("{"): content.rfind("}") + 1]
    out, i = [], 0
    while i < len(content):
        ch = content[i]
        if ch == "\\":
            nxt = content[i + 1] if i + 1 < len(content) else ""
            if nxt and nxt in '"\\/bfnrtu':
                out.append(ch + nxt); i += 2; continue
            out.append("\\\\"); i += 1; continue
        out.append(ch); i += 1
    return "".join(out)


def roster_sampler(alias):
    r = json.load(open(os.path.join(HERE, "../../roster.json")))
    d, m = r["defaults"], next(x for x in r["models"] if x["alias"] == alias)
    g = lambda k: m.get(k, d.get(k))
    return {"temperature": g("temp"), "top_p": g("topP"), "top_k": g("topK"), "repeat_penalty": g("repeatPenalty"),
            "min_p": g("minP"), "presence_penalty": g("presencePenalty")}, d["apiKey"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("alias"); ap.add_argument("--n", type=int, default=5)
    ap.add_argument("--url", default="http://127.0.0.1:18123"); ap.add_argument("--max-tokens", type=int, default=3000)
    # Nanbeige's template breaks llama.cpp's schema grammar ("Unexpected empty grammar stack after
    # accepting piece: assistant"), so for it: no grammar, one format line, lenient parse.
    ap.add_argument("--no-schema", action="store_true")
    a = ap.parse_args()
    sampler, key = roster_sampler(a.alias)
    prompts = {}
    for r in corpus():
        if r["model"] == a.alias: prompts[r["prompt_id"]] = r["prompt"]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    done = set()
    if os.path.exists(OUT):
        for line in open(OUT):
            e = json.loads(line); done.add((e["model"], e["prompt_id"], e["k"]))
    for pid, task in sorted(prompts.items()):
        for k in range(a.n):
            if (a.alias, pid, k) in done: continue
            user = GEN_USER.format(task=task.strip())
            if a.no_schema: user += "\n\n" + NO_SCHEMA_FORMAT
            body = {"messages": [{"role": "system", "content": GEN_SYSTEM}, {"role": "user", "content": user}],
                    "max_tokens": a.max_tokens, **sampler}
            if not a.no_schema:
                body["response_format"] = {"type": "json_schema", "json_schema": {"name": "checks", "schema": GEN_SCHEMA}}
            req = urllib.request.Request(a.url + "/v1/chat/completions", json.dumps(body).encode(),
                                         {"content-type": "application/json", "authorization": f"Bearer {key}"})
            t0 = time.time()
            resp = json.load(urllib.request.urlopen(req, timeout=1800))
            ch = resp["choices"][0]
            content = ch["message"].get("content") or ""
            try:
                if a.no_schema:
                    content = repair(content)
                checks, err = json.loads(content)["checks"], None
                if a.no_schema:  # keep only well-formed items, as the schema would have forced
                    checks = [c for c in checks if isinstance(c, dict) and c.get("scope") in ("always", "end") and isinstance(c.get("statement"), str)][:10]
                    for c in checks: c["command"] = c.get("command") if isinstance(c.get("command"), str) else None
            except Exception as e:
                checks, err = [], f"{type(e).__name__}: {e}"
            rec = {"model": a.alias, "prompt_id": pid, "k": k, "checks": checks, "parse_error": err,
                   "finish": ch.get("finish_reason"), "usage": resp.get("usage"), "wall_s": round(time.time() - t0, 1),
                   "thought_chars": len(ch["message"].get("reasoning_content") or ""), "raw": content if err else None,
                   "sampler": sampler, "schema": not a.no_schema}
            with open(OUT, "a") as f: f.write(json.dumps(rec) + "\n")
            print(a.alias, pid, k, f"{len(checks)} checks", rec["finish"], rec["wall_s"], "s", err or "", flush=True)


if __name__ == "__main__":
    main()
