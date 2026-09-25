/**
 * fsdev config for the index-time-facets example.
 *
 * The model is named here, once. The flow takes the evaluator block and never
 * builds one. Jev through Vercel's AI Gateway when `AI_GATEWAY_API_KEY` is
 * set, OpenAI's evaluation model otherwise.
 *
 * Run from this directory (config discovery is cwd-only):
 *   pnpm fsdev run index-time-facets write  -i '{"key":"t1","title":"Charged twice","body":"I was charged twice for March."}'
 *   pnpm fsdev run index-time-facets search -i '{"topic":"billing"}'
 */
import { evaluator } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { ticketQuestions } from "./src/facets";
import { ticketsFlow } from "./src/flow";

const triage = evaluator({
  name: "ticket-facets",
  model: process.env.AI_GATEWAY_API_KEY ? "typesafe-ai/jev" : "openai/gpt-5.4-mini",
  questions: ticketQuestions,
});

export default createFlowState({
  flows: { "index-time-facets": ticketsFlow(triage) },
  stores: { default: { primary: inMemoryStores() } },
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
