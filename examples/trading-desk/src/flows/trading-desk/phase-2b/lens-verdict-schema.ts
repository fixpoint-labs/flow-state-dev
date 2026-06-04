/**
 * `lensVerdictOutputSchema` — the GENERATOR OUTPUT a single lens emits.
 *
 * STRICT per BP-016: this is emitted by a generator, so it must survive
 * `makeSchemaStrict` + the strict walker. Enums-of-literals + primitives +
 * array-of-strings only; NO record, NO optional, NO default, NO heterogeneous
 * union. "N/A" is an empty-string sentinel (the `asymmetricEdge` precedent), and
 * "no missing data" is an empty array — never `.optional()`.
 *
 * Multi-consumer (the lens generator factory emits it; the lens writer reads the
 * type back to project the memo + the convergence row), so it lives in its own
 * leaf file importing only zod.
 *
 * This is the SINGLE reconciled verdict shape (BUILD_PLAN §7 ruling): spec 05's
 * 3-tier `stance` + `conviction` (sufficient for sizing) PLUS spec 07's
 * `missingData` honesty array. It deliberately does NOT use spec 07's 5-tier
 * `lensRating` / `sizingStance` — the 3-tier stance is enough to compute
 * convergence and feed PM sizing.
 */
import { z } from "zod";

export const lensVerdictOutputSchema = z.object({
  // Echoed so the commit can validate the generator answered for the right
  // lens (defends against a mis-wired factory instance).
  lensId: z.string(),
  // The lens's independent direction on the SAME 3-tier scale used everywhere
  // in this flow, so convergence is comparable apples-to-apples.
  stance: z.enum(["bullish", "neutral", "bearish"]),
  // Self-reported conviction 0..1. Min/max literal bounds are strict-safe.
  conviction: z.number().min(0).max(1),
  // One-sentence verdict in this lens's voice. Required, non-empty (prompt).
  verdict: z.string(),
  // The single most load-bearing driver THIS lens keys on. Required.
  keyDriver: z.string(),
  // What would flip this lens. Empty string when the lens is genuinely neutral.
  disqualifierHit: z.string(),
  // Honest single-line gap flag: non-empty when this lens needed a metric it did
  // not have. Empty string when the bundle was sufficient. BP-020 — surface the
  // gap, never fabricate.
  dataGap: z.string(),
  // The specific data points this lens wanted but the bundle did not supply.
  // Empty array when nothing was missing. The structured companion to `dataGap`
  // (07's missingData honesty array) — the UI lists these so the reader can
  // discount a gap-flagging lens.
  missingData: z.array(z.string()),
});

export type LensVerdictOutput = z.infer<typeof lensVerdictOutputSchema>;
