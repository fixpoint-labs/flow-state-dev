/**
 * fsdev config for the on-disk night-watch layouts.
 *
 * Run from this directory (config discovery is cwd-only). No API key —
 * the handlers are deterministic.
 *
 *   pnpm fsdev run night-watch inspect -i '{}'
 *   pnpm fsdev run inbox-sweep inspect -i '{}'
 */
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import nightWatchIngress from "./src/a-central/ingress/night-watch";
import nightIntakeKind from "./src/a-central/workers/intake/kind";
import nightSweepKind from "./src/a-central/workers/sweep/kind";
import nightTriageKind from "./src/a-central/workers/triage/kind";
import inboxIntakeFlow from "./src/b-per-flow/flows/intake/flow";
import inboxSweepFlow from "./src/b-per-flow/flows/sweep/flow";
import inboxTriageFlow from "./src/b-per-flow/flows/triage/flow";

export default createFlowState({
  flows: {
    [nightWatchIngress.kind]: nightWatchIngress,
    [nightSweepKind.kind]: nightSweepKind,
    [nightIntakeKind.kind]: nightIntakeKind,
    [nightTriageKind.kind]: nightTriageKind,
    [inboxSweepFlow.kind]: inboxSweepFlow,
    [inboxIntakeFlow.kind]: inboxIntakeFlow,
    [inboxTriageFlow.kind]: inboxTriageFlow,
  },
  stores: { default: { primary: inMemoryStores() } },
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
