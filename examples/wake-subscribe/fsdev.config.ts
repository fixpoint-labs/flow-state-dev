/**
 * fsdev config for the subscribe layouts.
 *
 * Run from this directory (config discovery is cwd-only). No API key —
 * the handlers are deterministic.
 *
 *   pnpm fsdev run pr-reviewer inspect -i '{}'
 *   pnpm fsdev run github-desk inspect -i '{}'
 */
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import prReviewerKind from "./src/1-per-session/workers/reviewer/kind";
import prTriageKind from "./src/1-per-session/workers/triage/kind";
import githubDeskKind from "./src/2-fan-in-route/workers/desk/kind";
import githubIntakeKind from "./src/2-fan-in-route/workers/intake/kind";
import githubReviewerKind from "./src/2-fan-in-route/workers/reviewer/kind";
import githubTriageKind from "./src/2-fan-in-route/workers/triage/kind";

export default createFlowState({
  flows: {
    [prReviewerKind.kind]: prReviewerKind,
    [prTriageKind.kind]: prTriageKind,
    [githubDeskKind.kind]: githubDeskKind,
    [githubIntakeKind.kind]: githubIntakeKind,
    [githubReviewerKind.kind]: githubReviewerKind,
    [githubTriageKind.kind]: githubTriageKind,
  },
  stores: { default: { primary: inMemoryStores() } },
  onError: (error, context) => {
    console.error(`[flow-api] ${context.method} ${context.path}:`, error.message);
  },
});
