/**
 * Pi extension for the local coding benchmark.
 *
 * Registers a custom provider "bench-local" backed by llama-server
 * (OpenAI-compatible endpoint).
 *
 * 2026-09-12: the model list is no longer hardcoded. The run script serves
 * exactly ONE model at a time and passes its alias in BENCH_MODEL, so this
 * extension registers that one model. Adding a model to the benchmark is then
 * purely a models.conf edit — no code change, and no way for the declared
 * parameters to drift between models, because there is only ever one set.
 *
 * Every model gets IDENTICAL parameters so runs are comparable:
 *
 *   - reasoning: true          -> pi parses reasoning_content into thinking
 *                                 blocks; the models think via their chat
 *                                 templates by default (server-side
 *                                 `--reasoning-budget` caps them equally).
 *   - contextWindow: BENCH_CTX -> must match the llama-server -c value for THIS
 *                                 model (the run script probes per model and
 *                                 exports the value it actually loaded with).
 *   - maxTokens: 8192          -> per-response cap, identical for all models,
 *                                 but never more than half the context window:
 *                                 at ctx 8192 a flat 8192 would let one
 *                                 response claim the entire window, leaving no
 *                                 room for the prompt it is answering.
 *
 * No per-request thinking controls are sent (no --thinking), so the server's
 * --reasoning-budget is the single source of truth for the reasoning budget.
 */

export default function (pi: ExtensionAPI) {
	// baseUrl does NOT support $ENV interpolation; resolve it here instead.
	// Normalize: accept the server root with or without a trailing /v1, always
	// produce <root>/v1 (pi-ai uses it directly as the OpenAI SDK baseURL).
	const baseUrl =
		(process.env.LLAMA_BASE_URL ?? "http://127.0.0.1:8123")
			.replace(/\/$/, "")
			.replace(/\/v1$/, "") + "/v1";

	// Keep in sync with llama-server -c. The run script probes each model's
	// highest loadable context and exports BENCH_CTX for that model's runs, so
	// the compaction threshold always matches the real window.
	const ctxWindow = Number(process.env.BENCH_CTX ?? "16384");

	// The alias the run script passed to llama-server --alias, i.e. the model id
	// the server will answer to.
	const modelId = process.env.BENCH_MODEL ?? "bench-model";

	pi.registerProvider("bench-local", {
		name: "Bench Local (llama-server)",
		baseUrl,
		apiKey: "sk-bench",
		authHeader: true,
		api: "openai-completions",
		models: [
			{
				id: modelId,
				name: `${modelId} (local)`,
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: ctxWindow,
				maxTokens: Math.min(8192, Math.floor(ctxWindow / 2)),
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
