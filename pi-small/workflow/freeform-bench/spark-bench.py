# Cold prompts of ~1.2k and ~6k tokens, each followed by 256 generated tokens,
# two of each (the first warms up). Sized like pi sessions: a fresh step is
# 2-3k tokens, a late turn of a coding session 6-9k.
import json, sys, time, urllib.request
port = sys.argv[1]
task = open("workflow/tasks/books-api/prompt.md", encoding="utf-8").read()
for reps, label in ((2, "1.2k"), (10, "6k")):
    for i in range(2):
        prompt = f"Request {label}-{i} {time.time()}.\n" + task * reps + "\nWrite a Python function that validates a book dict against these rules."
        body = json.dumps({"prompt": prompt, "n_predict": 256, "cache_prompt": False, "ignore_eos": True}).encode()
        req = urllib.request.Request(f"http://127.0.0.1:{port}/completion", data=body, headers={"Content-Type": "application/json", "Authorization": "Bearer sk-bench"})
        t0 = time.time()
        t = json.load(urllib.request.urlopen(req, timeout=1800))["timings"]
        print(f"  {label} run {i}: pp {t['prompt_n']} @ {t['prompt_per_second']:.1f} t/s, tg {t['predicted_n']} @ {t['predicted_per_second']:.2f} t/s, wall {time.time()-t0:.0f}s", flush=True)
