// Laya behind the same /v1/systemone shape Kev serves, so the replay client has one judge API.
//   node serve.mjs [port]      LAYA_THREADS=n limits ONNX Runtime's intra-op threads
import http from "node:http";
import { Laya } from "@receptron/laya";

const port = Number(process.argv[2] ?? 8011);
const threads = process.env.LAYA_THREADS ? Number(process.env.LAYA_THREADS) : undefined;
const laya = await Laya.load(threads ? { sessionOptions: { intraOpNumThreads: threads } } : {});
// The process grows by several GB over thousands of requests (seen: 7.7 GB), so it exits after
// LAYA_MAX_REQUESTS and a wrapper loop restarts it; the replay client retries meanwhile.
const maxRequests = Number(process.env.LAYA_MAX_REQUESTS ?? 0);
let served = 0;

http.createServer(async (req, res) => {
	if (req.method !== "POST") { res.writeHead(200).end(JSON.stringify({ ok: true })); return; }
	let body = "";
	for await (const chunk of req) body += chunk;
	try {
		const { state, questions } = JSON.parse(body);
		const t0 = performance.now();
		const out = await laya.systemOne(state, questions);
		res.writeHead(200, { "content-type": "application/json" })
			.end(JSON.stringify({ ...out, elapsed_ms: performance.now() - t0 }), () => {
				if (maxRequests && ++served >= maxRequests) process.exit(0);
			});
	} catch (e) {
		res.writeHead(500).end(JSON.stringify({ error: String(e?.stack ?? e) }));
	}
}).listen(port, "0.0.0.0", () => console.log(`laya on :${port}`));
