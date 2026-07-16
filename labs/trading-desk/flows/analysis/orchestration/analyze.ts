/**
 * The `analyze` pipeline — the top-level orchestration sequence for the
 * trading-desk flow. This is the whole flow narrative in one place: seed
 * session state, run the stop-condition guards, then chain the agent stages
 * in execution order.
 *
 * Three `.tap` + `.exitIf` pairs implement defense-in-depth against
 * degenerate inputs and upstream data failure (see the `checkTickerResolvable`
 * / `checkPhase1HasFundamentalsAndProfile` / `checkPhase1HasData` doc comments
 * in `guards.ts`). The primary-analyst guard runs before the all-error
 * backstop: a partial failure that loses a non-substitutable analyst halts
 * even when the other four succeeded.
 *
 * Import direction is one-way: this module imports the agent stages (via
 * `stages.ts`) and the guards; the agent groups never import back into
 * `orchestration/` (BP-019 — acyclic graph).
 */
import { sequencer } from "@flow-state-dev/core";
import { analyzeInputSchema } from "../flow-schema";
import { computeAndStoreSpine } from "../compute-spine";
import { computeAndStoreRewardToRisk } from "../compute-reward-to-risk";
import { storePriceHistory } from "../store-price-history";
import { resetLensConvergence } from "../agents/lenses/writer";
import {
  checkAssetTypeSupported,
  checkPhase1HasData,
  checkPhase1HasFundamentalsAndProfile,
  checkTickerResolvable,
  seedSession,
} from "./guards";
import {
  analystFanOut,
  forecastStage,
  lensStage,
  portfolioStage,
  researchStage,
  riskStage,
  thesisAuditStage,
  traderStage,
} from "./stages";

/**
 * The `analyze` pipeline. Seeds session state, runs the three guards, then
 * chains the agent stages. Each guard patches `stoppedReason` +
 * `stoppedMessage` when it trips, and the following `.exitIf` bails out
 * before the next stage — so a stop is a normal terminal state.
 */
export const analyze = sequencer({
  name: "trading-desk-analyze",
  inputSchema: analyzeInputSchema,
})
  .step(seedSession)
  // Asset-type gate (FIX-773) runs BEFORE ticker resolution: a non-equity symbol
  // (a bond CUSIP, a crypto pair) would otherwise fail the equity fundamentals
  // probe and stop as "unresolvable-ticker" — technically true but unhelpful. The
  // shape classifier needs no provider, so gating first yields the accurate "this
  // is a bond, the bench is equity-only" stop. A bogus equity-shaped ticker still
  // passes here and is caught by the resolution guard next.
  .tap(checkAssetTypeSupported)
  .exitIf((_v, ctx) => ctx.session.state.stoppedReason !== null)
  .tap(checkTickerResolvable)
  .exitIf((_v, ctx) => ctx.session.state.stoppedReason !== null)
  .step(analystFanOut)
  .tap(checkPhase1HasFundamentalsAndProfile)
  .exitIf((_v, ctx) => ctx.session.state.stoppedReason !== null)
  .tap(checkPhase1HasData)
  .exitIf((_v, ctx) => ctx.session.state.stoppedReason !== null)
  .tap(computeAndStoreSpine)
  // Persist a thinned price-history slice for the Summary overlay. Reads the
  // warm cache the technical analyst already populated — no extra fetch.
  .tap(storePriceHistory)
  .step(researchStage)
  // Phase 2b — investor-lens pack (Slice 5). Pre-decision: runs after Phase 2
  // and before Phase 3 so convergence is a context input the PM reasons with.
  // COST-GATED on the `full` preset only (RISK-F3): N parallel heavy generators
  // multiply token spend, so a `fast` run skips the pack entirely (no memos, no
  // convergence resource). On `fast`, the PM still emits `portfolioFit` — just
  // without a convergence-derived `convictionBasis`.
  //
  // Reset any prior convergence FIRST, unconditionally (outside the gate), so a
  // re-run never surfaces a stale read. Not reachable today (costPreset is in the
  // keying tuple, so a session's preset is fixed) — defensive against a future
  // tuple change. The `full` pack then overwrites it; `fast` leaves it null.
  .tap(resetLensConvergence)
  .stepIf((_v, ctx) => ctx.session.state.costPreset === "full", lensStage)
  .step(traderStage)
  .step(riskStage)
  .step(forecastStage)
  // Derive the reward-to-risk figure from the committed scenario buckets and
  // the active mandate's loss-aversion, before the PM reads it (FIX-752). A
  // deterministic tap (no model call) — null resource when no usable buckets.
  .tap(computeAndStoreRewardToRisk)
  .step(portfolioStage)
  // Phase 6 — post-decision thesis audit. Only runs when the caller supplied
  // a usable thesis at seed time; otherwise the pipeline ends at the PM.
  .stepIf(
    (_v, ctx) => ctx.session.state.userThesis !== null,
    thesisAuditStage,
  );
