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
  implied: z.enum(["Sell", "Underweight", "Hold", "Overweight", "Buy"]),
  floor: z.enum(["Sell", "Underweight", "Hold", "Overweight", "Buy"]),
  ceiling: z.enum(["Sell", "Underweight", "Hold", "Overweight", "Buy"]),
  rationale: z.string(),
});

export const valuationSpineStateSchema = z.object({
  ticker: z.string(),
  asOf: z.string(),
  expectedReturn: expectedReturnSchema,
  fairValue: fairValueSchema,
  setupScore: setupScoreSchema,
  envelope: ratingEnvelopeSchema,
  valuationMethod: z.enum(["ev-multiples", "equity-multiples"]),
  evidenceBasis: z.enum(["sufficient", "thin"]),
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
