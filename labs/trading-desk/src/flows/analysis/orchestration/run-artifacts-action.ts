/**
 * The `runArtifacts` read action — a zero-model handler that projects a finished
 * (or stopped) `analyze` run into the full machine-scoreable `RunArtifactsBundle`.
 *
 * It is the deeper sibling of `runSummary` (`run-summary-action.ts`): where that
 * returns the compact decision projection, this returns the whole scored-artifact
 * bundle the eval suite (FIX-790) reads — the decision snapshot, the memo bodies,
 * the valuation spine, the reward-to-risk figure, lens convergence, the frozen
 * risk mandate, the Phase-2 debate transcript, and the session-state fields the
 * completeness checks need. Run headlessly as
 * `fsdev run analysis runArtifacts -i '{}' --session <id> --capture <file>`, the
 * bundle lands at `result.output` for the caller to read back.
 *
 * Why a separate read action (rather than scraping the analyze capture): the CLI
 * NDJSON stream drops resource VALUES. Reading the resources here via the blessed
 * `ctx.resources` API is the only way to recover the full decision substrate after
 * the fact — and it reuses the same read seam `runSummary` established, so evals
 * read through the same resource API the app uses (works against any store
 * backing, honors schema dual-reads). `runSummary` stays the cheap projection.
 *
 * `buildRunArtifacts` is PURE (same discipline as `buildRunSummary`); this action
 * just feeds it the resource reads.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import type { RoundRobinContributionsState } from "@flow-state-dev/patterns/round-robin";
import { decisionSnapshotResource } from "../decision-snapshot-resource";
import type { DecisionSnapshotState } from "../decision-snapshot-resource";
import { lensConvergenceResource } from "../agents/lenses/lens-convergence-resource";
import type { LensConvergenceState } from "../agents/lenses/lens-convergence-resource";
import { memosCollection, phase2Contributions } from "../resources";
import {
  buildRunArtifacts,
  runArtifactsStateSchema,
} from "../run-artifacts";
import { readAllMemos } from "./read-memos";
import { rewardToRiskResource } from "../reward-to-risk-resource";
import type { RewardToRiskState } from "../reward-to-risk-resource";
import { sessionStateSchema } from "../state";
import { valuationSpineResource } from "../valuation-spine-resource";
import type { ValuationSpineState } from "../valuation-spine-resource";

export const runArtifactsAction = handler({
  name: "run-artifacts",
  // No caller input — the action reads the current session's stored records.
  inputSchema: z.object({}),
  outputSchema: runArtifactsStateSchema,
  // `riskMandate` / `citationIntegrity` / `userThesis` live on session state,
  // not the resource set — declare the state schema exactly as run-summary does.
  sessionStateSchema,
  resources: {
    decisionSnapshot: decisionSnapshotResource,
    memos: memosCollection,
    valuationSpine: valuationSpineResource,
    rewardToRisk: rewardToRiskResource,
    lensConvergence: lensConvergenceResource,
    p2Contributions: phase2Contributions,
  },
  execute: async (_input, ctx) => {
    // An unwritten single resource (a stopped / in-progress run) can surface as
    // `{}` rather than null; `buildRunArtifacts` normalizes each on a required
    // field, so pass whatever is there.
    const decisionSnapshot =
      (ctx.resources.decisionSnapshot.state as DecisionSnapshotState | null) ??
      null;
    const valuationSpine =
      (ctx.resources.valuationSpine.state as ValuationSpineState | null) ??
      null;
    const rewardToRisk =
      (ctx.resources.rewardToRisk.state as RewardToRiskState | null) ?? null;
    const lensConvergence =
      (ctx.resources.lensConvergence.state as LensConvergenceState | null) ??
      null;
    const p2Contributions =
      (ctx.resources.p2Contributions.state as RoundRobinContributionsState | null) ??
      null;

    const memos = await readAllMemos(ctx.resources.memos);

    return buildRunArtifacts({
      sessionState: ctx.session.state,
      decisionSnapshot,
      memos,
      valuationSpine,
      rewardToRisk,
      lensConvergence,
      p2Contributions,
      sessionId: ctx.session.identity.id,
      ranAt: new Date().toISOString(),
    });
  },
});
