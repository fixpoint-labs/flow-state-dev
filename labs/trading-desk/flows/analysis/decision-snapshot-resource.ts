/**
 * Session-scoped resource: the durable, machine-scoreable record of one
 * analysis's terminal decision plus the entry context needed to later judge
 * whether the call was right.
 *
 * Written once, at PM-commit, from already-published memo state (it is NOT a
 * generator output — every field is computed deterministically in the commit
 * handler, so BP-016's strict-output rules do not bind it). It is the audit
 * record the real-money thesis rests on: Past Reports, the future Summary
 * surface, and outcome tracking all read it.
 *
 * Kept in its own file (pulling `@flow-state-dev/core`'s root barrel, which
 * reaches Node-only model resolvers) so importing the resource never bleeds
 * into client bundles. The pure schema travels with it because only the
 * server-side writer needs the type back.
 *
 * Scope is `session`, not `user`: one report = one session = one snapshot, so
 * it hydrates for free when a report is re-opened and never needs cross-session
 * aggregation. The optional entry-context fields follow the `.nullable()`
 * convention (a run can stop, or the trader memo can be flat/missing).
 */
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";
import { ratingSchema } from "./lib/rating-engine";

/** Durable state shape of one report's decision-of-record. The `outcome*`
 *  fields are reserved (null on write) so a future outcome-tracking feature can
 *  fill them without a schema migration. */
export const decisionSnapshotStateSchema = z.object({
  // Identity (echoed from session state for self-containment when scoring).
  ticker: z.string(),
  asOfDate: z.string(),
  // The decision.
  finalRating: ratingSchema,
  decisionConfidence: z.number().min(0).max(1),
  decisionSummary: z.string(),
  // Entry context (from the trader memo's typed numeric mirrors). Nullable
  // because a run can stop or the trader memo can be flat/missing — these are
  // what outcome tracking scores against realized price later.
  direction: z.enum(["long", "short", "flat"]).nullable().default(null),
  // `entryPrice` is reserved null until a price-history resource exists; see the
  // PM commit handler's sourcing note (the Summary feature lands that resource).
  entryPrice: z.number().nullable().default(null),
  stopPrice: z.number().nullable().default(null),
  targetPrice: z.number().nullable().default(null),
  sizePct: z.number().nullable().default(null),
  holdingPeriod: z
    .enum(["days", "weeks", "months", "quarters"])
    .nullable()
    .default(null),
  // Risk-mandate decision (FIX-752). The machine-scoreable record of how the
  // active mandate shaped the call — the FIX-614 sensitivity-benchmark input.
  // Null when the run was mandate-blind.
  mandateId: z.string().nullable().default(null),
  mandateVerdict: z.enum(["clears", "fails"]).nullable().default(null),
  rewardToRiskLossAdjustedGlr: z.number().nullable().default(null),
  worstCaseReturnPct: z.number().nullable().default(null),
  capacityVetoed: z.boolean().nullable().default(null),
  // Standing-thesis echo (FIX-760). True when a durable per-position thesis was
  // frozen onto the run and reached the decision tier (trader + PM). Derived in
  // the PM commit, never LLM-emitted (the `hasPortfolioContext` precedent) — the
  // deterministic signal the goal check reads to prove the standing thesis was
  // injected. Null on a stopped/in-progress run that never reached the PM.
  hasStandingThesis: z.boolean().nullable().default(null),
  // Durable portfolio-mandate decision (FIX-761). The machine-scoreable record of
  // how the household mandate's standing constraints shaped the size — the goal
  // check's read path (`policy-steers-sizing`). Derived in the PM commit, never
  // LLM-emitted. Null on a mandate-blind / stopped run.
  mandatePresent: z.boolean().nullable().default(null),
  policyVerdict: z
    .enum(["within-policy", "capped", "excluded", "unenforced", "no-mandate"])
    .nullable()
    .default(null),
  positionCapClamped: z.boolean().nullable().default(null),
  excluded: z.boolean().nullable().default(null),
  // The target entering the policy gate (post-FIX-752, pre-cap/exclusion clamp) —
  // so a clamp is attributable to the policy cap vs the FIX-752 gate.
  preGatePolicyTargetPct: z.number().nullable().default(null),
  // Evidence-sufficiency verdict (FIX-781) — the always-on capital gate's record.
  // Null on a legacy pre-feature snapshot / stopped run.
  evidenceVerdict: z
    .enum(["sufficient", "insufficient-evidence"])
    .nullable()
    .default(null),
  // Provenance.
  decidedAt: z.string(), // ISO commit time
  // Outcome-tracking fields — NULL on write; a FUTURE feature fills these.
  // Declared now so the resource shape is forward-stable and the seam is real.
  outcomeRealizedPrice: z.number().nullable().default(null),
  outcomeAsOf: z.string().nullable().default(null),
  outcomeVerdict: z
    .enum(["correct", "incorrect", "inconclusive"])
    .nullable()
    .default(null),
});
export type DecisionSnapshotState = z.infer<typeof decisionSnapshotStateSchema>;

/**
 * The decision-snapshot resource. No `default` — it is created explicitly by
 * the PM commit (the first `patchState` initializes it, filling unspecified
 * nullable fields from their `.default(null)`). Absent on stopped/in-progress
 * runs. `client.expose` opts the read-relevant fields into the session snapshot
 * so a future Summary/outcome surface can read them via `useResource` without a
 * debug endpoint.
 */
export const decisionSnapshotResource = defineResource({
  scope: "session",
  ref: "tradingDeskDecisionSnapshot",
  stateSchema: decisionSnapshotStateSchema,
  writable: true,
  client: {
    expose: [
      "ticker",
      "asOfDate",
      "finalRating",
      "decisionConfidence",
      "decisionSummary",
      "direction",
      "entryPrice",
      "stopPrice",
      "targetPrice",
      "sizePct",
      "holdingPeriod",
      "mandateId",
      "mandateVerdict",
      "rewardToRiskLossAdjustedGlr",
      "worstCaseReturnPct",
      "capacityVetoed",
      "hasStandingThesis",
      "mandatePresent",
      "policyVerdict",
      "positionCapClamped",
      "excluded",
      "preGatePolicyTargetPct",
      "evidenceVerdict",
      "decidedAt",
      "outcomeRealizedPrice",
      "outcomeAsOf",
      "outcomeVerdict",
    ],
  },
});
