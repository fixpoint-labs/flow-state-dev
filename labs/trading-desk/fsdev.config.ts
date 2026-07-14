/**
 * fsdev config — the single runtime wiring for the trading desk, consumed by
 * both the Next.js route handler (via `lib/server.ts`) and the `fsdev` CLI.
 *
 * Stores are Postgres-backed (FIX-772): embedded PGlite in local dev (no Docker,
 * persisted under `.fsdev/pglite`) and real Postgres via `DATABASE_URL` in
 * deployment, shared with the app-owned portfolio repository on one backing.
 *
 * Run an analysis headlessly, against the same database the app reads:
 *   pnpm fsdev run analysis analyze -i '{"ticker":"NVDA","dataSource":"fixture"}'
 */
import { createGateway } from "@ai-sdk/gateway";
import { createXai } from "@ai-sdk/xai";
import { createModelResolver } from "@flow-state-dev/core/models";
import { createFlowState } from "@flow-state-dev/engine";
import analysisFlow from "./flows/analysis/flow";
import portfolioFlow from "./flows/portfolio/flow";
import { hasXaiKey } from "./lib/providers/xai";
import { portfolioStoreAdapter } from "./db/portfolio-db";

// Pass the OpenAI provider instance explicitly: the resolver's dynamic
// require() path doesn't work under Next.js bundling. The flow emits
// `intent/utility` and `intent/chat` strings (see analysts.ts), so an intent
// map plus a concrete `defaultModel` is required — without them the resolver
// throws on the first generator run.
// The xAI provider is registered as a resolver function that picks the
// **responses** model rather than the default chat model. xAI's `xSearch`
// hosted tool — which the sentiment generator relies on for X/Twitter
// grounding — is only supported on the responses API. Registering the
// provider this way leaves the default `xai.languageModel()` chat path
// unused and routes every `xai/...` resolve through `.responses(...)`.
const xaiProvider = hasXaiKey()
  ? createXai({ apiKey: process.env.XAI_API_KEY })
  : null;

const modelResolver = createModelResolver({
  gateways: { vercel: createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY }) },
  providers: xaiProvider
    ? { xai: (modelId: string) => xaiProvider.responses(modelId) }
    : undefined,
  defaultModel: "vercel/google/gemini-3.1-flash-lite",
  intents: {
    utility: ["vercel/google/gemini-3.1-flash-lite", "vercel/openai/gpt-5.4-nano"],
    fast: ["vercel/google/gemini-3.1-flash-lite", "vercel/openai/gpt-5.4-nano"],
    'fast-reasoning': ["vercel/xai/grok-4.3", "vercel/openai/gpt-5.4-mini"],
    'fast-high-reasoning': ["vercel/google/gemini-3.5-flash", "vercel/openai/gpt-5.4-mini"],
    full: ["vercel/google/gemini-3.5-flash-lite", "vercel/openai/gpt-5.4-nano"],
    'full-reasoning': ["vercel/google/gemini-3.5-flash", "vercel/openai/gpt-5.4-mini"],
    'full-high-reasoning': ["vercel/google/gemini-3.1-pro-preview", "vercel/openai/gpt-5.5"],
  },
});

export default createFlowState({
  flows: { analysis: analysisFlow, portfolio: portfolioFlow },
  modelResolver,
  // Postgres-backed framework store (FIX-772), shared with the portfolio
  // repository over one backing (PGlite in dev, a `pg.Pool` in deploy). The
  // adapter resolves lazily, so the DB init + `app.*` migrations run on first
  // request, not at config-module load.
  stores: { default: { primary: portfolioStoreAdapter } },
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
