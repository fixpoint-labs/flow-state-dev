/**
 * Session-scoped resource that stores the computed valuation spine.
 *
 * Populated by the spine computation tap after Phase 1; read by the
 * `valuationSpine` capability preset to inject `<valuationSpine>` and
 * `<ratingEnvelope>` into downstream generators. State is nullable —
 * null means the spine hasn't been computed yet (or computation failed).
 */
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";
import { ratingSchema } from "./lib/rating-engine";

const expectedReturnSchema = z.object({
  shareholderYield: z.number().nullable(),
  sustainableGrowth: z.number().nullable(),
  expectedReturn: z.number().nullable(),
  hurdle: z.number(),
  excessReturn: z.number().nullable(),
  basis: z.enum(["fcf", "earnings", "none"]),
  lowConfidence: z.boolean(),
});

const fairValueSchema = z.object({
  justifiedPE: z.number().nullable(),
  fairValue: z.number().nullable(),
  marginOfSafety: z.number().nullable(),
  method: z.enum(["justified-pe", "equity-multiples", "none"]),
  available: z.boolean(),
});

const dcfSchema = z.object({
  intrinsicValue: z.number().nullable(),
  marginOfSafety: z.number().nullable(),
  discountRate: z.number().nullable(),
  stage1Growth: z.number().nullable(),
  terminalValueShare: z.number().nullable(),
  impliedGrowth: z.number().nullable(),
  expectationsGap: z.number().nullable(),
  reliability: z.enum(["ok", "tv-dominated"]).nullable(),
  reverseDcfStatus: z.enum(["solved", "below-terminal", "above-bracket", "unavailable"]),
  unavailableReason: z
    .enum([
      "financial-sector",
      "non-positive-fcf",
      "missing-net-debt",
      "missing-growth",
      "missing-market-cap",
      "negative-equity-value",
    ])
    .nullable(),
  method: z.enum(["dcf", "none"]),
  available: z.boolean(),
});

const triangulationSchema = z.object({
  marginOfSafety: z.number().nullable(),
  methodsUsed: z.array(z.enum(["justified-pe", "dcf"])),
  divergence: z.enum(["convergent", "divergent", "single-method", "unavailable"]),
  spread: z.number().nullable(),
});

const setupScoreSchema = z.object({
  score: z.number().nullable(),
  value: z.number().nullable(),
  quality: z.number().nullable(),
  factor: z.number().nullable(),
  momentum: z.number().nullable(),
  evidenceBasis: z.enum(["sufficient", "thin"]),
});

const ratingEnvelopeSchema = z.object({
  absoluteRating: z.enum(["Buy", "Hold", "Sell"]),
  relativeRating: z.enum(["Overweight", "Equal Weight", "Underweight"]),
  implied: ratingSchema,
  floor: ratingSchema,
  ceiling: ratingSchema,
  rationale: z.string(),
});

/** Why the desk could not place the three statements at one period (FIX-1113),
 *  and where each landed. Present exactly when the cross-statement outputs were
 *  withheld — the report reads it to mark the rating unanchored, and its
 *  presence is the run marker that makes "how often does this fire" answerable
 *  from ordinary runs. */
const periodDisclosureSchema = z.object({
  reason: z.enum(["settled-for-less-than-seen", "periods-disagree"]),
  income: z.string().nullable(),
  balance: z.string().nullable(),
  cashflow: z.string().nullable(),
});

export const valuationSpineStateSchema = z.object({
  ticker: z.string(),
  asOf: z.string(),
  // Nullable from FIX-1113: withheld when the three statements do not share a
  // fiscal period. `.default(null)` also carries a session persisted before
  // that change, where the key is present — the default is for the WITHHELD
  // shape, the nullability for the stored one.
  expectedReturn: expectedReturnSchema.nullable().default(null),
  fairValue: fairValueSchema.nullable().default(null),
  // Nullable + default(null) so sessions persisted before FIX-807 (which lack
  // these keys) still parse — the missing key fills to null on `.parse()`.
  dcf: dcfSchema.nullable().default(null),
  triangulation: triangulationSchema.nullable().default(null),
  setupScore: setupScoreSchema.nullable().default(null),
  // The ENVELOPE, not the rating. Absent means the portfolio manager's clamp
  // never runs, so its rating publishes UNBOUNDED — absence here is permission,
  // not suppression. `periodDisclosure` is what carries the honesty.
  envelope: ratingEnvelopeSchema.nullable().default(null),
  valuationMethod: z.enum(["ev-multiples", "equity-multiples"]),
  evidenceBasis: z.enum(["sufficient", "thin"]),
  periodDisclosure: periodDisclosureSchema.nullable().default(null),
});

export type ValuationSpineState = z.infer<typeof valuationSpineStateSchema>;

export const valuationSpineResource = defineResource({
  scope: "session",
  ref: "valuationSpine",
  stateSchema: valuationSpineStateSchema.nullable(),
  default: null,
  writable: true,
  // A single resource only surfaces in the client snapshot when it declares a
  // client PROJECTION (`hasClientProjection`: expose/exclude/data) — an empty
  // `client: {}` would never reach the client (the Summary's spine read stays
  // null). `exclude: []` = identity-expose the full state, type-safe on a nullable.
  client: { exclude: [] },
});
