/**
 * fsdev config for the knowledge-base incubation lab.
 *
 * Wires the `knowledge` example flow and a model resolver for the `ask`
 * generator. The `explore` action is model-free, so a bundle can be mounted and
 * listed even without gateway credentials:
 *
 *   pnpm fsdev run knowledge explore -i '{}'
 *
 * The `ask` generator resolves `intent/chat` through the Vercel AI Gateway
 * (set AI_GATEWAY_API_KEY). The intent map is declared so the resolver accepts
 * the container's FSDEV_INTENT_* overrides without throwing at config load.
 */
import { createGateway } from "@ai-sdk/gateway";
import { createModelResolver } from "@flow-state-dev/core/models";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import knowledgeFlow from "./src/flow";

const modelResolver = createModelResolver({
  gateways: { vercel: createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY }) },
  defaultModel: "vercel/openai/gpt-5.4-mini",
  intents: {
    chat: ["vercel/openai/gpt-5.4-mini"],
    plan: ["vercel/openai/gpt-5.4-mini"],
    reason: ["vercel/openai/gpt-5.4-mini"],
    utility: ["vercel/openai/gpt-5.4-nano"],
  },
});

export default createFlowState({
  flows: { knowledge: knowledgeFlow },
  modelResolver,
  // In-memory stores — the incubation lab keeps no state across runs.
  stores: { default: { primary: inMemoryStores() } },
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
