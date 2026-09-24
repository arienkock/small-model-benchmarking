"""Judge clients. Every judge answers the same thing: P(statement is true | state).

readout  — a stock instruct GGUF on llama-server; read P(Yes) vs P(No) at the first answer
           position (SemIf's direct-logit method). Asked twice, "Yes or No" / "No or Yes", and
           averaged; the disagreement is kept as the order-flip signal.
systemone — Kev (kev.serve) and Laya (judges/laya/serve.mjs), both behind /v1/systemone.

The state comes first and the statement last, so a server's prompt cache reuses the state
across every statement asked about it.
"""
import http.client, json, math, time, urllib.error, urllib.request

SYSTEM = "You judge whether a statement about a coding session is true."
ORDERS = ("Answer with one word: Yes or No.", "Answer with one word: No or Yes.")


def _post(url, body, key=None, timeout=3600, retries=40):
    """Retries while a judge server restarts (Laya recycles itself to bound its memory)."""
    h = {"content-type": "application/json"}
    if key: h["authorization"] = f"Bearer {key}"
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, json.dumps(body).encode(), h)
            return json.load(urllib.request.urlopen(req, timeout=timeout))
        except (urllib.error.URLError, ConnectionError, http.client.HTTPException) as e:
            if isinstance(e, urllib.error.HTTPError) or attempt == retries - 1: raise
            time.sleep(15)


def _yes_no(top):
    y = n = 0.0
    for t in top:
        w = t["token"].strip().lower().strip(".,:!\"'*")
        p = math.exp(t["logprob"])
        if w == "yes": y += p
        elif w == "no": n += p
    return y, n


def readout_one(base, state, statement, order, key="sk-bench"):
    body = {"messages": [{"role": "system", "content": SYSTEM},
                         {"role": "user", "content": f"{state}\n\nStatement: {statement}\n\n{ORDERS[order]}"}],
            "max_tokens": 1, "temperature": 0, "logprobs": True, "top_logprobs": 20, "cache_prompt": True,
            "chat_template_kwargs": {"enable_thinking": False}}
    t0 = time.time()
    r = _post(base + "/v1/chat/completions", body, key)
    wall = time.time() - t0
    top = r["choices"][0]["logprobs"]["content"][0]["top_logprobs"]
    y, n = _yes_no(top)
    tm = r.get("timings", {})
    return {"p": y / (y + n) if y + n > 0 else None, "mass": y + n, "top": top[0]["token"],
            "wall": wall, "prompt_n": tm.get("prompt_n"), "prompt_ms": tm.get("prompt_ms"),
            "cached": (r.get("usage", {}).get("prompt_tokens_details") or {}).get("cached_tokens")}


def readout(base, state, statement, key="sk-bench"):
    a, b = readout_one(base, state, statement, 0, key), readout_one(base, state, statement, 1, key)
    ps = [x["p"] for x in (a, b) if x["p"] is not None]
    return {"p": sum(ps) / len(ps) if ps else None, "p_yn": a["p"], "p_ny": b["p"],
            "mass": min(a["mass"], b["mass"]), "wall": a["wall"] + b["wall"],
            "prompt_n": (a["prompt_n"] or 0) + (b["prompt_n"] or 0)}


def systemone(base, state, statements, key=None):
    """statements: {qid: text}. One request; the server batches every question over one state."""
    qs = {qid: {"type": "noul", "instructions": s} for qid, s in statements.items()}
    t0 = time.time()
    r = _post(base + "/v1/systemone", {"state": state, "questions": qs}, key)
    wall = time.time() - t0
    out = {}
    for qid, ans in r["answers"].items():
        p = ans.get("noul", ans.get("probability", ans.get("p")))
        if p is None and "probabilities" in ans:
            p = ans["probabilities"].get("true", ans["probabilities"].get("yes"))
        out[qid] = p
    return {"p": out, "wall": wall, "tokens": (r.get("usage") or {}).get("input_tokens"), "raw_latency_ms": r.get("latency_ms", r.get("elapsed_ms"))}
