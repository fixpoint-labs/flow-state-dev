import { createGateway } from "@ai-sdk/gateway";
import { createXai } from "@ai-sdk/xai";
import { createModelResolver } from "@flow-state-dev/core/models";
import { createFlowApiRouter, createFlowRegistry } from "@flow-state-dev/server";
import { createPostgresStores } from "@flow-state-dev/store-postgres";
import analysisFlow from "@/src/flows/analysis/flow";
import portfolioFlow from "@/src/flows/portfolio/flow";
import { hasXaiKey } from "@/src/flows/analysis/tools/providers/xai";
import { getBacking } from "@/lib/portfolio-db";

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
    'fast-high-reasoning': ["vercel/gemini-3.5-flash", "vercel/openai/gpt-5.4-mini"],
    full: ["vercel/google/gemini-3.5-flash-lite", "vercel/openai/gpt-5.4-nano"],
    'full-reasoning': ["vercel/google/gemini-3.5-flash", "vercel/openai/gpt-5.4-mini"],
    'full-high-reasoning': ["vercel/google/gemini-3.1-pro-preview", "vercel/openai/gpt-5.5"],
  },
});

const registry = createFlowRegistry();
registry.register(analysisFlow);
registry.register(portfolioFlow);

type FlowApiRouter = ReturnType<typeof createFlowApiRouter>;

let routerPromise: Promise<FlowApiRouter> | null = null;

// Build the router lazily. The Postgres-backed store is async, and the embedded
// PGlite dev backing must apply its `app.*` migrations before first use. The
// store and the app's portfolio repository share one backing (`getBacking`), so
// they share a single connection budget. Memoized: the backing and store are
// created exactly once per process, on the first request.
async function buildRouter(): Promise<FlowApiRouter> {
  const { storesOptions } = await getBacking();
  const stores = await createPostgresStores(storesOptions);
  return createFlowApiRouter({
    registry,
    modelResolver,
    stores,
    onError: (error, context) => {
      console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
    },
  });
}

/** The flow API router, built once on first call. Route handlers `await` this. */
export function getRouter(): Promise<FlowApiRouter> {
  routerPromise ??= buildRouter();
  return routerPromise;
}
