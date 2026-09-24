/**
 * fsdev config for the custom-pattern example.
 *
 * Run from this directory (config discovery is cwd-only):
 *   pnpm fsdev run word-count count -i '{"documents":["a b c","one two","w"]}'
 *
 * The map worker is a deterministic handler — no model, no API key.
 */
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import wordCountFlow from "./src/word-count-flow";

export default createFlowState({
  flows: { "word-count": wordCountFlow },
  stores: { default: { primary: inMemoryStores() } },
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
