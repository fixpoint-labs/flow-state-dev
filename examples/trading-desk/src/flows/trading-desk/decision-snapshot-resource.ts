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

/** Durable state shape of one report's decision-of-record. The `outcome*`
 *  fields are reserved (null on write) so a future outcome-tracking feature can
 *  fill them without a schema migration. */
export const decisionSnapshotStateSchema = z.object({
  // Identity (echoed from session state for self-containment when scoring).
  ticker: z.string(),
  asOfDate: z.string(),
  // The decision.
  finalRating: z.enum(["Sell", "Underweight", "Hold", "Overweight", "Buy"]),
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
      "decidedAt",
      "outcomeRealizedPrice",
      "outcomeAsOf",
      "outcomeVerdict",
    ],
  },
});
