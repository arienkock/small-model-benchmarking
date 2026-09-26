"""Where a free-form run's time went. Usage: python ff-timeline.py <run-dir>"""
import json, glob, sys, datetime as dt
run = sys.argv[1]
def ts(s): return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
log = [json.loads(l) for f in glob.glob(f"{run}/home/.pi-small/session-*.jsonl") for l in open(f) if l.strip()]
resp = [r for r in log if r.get("type") == "response"]
comp = [r for r in log if r.get("type") == "compaction"]
sess = [json.loads(l) for f in glob.glob(f"{run}/home/.pi/agent/sessions/*/*.jsonl") for l in open(f) if l.strip()]
msgs = [e for e in sess if e.get("type") == "message"]
start = ts(msgs[0]["timestamp"]) if msgs else 0
end = ts(sess[-1]["timestamp"]) if sess else 0
gen_s = sum(r["wallMs"] for r in resp) / 1000
out = sum(r["usage"]["output"] for r in resp)
inp = sum(r["usage"]["input"] for r in resp)
cached = sum(r["usage"].get("cacheRead", 0) for r in resp)
think = sum(r.get("thoughtChars", 0) for r in resp)
# tool time: from a toolCall-bearing assistant message to its toolResult
tool_s = 0.0; pending = {}
for e in msgs:
    m = e["message"]
    if m["role"] == "assistant":
        for c in m.get("content", []):
            if c.get("type") == "toolCall": pending[c["id"]] = ts(e["timestamp"])
    elif m["role"] == "toolResult" and m.get("toolCallId") in pending:
        tool_s += ts(e["timestamp"]) - pending.pop(m["toolCallId"])
comp_s = sum(c.get("seconds", 0) for c in comp)
compactions = [e for e in sess if e.get("type") == "compaction"]
total = end - start
print(f"session {total/60:.1f} min; {len(resp)} responses, {out} tokens out ({out/max(gen_s,1):.1f} t/s incl. prompt), {inp} uncached in, {cached} cached")
print(f"  model responses {gen_s/60:.1f} min ({100*gen_s/max(total,1):.0f}%), tools {tool_s/60:.1f} min, compactions {len(compactions)} ({comp_s/60:.1f} min logged by pi-small)")
print(f"  thinking {think} chars of output; stop reasons: " + ", ".join(f"{k}={sum(1 for r in resp if r['stopReason']==k)}" for k in sorted({r['stopReason'] for r in resp})))
for c in comp: print(f"  compaction: {c.get('mode')} ok={c.get('ok')} {c.get('seconds')}s words={c.get('words')} failure={c.get('failure')}")
