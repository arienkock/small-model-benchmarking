#!/usr/bin/env python3
"""Per-task: stop reasons, final assistant text, files created."""
import json, sys, glob, os, re
from collections import Counter

def load(fp):
    evs = []
    with open(fp, encoding='utf-8', errors='replace') as f:
        for line in f:
            line = line.strip()
            if not line: continue
            try: evs.append(json.loads(line))
            except Exception: pass
    return evs

for d in sorted(glob.glob(os.path.join(sys.argv[1], '[0-9][0-9]-*'))):
    fp = os.path.join(d, 'transcript.jsonl')
    if not os.path.exists(fp): continue
    evs = load(fp)
    stops = Counter(); final_text = ''; n_tool_calls_last = 0
    for e in evs:
        if e.get('type') == 'message_end':
            m = e.get('message', {})
            if m.get('role') == 'assistant':
                stops[m.get('stopReason')] += 1
                txts = [c.get('text','') for c in (m.get('content') or []) if c.get('type')=='text']
                if txts: final_text = txts[-1]
    files = []
    mf = os.path.join(d, 'meta.txt')
    if os.path.exists(mf):
        grab = False
        for ln in open(mf, encoding='utf-8', errors='replace'):
            if ln.startswith('files_created:'): grab = True; continue
            if grab:
                if ln.startswith('  '): files.append(ln.strip())
                else: break
    print(f"\n### {os.path.basename(d)}  stops={dict(stops)}")
    print(f"    files: {files if files else 'NONE'}")
    tail = re.sub(r'\s+', ' ', final_text)[-400:]
    print(f"    final_msg: {tail if tail else '(no final text)'}")
