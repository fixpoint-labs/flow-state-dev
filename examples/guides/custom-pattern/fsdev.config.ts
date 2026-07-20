/**
 * fsdev config for the custom-pattern example.
 *
 * Run from this directory (config discovery is cwd-only):
 *   pnpm fsdev run word-count count -i '{"documents":["a b c","one two","w"]}'
 *
 * The map worker is a deterministic handler — no model, no API key. This flow
 * has no generator actions, so it declares a resolver that never resolves a
 * model (skips the env scan that throws when FSDEV_DEFAULT_MODEL is set with no
 * declared intents).
 */
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import type { ModelResolver } from "@flow-state-dev/core";
import wordCountFlow from "./src/word-count-flow";

function neverResolvesAModel(): never {
  throw new Error(
    "custom-pattern example: no generator actions are configured; this flow never resolves a model.",
  );
}
const modelResolver = Object.assign(neverResolvesAModel, {
  resolveId: neverResolvesAModel,
}) as ModelResolver;

export default createFlowState({
  flows: { "word-count": wordCountFlow },
  modelResolver,
  stores: { default: { primary: inMemoryStores() } },
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
