/**
 * Pure, browser-safe tax-profile input schema (FIX-874).
 *
 * The user's small, opt-in tax profile: filing status, a baseline taxable
 * income (used ONLY to look up the flat marginal/LTCG rate — the gain is never
 * stacked on it, that's a Non-Goal), and optional rate overrides. It drives the
 * deliberately-rough upper-bound estimate in `tax-estimate.ts`; it is NOT a
 * generator output, so `.nullable()` / `.default()` are fine (BP-016 only
 * constrains generator outputs — do NOT add this to `output-schemas-strict`).
 *
 * Imports ONLY `zod` — no `@flow-state-dev/core` — so the profile dialog can
 * validate client-side and the REST route can re-validate off one definition
 * (BP-019: leaf, no cycles, bundle-safe).
 *
 * `taxProfileInputBase` is kept an unrefined `ZodObject` so the route can
 * `.extend({ userId })` / `.omit()` it (a `.refine()`d schema is a `ZodEffects`
 * and is neither extendable nor omittable). The refined `taxProfileInputSchema`
 * and the reusable `taxProfileRefine` / `taxProfileRefineMsg` are exported
 * alongside so any composed schema re-applies the same cross-field rule.
 */
import { z } from "zod";

/** The four federal filing statuses the bracket tables cover (Rev. Proc.
 *  2025-32). Single source of truth for the profile enum and `FilingStatus`. */
export const filingStatusSchema = z.enum(["single", "mfj", "hoh", "mfs"]);
export type FilingStatus = z.infer<typeof filingStatusSchema>;

/** A rate expressed on the human 0..100 percent scale (a `22` means 22%). The
 *  estimator divides by 100 before applying it. */
const ratePct = z.number().finite().min(0).max(100);

/**
 * The unrefined profile object. Kept a plain `ZodObject` (no `.refine()`) so the
 * route can `.extend({ userId })` / `.omit()` it — see the file header. All
 * fields are nullable with a `null` default: an all-null profile is structurally
 * valid but fails the cross-field refine below (the estimate needs either a
 * lookup income or both rate overrides).
 */
export const taxProfileInputBase = z.object({
  filingStatus: filingStatusSchema,
  /** Baseline OTHER taxable income, used ONLY to pick the flat marginal/LTCG
   *  rate via a single-bracket lookup. The realized gain is NOT stacked on top
   *  of it (a Non-Goal). May be null when both rate overrides are supplied. */
  taxableIncome: z.number().finite().min(0).nullable().default(null),
  /** Override for the ordinary marginal rate (0..100). Null → look it up from
   *  `taxableIncome`. */
  marginalOrdinaryRatePct: ratePct.nullable().default(null),
  /** Override for the long-term capital-gains rate (0..100). Null → look it up
   *  from `taxableIncome`. */
  ltcgRatePct: ratePct.nullable().default(null),
  /** Flat state rate applied to the whole gain+income sum (0..100). Null →
   *  federal-only estimate. */
  stateRatePct: ratePct.nullable().default(null),
});

/** The cross-field rule: an estimate needs a way to pick rates — either a
 *  baseline income (to look them up) or BOTH explicit rate overrides. */
export const taxProfileRefine = (p: {
  taxableIncome: number | null;
  marginalOrdinaryRatePct: number | null;
  ltcgRatePct: number | null;
}): boolean =>
  p.taxableIncome !== null ||
  (p.marginalOrdinaryRatePct !== null && p.ltcgRatePct !== null);

/** Error metadata paired with `taxProfileRefine` (reused wherever the rule is
 *  re-applied, e.g. the route's `.extend({ userId })` composition). */
export const taxProfileRefineMsg = {
  message:
    "Provide taxableIncome (to look up rates), or both marginalOrdinaryRatePct and ltcgRatePct as overrides.",
};

/** The validated profile input the dialog and route accept. */
export const taxProfileInputSchema = taxProfileInputBase.refine(
  taxProfileRefine,
  taxProfileRefineMsg,
);
export type TaxProfileInput = z.infer<typeof taxProfileInputSchema>;
