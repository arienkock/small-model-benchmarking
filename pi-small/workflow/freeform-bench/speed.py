# Two /completion requests with a ~1000-token prompt; prints prompt and generation t/s and paging.
import json, sys, time, urllib.request, subprocess
port = sys.argv[1] if len(sys.argv) > 1 else "8123"
task = open("workflow/tasks/books-api/prompt.md", encoding="utf-8").read()
for i in range(2):
    prompt = f"Request {i} {time.time()}.\n" + task * 2 + "\nSummarize the task in three sentences."
    body = json.dumps({"prompt": prompt, "n_predict": 64, "cache_prompt": False}).encode()
    req = urllib.request.Request(f"http://127.0.0.1:{port}/completion", data=body, headers={"Content-Type": "application/json", "Authorization": "Bearer sk-bench"})
    t0 = time.time()
    t = json.load(urllib.request.urlopen(req, timeout=1800))["timings"]
    print(f"run {i}: prompt {t['prompt_n']} tok @ {t['prompt_per_second']:.1f} t/s, gen {t['predicted_n']} tok @ {t['predicted_per_second']:.1f} t/s, wall {time.time()-t0:.0f}s", flush=True)
