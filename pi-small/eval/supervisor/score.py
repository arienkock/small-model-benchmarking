"""Score step 1 verdicts against grader labels (finals) and mechanical/hand labels (invariants).

  python3 score.py            -> prints tables, writes out/scores.json

Violation probability v = p if the statement is phrased as a violation, else 1 - p.
A capsule would fire when v > 0.5.
Run-level (finals): the session's score is the max v over the questions asked of it, since one
failing check is enough to fire. Generic questions are one session per run; generated checks
are one session per (run, checklist k) — each checklist is what one live session would have had.
"""
import glob, json, os, re
from corpus import corpus
import invariants
from probes import checklists

HERE = os.path.dirname(os.path.abspath(__file__))
TH = 0.5
MAX_K = 3   # generated checklists k=0..2 per (model, task) for every judge: Nanbeige has 3, and the GPU budget fits 3


def auroc(pos, neg):
    if not pos or not neg: return None
    wins = sum((p > n) + 0.5 * (p == n) for p in pos for n in neg)
    return wins / (len(pos) * len(neg))


def v_of(e):
    if e["p"] is None: return None
    return e["p"] if e["bad_when_true"] else 1 - e["p"]


def rates(scores, labels):
    """scores/labels aligned; label True = the run FAILED (a capsule is warranted)."""
    pos = [s for s, l in zip(scores, labels) if l]; neg = [s for s, l in zip(scores, labels) if not l]
    return {"auroc": auroc(pos, neg), "tpr": sum(s > TH for s in pos) / len(pos) if pos else None,
            "fpr": sum(s > TH for s in neg) / len(neg) if neg else None, "n_fail": len(pos), "n_pass": len(neg)}


def load(judge):
    out = []
    for l in open(os.path.join(HERE, "out", f"verdicts-{judge}.jsonl")):
        e = json.loads(l)
        if e["qid"].startswith("gen:") and int(e["qid"].split(":")[1]) >= MAX_K: continue
        out.append(e)
    return out


def finals(judge, rs):
    vs = [e for e in load(judge) if e["part"] == "finals"]
    out = {}
    for cond in ("T", "TE"):
        cv = [e for e in vs if e["cond"] == cond and v_of(e) is not None]
        if not cv: continue
        res = {}
        # generic, run level
        g = {}
        for e in cv:
            if e["qid"].startswith("G"): g.setdefault(e["run"], []).append(v_of(e))
        ids = [r for r in g if r in rs]
        res["generic"] = rates([max(g[r]) for r in ids], [rs[r]["label"] == "FAIL" for r in ids])
        # per generic question
        per_q = {}
        for q in sorted({e["qid"] for e in cv if e["qid"].startswith("G")}, key=lambda s: int(s[1:])):
            qv = {e["run"]: v_of(e) for e in cv if e["qid"] == q}
            per_q[q] = rates([qv[r] for r in qv], [rs[r]["label"] == "FAIL" for r in qv])
        # G6 against its own label: something the grader found MISSING
        qv = {e["run"]: v_of(e) for e in cv if e["qid"] == "G6"}
        if qv:
            per_q["G6|missing"] = rates([qv[r] for r in qv], [any(v == "MISSING" for v in rs[r]["components"].values()) for r in qv])
        res["per_question"] = per_q
        # generated, (run, k) sessions
        s = {}
        for e in cv:
            if e["qid"].startswith("gen:"):
                k = e["qid"].split(":")[1]; s.setdefault((e["run"], k), []).append(v_of(e))
        keys = [x for x in s if x[0] in rs]
        if keys:
            res["generated"] = rates([max(s[x]) for x in keys], [rs[x[0]]["label"] == "FAIL" for x in keys])
            both = [max(s[x] + g.get(x[0], [])) for x in keys]
            res["both"] = rates(both, [rs[x[0]]["label"] == "FAIL" for x in keys])
        # order flips (readout only)
        fl = [e for e in cv if e.get("p_yn") is not None and e.get("p_ny") is not None]
        if fl: res["order_flip_rate"] = sum((e["p_yn"] > 0.5) != (e["p_ny"] > 0.5) for e in fl) / len(fl)
        res["n_verdicts"] = len(cv)
        out[cond] = res
    return out


