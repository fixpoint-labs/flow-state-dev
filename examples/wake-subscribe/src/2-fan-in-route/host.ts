/**
 * Style 2 host — same GitHub registration as style 1.
 *
 * One webhook URL. The desk kind owns the compiled `webhooks.on`:
 *
 *   POST /api/flows/github-desk/webhooks/github
 *
 * Intake and reviewer seats have no webhook route. The desk hops to them.
 */
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { registerGitHubTransport } from "../shared/github-provider";
import githubDeskKind from "./workers/desk/kind";
import githubIntakeKind from "./workers/intake/kind";
import githubReviewerKind from "./workers/reviewer/kind";
import githubTriageKind from "./workers/triage/kind";

export function createFanInHost() {
  return createFlowState({
    flows: {
      [githubDeskKind.kind]: githubDeskKind,
      [githubIntakeKind.kind]: githubIntakeKind,
      [githubReviewerKind.kind]: githubReviewerKind,
      [githubTriageKind.kind]: githubTriageKind,
    },
    stores: { default: { primary: inMemoryStores() } },
    adapters: [registerGitHubTransport()],
  });
}
