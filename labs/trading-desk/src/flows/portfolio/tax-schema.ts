/**
 * The user tax profile (FIX-874) — a lightweight, browser-safe schema leaf.
 *
 * Imports ONLY `zod` (BP-019), so the profile dialog validates client-side and
 * the PUT route re-validates off one definition. NOT a generator output —
 * `.default()`/`.nullable()` are fine (BP-016 only constrains generator outputs;
 * the `accountStateSchema` precedent), so do NOT add it to
 * `output-schemas-strict.spec.ts`.
 *
 * The estimate is a deliberate UPPER BOUND (OQ #7): the user supplies their
 * marginal ordinary rate and long-term capital-gains rate, and the estimator
 * applies each directly to its bucket — no bracket tables, no income stacking.
 * Filing status drives only the Schedule-D loss cap ($3,000 / $1,500-MFS); the
 * flat state rate is optional.
 */
import { z } from "zod";

/** Federal filing status — drives the loss-deduction cap ($1,500 for MFS, else
 *  $3,000). Stored as `text`; the enum is enforced here at the boundary. */
export const filingStatusSchema = z.enum(["single", "mfj", "hoh", "mfs"]);
export type FilingStatus = z.infer<typeof filingStatusSchema>;

/** A tax rate on the 0..100 (percent) scale — a rate, not a fraction. The
 *  estimator divides by 100 before use. Bounded so a negative or >100% rate is a
 *  400 at the boundary. */
const ratePct = z.number().finite().min(0).max(100);

/**
 * The tax profile a user saves. `marginalOrdinaryRatePct` and `ltcgRatePct` are
 * REQUIRED — they ARE the estimate's inputs in the upper-bound model; without
 * them there is no estimate. `stateRatePct` is optional (null = federal-only). A
 * plain `ZodObject` (no `.refine()`), so the PUT route can `.extend({ userId })`
 * it directly.
 */
export const taxProfileInputSchema = z.object({
  filingStatus: filingStatusSchema,
  /** The user's marginal ordinary-income rate (short-term gains + interest). */
  marginalOrdinaryRatePct: ratePct,
  /** The user's long-term capital-gains rate (long-term gains + qualified dividends). */
  ltcgRatePct: ratePct,
  /** Optional flat state rate applied to the full taxable bucket; null = federal-only. */
  stateRatePct: ratePct.nullable().default(null),
});
export type TaxProfileInput = z.infer<typeof taxProfileInputSchema>;
