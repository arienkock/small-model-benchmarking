# Cold ~1.2k-token prompt then 256 generated tokens, twice (the first warms up).
import json, sys, time, urllib.request
port = sys.argv[1]
task = open("workflow/tasks/books-api/prompt.md", encoding="utf-8").read()
for i in range(3):
    prompt = f"Request {i} {time.time()}.\n" + task * 2 + "\nWrite a Python function that validates a book dict against these rules."
    body = json.dumps({"prompt": prompt, "n_predict": 256, "cache_prompt": False, "ignore_eos": True}).encode()
    req = urllib.request.Request(f"http://127.0.0.1:{port}/completion", data=body, headers={"Content-Type": "application/json", "Authorization": "Bearer sk-bench"})
    t0 = time.time()
    t = json.load(urllib.request.urlopen(req, timeout=1800))["timings"]
    print(f"  run {i}: pp {t['prompt_n']} @ {t['prompt_per_second']:.1f} t/s, tg {t['predicted_n']} @ {t['predicted_per_second']:.2f} t/s, wall {time.time()-t0:.0f}s", flush=True)
