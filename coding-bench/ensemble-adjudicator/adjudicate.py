#!/usr/bin/env python3
"""
Adjudicate model-proposed defect claims by EXECUTION, not opinion.

For each claimed defect the model supplies a discriminating test. We run it against:
  buggy      the original module
  correct    the reference fix (oracle)
  only-bug1  args not spread
  only-bug2  early return, never cancels
  only-bug3  timer nulled synchronously

Verdict per test:
  DISCRIMINATING   fails on buggy, passes on correct  -> the claimed defect is real
  NON-DISCRIM      passes on buggy and on correct     -> proves nothing (hallucination/weak)
  INVERTED         passes on buggy, fails on correct  -> asserts the BUGGY behaviour
  BROKEN/OVERSPEC  fails on both                      -> bad test, or demands more than the spec

Coverage of a DISCRIMINATING test = the set of single-bug mutants it fails on.
The union of those sets over all tests is what decides whether ensemble+execution
recovers all three defects. No judgement anywhere in this file.
"""
import re, subprocess, sys, os, shutil, json

VARIANTS = ["buggy", "correct", "only-bug1", "only-bug2", "only-bug3"]
TIMEOUT = 40

def parse_defects(path):
    if not os.path.exists(path): return []
    txt = open(path, encoding="utf-8", errors="replace").read()
    out = []
    # split on the DEFECT header (tolerate ###/##/#, extra text on the line)
    chunks = re.split(r'(?mi)^\s{0,3}#{1,4}\s*DEFECT.*$', txt)
    for ch in chunks[1:]:
        why = re.search(r'(?mi)^\s*WHY:\s*(.+)$', ch)
        fix = re.search(r'(?mi)^\s*FIX:\s*(.+)$', ch)
        code = re.search(r'```(?:ts|typescript)?\s*\n(.*?)```', ch, re.S)
        if code:
            out.append({
                "why": (why.group(1).strip() if why else "(none)")[:150],
                "fix": (fix.group(1).strip() if fix else "(none)")[:150],
                "code": code.group(1),
            })
    return out

def run_test(code, variant, tag):
    shutil.copyfile(variant + ".ts", "target.ts")
    fn = f"_t_{tag}.ts"
    open(fn, "w", encoding="utf-8").write(code)
    try:
        p = subprocess.run(["node", fn], capture_output=True, text=True, timeout=TIMEOUT)
        ok = (p.returncode == 0 and "TEST PASSED" in (p.stdout or ""))
        err = ((p.stderr or "").strip().splitlines() or [""])[0][:100]
        return ok, ("" if ok else err)
    except subprocess.TimeoutExpired:
        return False, "TIMEOUT(hung)"
    finally:
        if os.path.exists(fn): os.remove(fn)

def classify(res):
    b, c = res["buggy"][0], res["correct"][0]
    if not b and c:  return "DISCRIMINATING"
    if b and c:      return "NON-DISCRIM"
    if b and not c:  return "INVERTED"
    return "BROKEN/OVERSPEC"

def main():
    models = sys.argv[1:] or ["granite", "spark", "vibethinker"]
    union = set(); rows = []
    for m in models:
        defects = parse_defects(f"defects-{m}.md")
        print(f"\n{'='*78}\n{m.upper()}: {len(defects)} defect block(s) parsed\n{'='*78}")
        for i, d in enumerate(defects, 1):
            res = {v: run_test(d["code"], v, f"{m}{i}") for v in VARIANTS}
            verdict = classify(res)
            cov = sorted(b for b in ("only-bug1","only-bug2","only-bug3") if not res[b][0])
            covs = ",".join(x.replace("only-","") for x in cov) or "-"
            if verdict == "DISCRIMINATING": union |= set(cov)
            print(f"\n  [{m} #{i}] {verdict}   catches: {covs}")
            print(f"     WHY: {d['why']}")
            print(f"     FIX: {d['fix']}")
            print("     runs: " + "  ".join(
                f"{v}={'PASS' if res[v][0] else 'fail'}" for v in VARIANTS))
            if not res["correct"][0] and res["correct"][1]:
                print(f"     (on correct: {res['correct'][1]})")
            rows.append({"model": m, "n": i, "verdict": verdict, "catches": cov})
    print(f"\n{'='*78}\nUNION COVERAGE from DISCRIMINATING tests: "
          f"{', '.join(sorted(x.replace('only-','') for x in union)) or 'NONE'}")
    print(f"All three defects recovered? {'YES' if len(union)==3 else 'NO -- missing: ' + ', '.join(sorted({'bug1','bug2','bug3'} - {x.replace('only-','') for x in union}))}")
    print("="*78)
    json.dump(rows, open("adjudication.json","w"), indent=1)

if __name__ == "__main__":
    main()
