/**
 * Pi extension for the local coding benchmark.
 *
 * Registers a custom provider "bench-local" backed by llama-server
 * (OpenAI-compatible endpoint). Both benchmark models are declared with
 * IDENTICAL parameters so runs are comparable:
 *
 *   - reasoning: true          -> pi parses reasoning_content into thinking
 *                                 blocks; the models think via their chat
 *                                 templates by default (server-side
 *                                 `--reasoning-budget` caps them equally).
 *   - contextWindow: BENCH_CTX -> must match the llama-server -c value
 *   - maxTokens: 8192          -> per-response cap, identical for both
 *
 * No per-request thinking controls are sent (no --thinking), so the server's
 * --reasoning-budget is the single source of truth for the reasoning budget.
 */

export default function (pi: ExtensionAPI) {
	// baseUrl does NOT support $ENV interpolation; resolve it here instead.
	// Normalize: accept the server root with or without a trailing /v1, always
	// produce <root>/v1 (pi-ai uses it directly as the OpenAI SDK baseURL).
	const baseUrl = (process.env.LLAMA_BASE_URL ?? "http://127.0.0.1:8123").replace(/\/$/, "").replace(/\/v1$/, "") + "/v1";
	// Keep in sync with llama-server -c (run script exports BENCH_CTX so the
	// compaction threshold matches the real context window even if the
	// fallback ladder lowered it).
	const ctxWindow = Number(process.env.BENCH_CTX ?? "16384");

	pi.registerProvider("bench-local", {
		name: "Bench Local (llama-server)",
		baseUrl,
		apiKey: "sk-bench",
		authHeader: true,
		api: "openai-completions",
		models: [
			{
				id: "LFM2.5-2.6B-Q8_0",
				name: "LFM2.5 2.6B Q8_0 (local)",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: ctxWindow,
				maxTokens: Math.min(8192, ctxWindow),
				compat: {
					supportsDeveloperRole: false,
					supportsReasoningEffort: false,
					maxTokensField: "max_tokens",
					supportsUsageInStreaming: true,
				},
			},
			{
				id: "MiniCPM5-2B-Q8_0",
				name: "MiniCPM5 2B Q8_0 (local)",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: ctxWindow,
				maxTokens: Math.min(8192, ctxWindow),
				compat: {
					supportsDeveloperRole: false,
					supportsReasoningEffort: false,
					maxTokensField: "max_tokens",
					supportsUsageInStreaming: true,
				},
			},
		],
	});
}