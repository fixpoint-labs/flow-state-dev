/**
 * fsdev config for the routing-with-evaluators example.
 *
 * Run from this directory (config discovery is cwd-only):
 *   pnpm fsdev run routing-with-evaluators classify -i '{"message":"I was charged twice for March"}'
 *   pnpm fsdev run routing-with-evaluators route -i '{"message":"I was charged twice for March and need it reversed today"}'
 *   pnpm fsdev run routing-with-evaluators routeWithoutConfidence -i '{"message":"I was charged twice for March"}'
 *   pnpm fsdev run routing-with-evaluators activate -i '{"message":"Nothing will load for anyone on our team since this morning, is something broken on your side?"}'
 *
 * `classify`, `route` and `activate` run on Jev through Vercel's AI Gateway
 * (`AI_GATEWAY_API_KEY`). `routeWithoutConfidence` runs on OpenAI's
 * evaluation model: directly with `OPENAI_API_KEY`, otherwise through the
 * gateway's OpenAI-compatible endpoint with `AI_GATEWAY_API_KEY`.
 */
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { createRoutingFlow } from "./src/flow";
import { JEV, modelWithoutConfidence } from "./src/models";

export default createFlowState({
  flows: {
    "routing-with-evaluators": createRoutingFlow({
      confident: JEV,
      withoutConfidence: modelWithoutConfidence(),
    }),
  },
  // In-memory stores: the example keeps no state across restarts.
  stores: { default: { primary: inMemoryStores() } },
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
