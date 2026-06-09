/**
 * The risk-appetite mandate pack: the variable standard the PM judges the
 * scenario-derived reward-to-risk figure against (FIX-752).
 *
 * A mandate is the third decision axis — risk APPETITE — beside the philosophy
 * axis (the investor lenses) and the portfolio-mechanics axis (portfolio-fit).
 * It is config-as-data (the `LENS_PACK` precedent): a small set of named presets,
 * each a bundle of dials. A run resolves ONE effective mandate (a per-run
 * override, else the most-conservative default among the selected accounts, else
 * null = mandate-blind). The PM reads the resolved dials as context and the PM
 * commit gates SIZE against them deterministically.
 *
 * This is a documented, user-settable METHODOLOGY — not financial advice. The
 * dials are pedagogical constants demonstrating parameterized risk gating, not a
 * production risk-governance framework.
 *
 * Pure, IO-free leaf (BP-019): imports only `zod`, no `@flow-state-dev/core`.
 */
import { z } from "zod";

/** The mandate ids, in ascending risk order. The single source of truth for the
 *  `z.enum` on the run input and the account default. */
export const MANDATE_IDS = [
  "conservative-income",
  "balanced",
  "aggressive-growth",
] as const;

export type RiskMandateId = (typeof MANDATE_IDS)[number];

/** Zod enum over the mandate ids — for `analyzeInputSchema.riskMandate` and the
 *  account default field. */
export const riskMandateIdSchema = z.enum(MANDATE_IDS);

/**
 * One risk-appetite mandate — a bundle of dials the PM's worth-it gate reads.
 *
 * Soft dials (appetite/tolerance) shape the bright-line `mandateCleared` check
 * and scale size interpretively; the hard `maxTolerableLossPct` is the capacity
 * line that can veto a size regardless of edge. All mandate effects are
 * downward-only — they never inflate a rating or a size. Defined as a zod schema
 * so the resolved mandate can be frozen onto session state and read back type-safe.
 */
export const riskMandateSchema = z.object({
  /** Stable id; the value carried on the run input and the account default. */
  id: riskMandateIdSchema,
  /** Human label for the prompt block and the UI chip. */
  label: z.string(),
  /** Plain-language description rendered into `<riskMandate>` and the UI. */
  description: z.string(),
  /** Ordering for "most conservative wins" across selected accounts (1 = most
   *  conservative). */
  riskRank: z.number(),
  /** Loss-aversion λ — multiplies the probability-weighted downside in the
   *  reward-to-risk ratio (Tversky–Kahneman; λ≈2 is textbook loss-averse). */
  lossAversion: z.number(),
  /** Minimum loss-adjusted Gain/Loss ratio required to clear the worth-it bar. */
  rewardToRiskFloor: z.number(),
  /** Minimum probability-weighted expected return (%) required to clear. */
  hurdleReturnPct: z.number(),
  /** Capacity veto line: the worst-case scenario return (%, positive magnitude)
   *  the book can absorb. A worse worst case hard-caps the size. */
  maxTolerableLossPct: z.number(),
  /** Minimum decision confidence (0–1) required to clear — rises with caution. */
  confidenceFloor: z.number(),
  /** Fractional-Kelly size-aggressiveness dial (0–1). Interpretive: surfaced to
   *  the PM as context so it sizes a cleared name to appetite. */
  kellyFraction: z.number(),
  /** Absolute max target weight (% of NAV) when the soft gates fail. Overridable
   *  by the PM with a stated reason (appetite, not capacity). */
  unclearedCapPct: z.number(),
  /** Absolute max target weight (% of NAV) when the capacity line is breached.
   *  Hard — not overridable (capacity vetoes appetite). */
  capacityVetoCapPct: z.number(),
});

export type RiskMandate = z.infer<typeof riskMandateSchema>;

/**
 * The mandate pack. Three deliberately-differentiated presets spanning a
 * retiree's income book through a volatility-hungry growth fund. Adding or
 * retuning a mandate is one edit here (config-as-data).
 */
export const MANDATE_PACK: readonly RiskMandate[] = [
  {
    id: "conservative-income",
    label: "Conservative income",
    description:
      "A capital-preservation book (e.g. a retiree drawing income). Demands a large reward-to-risk asymmetry, weights downside heavily, refuses names whose worst case it cannot absorb, and sizes small.",
    riskRank: 1,
    lossAversion: 2.5,
    rewardToRiskFloor: 2.0,
    hurdleReturnPct: 6,
    maxTolerableLossPct: 15,
    confidenceFloor: 0.7,
    kellyFraction: 0.25,
    unclearedCapPct: 0.5,
    capacityVetoCapPct: 0,
  },
  {
    id: "balanced",
    label: "Balanced",
    description:
      "A diversified long-term book with moderate risk appetite. The house-default standard: a positive asymmetry and a real expected-return edge, sized to medium conviction.",
    riskRank: 2,
    lossAversion: 2.0,
    rewardToRiskFloor: 1.5,
    hurdleReturnPct: 4,
    maxTolerableLossPct: 25,
    confidenceFloor: 0.6,
    kellyFraction: 0.4,
    unclearedCapPct: 1.5,
    capacityVetoCapPct: 0.5,
  },
  {
    id: "aggressive-growth",
    label: "Aggressive growth",
    description:
      "A volatility-tolerant growth book that rides asymmetric bets. Accepts thinner asymmetry and deeper drawdowns in exchange for upside, and sizes winners up.",
    riskRank: 3,
    lossAversion: 1.25,
    rewardToRiskFloor: 1.0,
    hurdleReturnPct: 2,
    maxTolerableLossPct: 40,
    confidenceFloor: 0.5,
    kellyFraction: 0.6,
    unclearedCapPct: 3.0,
    capacityVetoCapPct: 1.0,
  },
] as const;

/** Resolve a mandate id to its dial bundle. Returns null for `null`, `""`, or
 *  an unknown id (mandate-blind — the run behaves exactly as before FIX-752). */
export function resolveMandate(id: string | null | undefined): RiskMandate | null {
  if (id == null || id === "") return null;
  return MANDATE_PACK.find((m) => m.id === id) ?? null;
}

/**
 * Pick the most conservative mandate (lowest `riskRank`) among a set of account
 * defaults. Capacity-wins: when selected accounts disagree, the run binds to the
 * tightest book's appetite. Returns null when no account carries a resolvable
 * default.
 */
export function mostConservativeMandate(
  ids: Array<string | null | undefined>,
): RiskMandate | null {
  let chosen: RiskMandate | null = null;
  for (const id of ids) {
    const m = resolveMandate(id);
    if (m != null && (chosen == null || m.riskRank < chosen.riskRank)) {
      chosen = m;
    }
  }
  return chosen;
}
