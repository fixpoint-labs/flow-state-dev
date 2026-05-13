import { createGateway } from "@ai-sdk/gateway";
import { createModelResolver } from "@flow-state-dev/core/models";
import {
  createFlowApiRouter,
  createFlowRegistry,
} from "@flow-state-dev/server";
import tradingDeskFlow from "@/src/flows/trading-desk/flow";

// Pass the OpenAI provider instance explicitly: the resolver's dynamic
// require() path doesn't work under Next.js bundling. The flow emits
// `intent/utility` and `intent/chat` strings (see analysts.ts), so an intent
// map plus a concrete `defaultModel` is required — without them the resolver
// throws on the first generator run.
const modelResolver = createModelResolver({
  gateways: { vercel: createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY }) },
  defaultModel: "vercel/google/gemini-3.1-flash-lite",
  intents: {
    utility: ["vercel/google/gemini-3.1-flash-lite"],
    fast: ["vercel/google/gemini-3.1-flash-lite"],
    full: ["vercel/openai/gpt-5.5"],
  },
});

const registry = createFlowRegistry();
registry.register(tradingDeskFlow);

export const router = createFlowApiRouter({
  registry,
  modelResolver,
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
