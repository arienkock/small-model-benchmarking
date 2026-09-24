"""Step 1: replay the corpus through a judge. Resumable; appends to out/verdicts-<judge>.jsonl.

  python3 replay.py <judge-label> <kind:readout|systemone> <url> [--part finals|invariants] [--laya]

finals      every run, at the end: generic end-questions + every generated check (both scopes;
            an "always" check must hold at the end too), in two state conditions:
              T   transcript only
              TE  transcript + generic evidence (+ the check's own command output, if it has one)
invariants  the boundaries from invariants.py: generic always-questions + generated always-checks,
            transcript only (intermediate workspaces were never saved).

--laya: Laya reads 512 tokens and truncates the END of the state, so it gets the evidence first,
then the task, then the latest turn — the most a 512-token window can hold of what matters.
"""
import argparse, json, os
import judges, invariants, probes
from corpus import corpus, turns
from questions import GENERIC
from render import cut, render_turn, state

HERE = os.path.dirname(os.path.abspath(__file__))


def probe_outputs():
    out = {}
    p = os.path.join(HERE, "out", "probes.jsonl")
    if os.path.exists(p):
        for line in open(p):
            e = json.loads(line)
            for k in e["keys"]: out[(e["run"], k)] = e
    return out


def fmt_probe(e):
    if e is None or e.get("out") is None: return None
    rc = e.get("rc")
    tail = "\n[killed after 10 s]" if rc == "137" else f"\n[exit {rc}]"
    return f"$ {cut(e['cmd'], 400)}\n{cut(e['out'].rstrip(), 1500)}{tail}"


def generic_evidence(run, probes_by_key):
    ev = probes.files_evidence(run)
    le = fmt_probe(probes_by_key.get((run["id"], "generic:last_exec")))
    if le: ev += "\n\n# the last command that ran code, re-run against the final files:\n" + le
    return ev


def laya_state(run, upto, ev):
    ts = turns(run["msgs"])[:upto]
    s = (f"EVIDENCE:\n{cut(ev, 900)}\n\n" if ev else "") + "TASK:\n" + cut(run["prompt"].strip(), 700)
    if ts: s += "\n\nLATEST TURN:\n" + cut(render_turn(len(ts) - 1, ts[-1]), 900)
    return s


def questions_for(run, cls, scope_filter):
    """[(qid, statement, bad_when_true, own_probe_key)]"""
    qs = [(g["id"], g["q"], g["bad"], None) for g in GENERIC if g["scope"] in scope_filter]
    for cl in cls.get((run["model"], run["prompt_id"]), []):
        for i, ch in enumerate(cl["checks"]):
            if ch["scope"] in scope_filter or ("end" in scope_filter and ch["scope"] == "always"):
                qs.append((f"gen:{cl['k']}:{i}", ch["statement"], False, f"gen:{cl['k']}:{i}" if ch.get("command") else None))
    return qs


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("judge"); ap.add_argument("kind"); ap.add_argument("url")
    ap.add_argument("--part", default="finals"); ap.add_argument("--laya", action="store_true")
    ap.add_argument("--conds", default="T,TE"); ap.add_argument("--generic-only", action="store_true")
    ap.add_argument("--shard", default="0/1", help="i/n: this worker takes every n-th run/boundary")
    ap.add_argument("--max-k", type=int, default=99, help="use generated checklists k < max-k only")
    # Kev on the 970M: a state much over ~4k tokens runs a kernel past the Windows GPU watchdog
    # (TDR, ~2 s) and kills the CUDA context, so long states go to a CPU instance instead.
    ap.add_argument("--long-url"); ap.add_argument("--long-chars", type=int, default=13000)
    ap.add_argument("--skip-long", action="store_true", help="skip states longer than --long-chars (reported as skipped)")
    ap.add_argument("--no-own-evidence", action="store_true",
                    help="TE: every question shares the generic evidence; skip per-check command output")
    a = ap.parse_args()
    out_path = os.path.join(HERE, "out", f"verdicts-{a.judge}.jsonl")
    done = set()
    if os.path.exists(out_path):
        for line in open(out_path):
            e = json.loads(line); done.add((e["part"], e["run"], e["upto"], e["cond"], e["qid"]))
    out = open(out_path, "a")
    cls = {} if a.generic_only else probes.checklists()
    cls = {key: [c for c in v if c["k"] < a.max_k] for key, v in cls.items()}
    si, sn = map(int, a.shard.split("/"))
    pk = probe_outputs()
    runs = {r["id"]: r for r in corpus()}

    def url_for(st):
        return a.long_url if a.long_url and len(st) > a.long_chars else a.url

    def ask(run, upto, cond, st, qs):
        todo = [q for q in qs if (a.part, run["id"], upto, cond, q[0]) not in done]
        if not todo: return
        if a.kind == "systemone":
            # shared-state questions in one request; questions with their own evidence one by one
            shared = {q[0]: q[1] for q in todo if a.no_own_evidence or not (cond == "TE" and q[3])}
            res = {}
            if shared:
                r = judges.systemone(url_for(st), st, shared); res.update({k: (v, r["wall"] / len(shared)) for k, v in r["p"].items()})
            for q in todo:
                if q[0] in res: continue
                own = fmt_probe(pk.get((run["id"], q[3])))
                s2 = (laya_state(run, upto, own) if a.laya else st + "\n\n# the check's own command:\n" + own) if own else st
                r = judges.systemone(url_for(s2), s2, {q[0]: q[1]}); res[q[0]] = (r["p"][q[0]], r["wall"])
            for q in todo:
                p, wall = res[q[0]]
                out.write(json.dumps({"part": a.part, "run": run["id"], "upto": upto, "cond": cond, "qid": q[0],
                                      "bad_when_true": q[2], "p": p, "wall": wall}) + "\n")
        else:
            for q in todo:
                s2 = st
                if cond == "TE" and q[3]:
                    own = fmt_probe(pk.get((run["id"], q[3])))
                    if own: s2 = st + "\n\n# the check's own command:\n" + own
                r = judges.readout(a.url, s2, q[1])
                out.write(json.dumps({"part": a.part, "run": run["id"], "upto": upto, "cond": cond, "qid": q[0],
                                      "bad_when_true": q[2], **r}) + "\n")
        out.flush()

    if a.part == "finals":
        for idx, run in enumerate(runs.values()):
            if idx % sn != si: continue
            n = len(turns(run["msgs"]))
            qs = questions_for(run, cls, {"end"})
            for cond in a.conds.split(","):
                ev = generic_evidence(run, pk) if cond == "TE" else None
                st = laya_state(run, n, ev) if a.laya else state(run, evidence=ev)
                ask(run, n, cond, st, qs)
            print("finals", run["id"], flush=True)
    else:
        order = list(dict.fromkeys(b["run"] for b in invariants.boundaries()))
        for b in invariants.boundaries():
            if order.index(b["run"]) % sn != si: continue   # a run stays on one worker: its states grow turn by turn
            run = runs[b["run"]]
            qs = questions_for(run, cls, {"always"})
            st = laya_state(run, b["upto"], None) if a.laya else state(run, upto=b["upto"])
            if a.skip_long and len(st) > a.long_chars:
                print("skipped long", run["id"], b["upto"], len(st), flush=True); continue
            ask(run, b["upto"], "T", st, qs)
        print("invariants done", flush=True)


if __name__ == "__main__":
    main()
