/**
 * fsdev config for the board-lifecycle example.
 *
 * Run from this directory (config discovery is cwd-only):
 *   pnpm fsdev run board-lifecycle seedAndInspect -i '{"items":["a","b","c"]}'
 *   pnpm fsdev run board-lifecycle seedDrainRead  -i '{"items":["a","b","c"]}'
 *
 * The workers are deterministic handlers — no model, no API key.
 */
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import boardLifecycleFlow from "./src/lifecycle-flow";

export default createFlowState({
  flows: { "board-lifecycle": boardLifecycleFlow },
  stores: { default: { primary: inMemoryStores() } },
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