def baselines(rs):
    """No judge: B1 a generated check fails if its command exits non-zero (per checklist session);
    B2 the run fails if the re-run of its last code-executing command exits non-zero."""
    pr = [json.loads(l) for l in open(os.path.join(HERE, "out", "probes.jsonl"))]
    b2, b1, b1_nt = {}, {}, {}
    for e in pr:
        for key in e["keys"]:
            if key == "generic:last_exec":
                b2[e["run"]] = e["rc"] not in ("0", None)
            else:
                k = key.split(":")[1]
                if int(k) >= MAX_K: continue
                bad = e["rc"] not in ("0", None)
                b1[(e["run"], k)] = b1.get((e["run"], k), False) or bad
                b1_nt[(e["run"], k)] = b1_nt.get((e["run"], k), False) or (bad and e["rc"] != "137")
    # sessions whose checklist had no command at all never fire
    for (m, pid), cls in checklists().items():
        for r in rs.values():
            if r["model"] == m and r["prompt_id"] == pid:
                for cl in cls:
                    if cl["k"] >= MAX_K: continue
                    b1.setdefault((r["id"], str(cl["k"])), False); b1_nt.setdefault((r["id"], str(cl["k"])), False)
    runs_b2 = [r for r in rs if r in b2] + [r for r in rs if r not in b2]
    return {
        "B1 generated commands exit!=0": rates([float(v) for v in b1.values()], [rs[x[0]]["label"] == "FAIL" for x in b1]),
        "B1' same, timeouts not counted": rates([float(v) for v in b1_nt.values()], [rs[x[0]]["label"] == "FAIL" for x in b1_nt]),
        "B2 last code run exit!=0": rates([float(b2.get(r, False)) for r in runs_b2], [rs[r]["label"] == "FAIL" for r in runs_b2]),
    }


def invariant_scores(judge):
    vs = [e for e in load(judge) if e["part"] == "invariants" and v_of(e) is not None]
    if not vs: return None
    bs = {(b["run"], b["upto"]): b for b in invariants.boundaries()}
    hand = {(h["run"], h["upto"]): h for h in json.load(open(os.path.join(HERE, "labels", "invariants-hand.json")))}
    res = {}
    for q in ("G1", "G2", "G3", "G4", "G5"):
        qv = [(e, bs.get((e["run"], e["upto"]))) for e in vs if e["qid"] == q]
        if q in ("G1", "G3"):
            pairs = [(v_of(e), hand[(e["run"], e["upto"])][q]) for e, b in qv if (e["run"], e["upto"]) in hand and hand[(e["run"], e["upto"])][q] is not None]
        else:
            pairs = [(v_of(e), b["labels"][q]) for e, b in qv if b]
        sampled = [v_of(e) for e, b in qv if b and b["sampled"]]
        res[q] = {**rates([p for p, _ in pairs], [l for _, l in pairs]),
                  "fire_rate_all_sampled_boundaries": sum(s > TH for s in sampled) / len(sampled) if sampled else None}
    # generated always-checks: how often would they fire, early vs late in a session
    gen = [e for e in vs if e["qid"].startswith("gen:")]
    if gen:
        early = [v_of(e) for e in gen if e["upto"] <= 2]; late = [v_of(e) for e in gen if e["upto"] > 2]
        res["generated_always"] = {"n": len(gen), "fire_rate_turns_1_2": sum(x > TH for x in early) / max(1, len(early)),
                                   "fire_rate_later": sum(x > TH for x in late) / max(1, len(late))}
        # capsules per session (sampled runs). A live session has the generic bank plus ONE
        # checklist, so a session is (run, k). Hysteresis: a criterion fires on its 2nd violation in
        # a row. Reported raw, and with the plan's maxFires = 2 per criterion.
        seqs = {}
        for e in sorted(vs, key=lambda e: e["upto"]):
            if not bs.get((e["run"], e["upto"]), {}).get("sampled"): continue
            seqs.setdefault(e["run"], {}).setdefault(e["qid"], []).append(v_of(e) > TH)
        raw, capped = [], []
        for run, qs in seqs.items():
            ks = sorted({q.split(":")[1] for q in qs if q.startswith("gen:")}) or [None]
            for k in ks:
                n = c = 0
                for q, seq in qs.items():
                    if q.startswith("gen:") and q.split(":")[1] != k: continue
                    f = sum(1 for a, b in zip(seq, seq[1:]) if a and b)
                    n += f; c += min(f, 2)
                raw.append(n); capped.append(c)
        res["capsules_per_session"] = {"sessions": len(raw), "mean_raw": sum(raw) / len(raw), "max_raw": max(raw),
                                       "mean_maxfires2": sum(capped) / len(capped), "max_maxfires2": max(capped),
                                       "share_sessions_with_any": sum(1 for x in raw if x) / len(raw)}
    return res


def main():
    rs = {r["id"]: r for r in corpus()}
    report = {"baselines": baselines(rs) if os.path.exists(os.path.join(HERE, "out", "probes.jsonl")) else None, "judges": {}}
    for p in sorted(glob.glob(os.path.join(HERE, "out", "verdicts-*.jsonl"))):
        j = os.path.basename(p)[9:-6]
        report["judges"][j] = {"finals": finals(j, rs), "invariants": invariant_scores(j)}
    json.dump(report, open(os.path.join(HERE, "out", "scores.json"), "w"), indent=1)
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
