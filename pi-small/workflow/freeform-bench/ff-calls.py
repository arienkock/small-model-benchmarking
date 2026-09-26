"""Each tool call of a free-form run: time, output tokens, thinking chars, call size, start of the command."""
import json, glob, sys
for rd in sys.argv[1:]:
    print("==", rd)
    f = glob.glob(rd + "/home/.pi/agent/sessions/*/*.jsonl")[0]
    for l in open(f):
        e = json.loads(l)
        if e.get("type") == "compaction":
            print("  " + e["timestamp"][11:19] + " COMPACTION"); continue
        if e.get("type") != "message" or e["message"]["role"] != "assistant":
            continue
        m = e["message"]
        th = sum(len(c.get("thinking", "")) for c in m["content"] if c["type"] == "thinking")
        calls = [c for c in m["content"] if c["type"] == "toolCall"]
        for c in calls or [None]:
            a = c["arguments"] if c else {}
            cmd = a.get("command") or json.dumps(a)
            ts, out = e["timestamp"][11:19], m["usage"]["output"]
            name = c["name"] if c else "(text)"
            print(f"  {ts} out={out:5d} think={th:5d}ch {name:5s} {len(cmd) if c else 0:5d}ch  {cmd[:80]!r}")
