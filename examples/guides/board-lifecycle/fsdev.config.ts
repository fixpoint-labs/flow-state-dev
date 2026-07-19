/**
 * fsdev config for the board-lifecycle example.
 *
 * Run from this directory (config discovery is cwd-only):
 *   pnpm fsdev run board-lifecycle seedAndInspect -i '{"items":["a","b","c"]}'
 *   pnpm fsdev run board-lifecycle seedDrainRead  -i '{"items":["a","b","c"]}'
 *
 * The workers are deterministic handlers — no model, no API key. This flow has
 * no generator actions at all, so it declares an explicit resolver that never
 * resolves a model; that skips the env scan `createFlowState` would otherwise
 * run (which throws when the ambient env sets FSDEV_DEFAULT_MODEL but no intents
 * are declared).
 */
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import type { ModelResolver } from "@flow-state-dev/core";
import boardLifecycleFlow from "./src/lifecycle-flow";

function neverResolvesAModel(): never {
  throw new Error(
    "board-lifecycle example: no generator actions are configured; this flow never resolves a model.",
  );
}
const modelResolver = Object.assign(neverResolvesAModel, {
  resolveId: neverResolvesAModel,
}) as ModelResolver;

export default createFlowState({
  flows: { "board-lifecycle": boardLifecycleFlow },
  modelResolver,
  stores: { default: { primary: inMemoryStores() } },
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
