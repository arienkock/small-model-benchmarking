"""Step 0: what a judge costs on the hardware a live supervisor would have (CPU; the GPU is busy
with the 3B agent). Three realistic calls, on real corpus states:

  cold   a state the judge has never seen (the first check of a session, or after a cache miss)
  warm   another statement about the same state (the rest of the checks at that boundary)
  incr   the state grown by one turn (the next turn boundary)

  python3 step0.py readout <url> <label>
  python3 step0.py systemone <url> <label>
Appends to out/step0.jsonl.
"""
import json, os, sys, uuid
import judges
from corpus import corpus, turns
from questions import GENERIC
from render import state

HERE = os.path.dirname(os.path.abspath(__file__))
FINALS = [g["q"] for g in GENERIC if g["scope"] == "end"]


def pick():
    rs = corpus()
    by_len = sorted(rs, key=lambda r: len(state(r)))
    small = min(by_len, key=lambda r: abs(len(state(r)) - 7000))   # ~2k tokens
    big = by_len[-1]                                                # the longest transcript
    ev = "\n".join(f"$ cat {f}\n" + open(os.path.join(big["dir"], f), errors="replace").read() for f in big["files"])
    return [("~2k", small, None), ("~6k", big, ev)]


def main():
    kind, url, label = sys.argv[1:4]
    out = open(os.path.join(HERE, "out", "step0.jsonl"), "a")
    only = os.environ.get("STEP0_SIZES")
    for size, run, ev in pick():
        if only and size not in only.split(","): continue
        n = len(turns(run["msgs"]))
        nonce = f"[session {uuid.uuid4().hex[:8]}]\n"
        s_prev = nonce + state(run, upto=n - 1, evidence=ev)
        s_full = nonce + state(run, evidence=ev)
        rec = {"judge": label, "kind": kind, "size": size, "run": run["id"], "chars": len(s_full)}
        if kind == "readout":
            c = judges.readout(url, s_prev, FINALS[0])                         # cold: nothing cached
            w = [judges.readout(url, s_prev, q) for q in FINALS[1:]]            # warm: same state
            i = judges.readout(url, s_full, FINALS[0])                         # incremental: +1 turn
            rec.update(cold_s=c["wall"], warm_s=sum(x["wall"] for x in w) / len(w), incr_s=i["wall"],
                       yield_check_s=c["wall"] + sum(x["wall"] for x in w), prompt_tokens=c["prompt_n"] // 2 if c["prompt_n"] else None)
        else:
            qs = {f"q{k}": q for k, q in enumerate(FINALS)}
            c = judges.systemone(url, s_prev, qs)
            w = judges.systemone(url, s_prev, qs)
            i = judges.systemone(url, s_full, qs)
            rec.update(cold_s=c["wall"], warm_s=w["wall"], incr_s=i["wall"], yield_check_s=c["wall"], prompt_tokens=c["tokens"])
        print(json.dumps(rec), flush=True)
        out.write(json.dumps(rec) + "\n"); out.flush()


if __name__ == "__main__":
    main()
