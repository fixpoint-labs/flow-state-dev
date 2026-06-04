/**
 * Session-scoped resource that stores the DETERMINISTIC lens-convergence
 * summary — the FIX-655 honesty guarantee.
 *
 * Computed (not generated) by `computeAndStoreConvergence` from the N committed
 * lens verdicts after the phase-2b fan-out. Convergence is arithmetic over
 * independent verdicts, never a narrative an LLM could massage; the PM reads it
 * as a CONTEXT INPUT to size `portfolioFit` (convergence -> conviction -> size).
 *
 * State is nullable: null means the lens pack did not run (the `fast` cost
 * preset skips it entirely — RISK-F3) or has not computed yet. On `full` the
 * first `patchState` initializes it (single-resource write verb — there is no
 * `.set()` on a single resource; precedent: `valuationSpine.patchState(...)`).
 *
 * Leaf file (BP-019): imports only core + zod. `lensConvergenceStateSchema` is
 * `z.record`-free so `resources.ts` can import it for the memo mirror without a
 * cycle (this file never imports back from `resources.ts`).
 *
 * NOTE: this is RESOURCE STATE, not a generator output — `.nullable()` /
 * `.default()` are fine here (BP-016 only constrains generator output shapes).
 */
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

/** One lens's verdict, mirrored from its committed memo onto the convergence
 *  resource so the PM context + UI read a single place. `label` / `attribution`
 *  are copied from the lens pack (not LLM-emitted). */
export const lensVerdictRecordSchema = z.object({
  lensId: z.string(),
  label: z.string(),
  attribution: z.string(),
  glyph: z.string(),
  stance: z.enum(["bullish", "neutral", "bearish"]),
  conviction: z.number(),
  verdict: z.string(),
  keyDriver: z.string(),
  dataGap: z.string(),
  missingData: z.array(z.string()),
});

export type LensVerdictRecord = z.infer<typeof lensVerdictRecordSchema>;

export const lensConvergenceStateSchema = z.object({
  verdicts: z.array(lensVerdictRecordSchema),
  // Net directional lean across lenses, conviction-weighted, in [-1, 1].
  // Σ(stanceSign × conviction) / N where stanceSign is +1/0/−1.
  netLean: z.number(),
  // Fraction of lenses agreeing with the majority stance, in [0, 1]. The
  // CONVICTION SIGNAL fed to PM sizing (robustness, not truth).
  agreementScore: z.number(),
  // Bucketed read for the UI + the PM context.
  classification: z.enum(["convergent", "mixed", "divergent"]),
  // The modal stance across lenses (ties → neutral).
  majorityStance: z.enum(["bullish", "neutral", "bearish"]),
  // Lens ids that dissent from the majority — the "this is philosophy-dependent"
  // tell. Surfaced (greyed) in the UI.
  dissenters: z.array(z.string()),
});

export type LensConvergenceState = z.infer<typeof lensConvergenceStateSchema>;

export const lensConvergenceResource = defineResource({
  scope: "session",
  ref: "lensConvergence",
  stateSchema: lensConvergenceStateSchema.nullable(),
  default: null,
  writable: true,
  // No client projection: the UI reads convergence via the PM memo mirror
  // (`MemoState["lensConvergence"]`, projected at commit), never this resource
  // directly. It only needs to be session-scoped + writable for the
  // deterministic handler write and the PM's server-side context read.
});
