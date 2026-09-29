/**
 * Style 1 host — same GitHub registration as style 2.
 *
 * TODAY GitHub still hits a flow URL. There is no subscribe table
 * and no `/api/webhooks/github` route. `pr-reviewer` declares no
 * `webhooks.on`, so a live adapter would 404 this kind.
 *
 * The fictional step after verify would be: match the delivery against
 * sessions that already subscribed (see `workers/reviewer/subscribe.ts`).
 */
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { registerGitHubTransport } from "../shared/github-provider";
import prReviewerKind from "./workers/reviewer/kind";
import prTriageKind from "./workers/triage/kind";

export function createPerSessionHost() {
  return createFlowState({
    flows: {
      [prReviewerKind.kind]: prReviewerKind,
      [prTriageKind.kind]: prTriageKind,
    },
    stores: { default: { primary: inMemoryStores() } },
    adapters: [registerGitHubTransport()],
  });
}
