# Generation speed on two realistic outputs: (A) rewriting a file that is in the
# prompt with a small change (repetitive), (B) a new test script (novel).
# Uses the chat endpoint so the template and sampler match a real session.
import json, sys, time, urllib.request
port = sys.argv[1]
app = open("workflow-runs/style2-2/ws/app.py", encoding="utf-8").read()
cases = {
    "A-rewrite": f"Here is app.py:\n\n```python\n{app}\n```\n\nOutput the complete file again with one change: rename the handler class to BooksHandler. Output only the code.",
    "B-novel": "Write a Python unittest file that tests a books REST API on http://127.0.0.1:8000 (POST/GET/PUT/DELETE /books, filters title/author/isbn/synopsis/q/id, 400/404 errors). Output only the code.",
}
for rep in range(2):
    for name, prompt in cases.items():
        body = json.dumps({"messages": [{"role": "user", "content": prompt}], "max_tokens": 700,
                           "chat_template_kwargs": {"enable_thinking": False}}).encode()
        req = urllib.request.Request(f"http://127.0.0.1:{port}/v1/chat/completions", data=body,
                                     headers={"Content-Type": "application/json", "Authorization": "Bearer sk-bench"})
        t0 = time.time()
        r = json.load(urllib.request.urlopen(req, timeout=1800))
        t = r.get("timings", {})
        acc = f", draft {t.get('draft_n_accepted')}/{t.get('draft_n')}" if t.get("draft_n") else ""
        print(f"  {name} #{rep}: gen {t.get('predicted_n')} @ {t.get('predicted_per_second', 0):.2f} t/s{acc}, wall {time.time()-t0:.0f}s", flush=True)
