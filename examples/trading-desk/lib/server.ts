import { openai } from "@ai-sdk/openai";
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
  providers: { openai },
  defaultModel: "openai/gpt-5.5",
  intents: {
    utility: ["openai/gpt-5.4-mini"],
    chat: ["openai/gpt-5.5"],
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
