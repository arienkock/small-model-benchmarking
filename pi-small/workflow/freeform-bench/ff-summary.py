"""One line per free-form run dir: python .ff-summary.py <run-dir>... """
import json, os, sys
for rd in sys.argv[1:]:
    fp = os.path.join(rd, "freeform.json")
    if not os.path.exists(fp):
        print(f"{rd}: (running)"); continue
    f = json.load(open(fp))
    gp = os.path.join(rd, "grade.json")
    g = json.load(open(gp)) if os.path.exists(gp) else {}
    print(f"{rd}: end={f.get('end')} min={f.get('minutes')} turns={f.get('turns')} tools={f.get('toolCalls')} "
          f"compactions={f.get('compactions')} out={f.get('outputTokens')} grade={g.get('passed')}/{g.get('total')}")
