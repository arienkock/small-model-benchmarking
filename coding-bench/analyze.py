#!/usr/bin/env python3
"""Analyze bench transcripts: tool errors, retries, compaction, per-model patterns."""
import json, sys, glob, os, re
from collections import Counter, defaultdict

def load(fp):
    events = []
    with open(fp, encoding='utf-8', errors='replace') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                events.append(json.loads(line))
            except Exception:
                pass
    return events

def analyze(fp):
    evs = load(fp)
    r = {
        'file': fp, 'events': len(evs),
        'models_seen': Counter(), 'stop_errors': Counter(),
        'tool_calls': Counter(), 'tool_errors': [], 'tool_error_count': 0,
        'auto_retries': 0, 'auto_retry_msgs': Counter(), 'compactions': 0,
        'agent_starts': 0, 'turns': 0,
        'abs_paths': 0, 'total_calls': 0,
        'usage_in': 0, 'usage_out': 0,
        'last_assistant': '', 'finished': False,
    }
    for e in evs:
        t = e.get('type')
        if t == 'agent_start':
            r['agent_starts'] += 1
        elif t == 'turn_start':
            r['turns'] += 1
        elif t == 'message_start':
            m = e.get('message', {})
            if m.get('role') == 'assistant':
                r['models_seen'][m.get('model', '?')] += 1
                if m.get('stopReason') == 'error' or m.get('errorMessage'):
                    r['stop_errors'][m.get('errorMessage', 'unknown')[:120]] += 1
        elif t == 'message_end':
            m = e.get('message', {})
            if m.get('role') == 'assistant':
                u = m.get('usage') or {}
                r['usage_in'] += u.get('input') or 0
                r['usage_out'] += u.get('output') or 0
                if m.get('stopReason') == 'stop':
                    r['finished'] = True
                txts = [c.get('text','') for c in (m.get('content') or []) if c.get('type')=='text']
                if txts:
                    r['last_assistant'] = txts[-1][-3000:]
        elif t == 'tool_execution_start':
            r['tool_calls'][e.get('toolName','?')] += 1
            r['total_calls'] += 1
            args = e.get('args') or {}
            for v in args.values():
                if isinstance(v, str) and re.search(r'([A-Za-z]:[\\/]|/d/llama|/D/llama|[A-Za-z]:\\\\)', v):
                    r['abs_paths'] += 1
                    break
        elif t == 'tool_execution_end':
            if e.get('isError'):
                res = e.get('result') or {}
                txt = ''
                if isinstance(res, dict):
                    txt = ' '.join(c.get('text','') for c in res.get('content',[]) if isinstance(c, dict))
                r['tool_error_count'] += 1
                r['tool_errors'].append((e.get('toolName'), txt[:250]))
        elif t == 'auto_retry_start':
            r['auto_retries'] += 1
            r['auto_retry_msgs'][str(e.get('errorMessage','?'))[:100]] += 1
        elif t == 'compaction_start':
            r['compactions'] += 1
    return r

def main():
    base = sys.argv[1] if len(sys.argv) > 1 else '.'
    runs = sorted(glob.glob(os.path.join(base, '[0-9][0-9]-*')))
    agg = defaultdict(lambda: {'n':0,'calls':0,'errors':0,'retries':0,'compactions':0,
                               'abs_paths':0,'turns':0,'usage_out':0,'usage_in':0,
                               'err_kinds':Counter(), 'tool_errs':Counter(),
                               'stop_errs':Counter(), 'finished':0})
    for d in runs:
        fp = os.path.join(d, 'transcript.jsonl')
        if not os.path.exists(fp):
            print(f"\n### {os.path.basename(d)}: NO TRANSCRIPT")
            continue
        r = analyze(fp)
        label = os.path.basename(d)
        print(f"\n### {label}  events={r['events']} calls={r['total_calls']} turns={r['turns']}")
        print(f"    models_in_msgs={dict(r['models_seen'])}")
        print(f"    stop_errors={dict(r['stop_errors']) if r['stop_errors'] else '-'}")
        print(f"    tool_errors={r['tool_error_count']}  auto_retries={r['auto_retries']} "
              f"compactions={r['compactions']} agent_starts={r['agent_starts']} "
              f"abs_path_calls={r['abs_paths']} tok_in={r['usage_in']} tok_out={r['usage_out']} finished={r['finished']}")
        for name, msg in r['tool_errors']:
            print(f"    TOOL-ERR {name}: {msg[:200]}")
        key = '-'.join(label.split('-')[1:])
        a = agg[key]; a['n'] += 1
        a['calls'] += r['total_calls']; a['errors'] += r['tool_error_count']
        a['retries'] += r['auto_retries']; a['compactions'] += r['compactions']
        a['abs_paths'] += r['abs_paths']; a['turns'] += r['turns']
        a['usage_out'] += r['usage_out']; a['usage_in'] += r['usage_in']
        a['finished'] += 1 if r['finished'] else 0
        for name, msg in r['tool_errors']:
            kind = re.sub(r'\d+', 'N', msg)[:80]
            a['tool_errs'][f"{name}: {kind}"] += 1
        for k in r['stop_errors']:
            a['stop_errs'][k] += r['stop_errors'][k]
    print("\n\n================ AGGREGATE (per model, both runs) ================")
    for key, a in sorted(agg.items()):
        print(f"\n{key}: runs={a['n']} finished_clean={a['finished']} calls={a['calls']} "
              f"tool_errors={a['errors']} retries={a['retries']} compactions={a['compactions']} "
              f"abs_path_calls={a['abs_paths']} avg_out_tok={a['usage_out']//max(1,a['n'])}")
        for k, v in a['tool_errs'].most_common(15):
            print(f"   {v:3d}  {k}")
        for k, v in a['stop_errs'].most_common(5):
            print(f"   STOP {v:3d}  {k}")

if __name__ == '__main__':
    main()
