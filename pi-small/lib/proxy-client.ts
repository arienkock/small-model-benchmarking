/**
 * proxy-client.ts — the container side of ../proxy.mjs.
 *
 * In remote mode the plugin cannot manage llama-server itself. When the host
 * runs proxy.mjs instead of a bare serve.mjs, these two calls let it ask for a
 * different model anyway; without a proxy, `proxyStatus` returns null and the
 * plugin keeps its old behaviour (follow whatever the host serves).
 */

export interface ProxyEndpoint {
	host: string;
	port: number;
	apiKey: string;
}

export interface ProxyStatus {
	alias: string | null;
	thinking: string | null;
	ctx: number | null;
	state: "ready" | "switching" | "down";
	error: string | null;
}

const url = (e: ProxyEndpoint, path: string) => `http://${e.host}:${e.port}${path}`;
const headers = (e: ProxyEndpoint) => ({ Authorization: `Bearer ${e.apiKey}`, "Content-Type": "application/json" });

/** The proxy's status, or null when the host runs no proxy (a plain llama-server answers 404). */
export async function proxyStatus(e: ProxyEndpoint): Promise<ProxyStatus | null> {
	try {
		const r = await fetch(url(e, "/pi-small/status"), { headers: headers(e), signal: AbortSignal.timeout(5000) });
		if (!r.ok) return null;
		const body = await r.json();
		return typeof body?.state === "string" ? body : null;
	} catch {
		return null;
	}
}

/** Ask the proxy for `alias` (in `thinking` mode, when given). Waits for the load; throws with the proxy's reason. */
export async function proxySwitch(e: ProxyEndpoint, alias: string, thinking?: string | null, timeoutMs = 20 * 60_000): Promise<ProxyStatus> {
	const r = await fetch(url(e, "/pi-small/model"), {
		method: "POST",
		headers: headers(e),
		body: JSON.stringify({ alias, ...(thinking ? { thinking } : {}) }),
		signal: AbortSignal.timeout(timeoutMs),
	});
	const body = await r.json().catch(() => ({}));
	if (!r.ok || body?.alias !== alias || body?.state !== "ready") {
		throw new Error(`the host proxy could not switch to ${alias}: ${body?.error ?? `HTTP ${r.status}`}`);
	}
	return body;
}
