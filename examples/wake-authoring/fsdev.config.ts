/**
 * fsdev config for the wake-authoring examples.
 *
 * Run from this directory (config discovery is cwd-only). No API key — the
 * handlers are deterministic.
 *
 *   pnpm fsdev run inbox-watch-flow inspect -i '{}'
 *   pnpm fsdev run inbox-watch-flow sweep -i '{"reason":"manual"}'
 */
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import inboxWatchFlowConfig from "./src/flow-config";
import inboxWatchWakesAlias from "./src/wakes-alias-flow";
import inboxWatchWorkerMd from "./src/worker-md/flow";

export default createFlowState({
  flows: {
    "inbox-watch-flow": inboxWatchFlowConfig,
    "inbox-watch-worker": inboxWatchWorkerMd,
    "inbox-watch-alias": inboxWatchWakesAlias,
  },
  stores: { default: { primary: inMemoryStores() } },
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
