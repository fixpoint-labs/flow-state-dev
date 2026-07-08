/**
 * 2026 federal tax bracket tables as config-as-data (FIX-874).
 *
 * The `risk-mandate.ts` precedent: a typed `readonly` config keyed by filing
 * status, plus pure resolvers. These are FLAT single-bracket lookups — given a
 * baseline taxable income they return the ONE ordinary marginal rate and the ONE
 * LTCG rate (0/15/20) that income falls in. There is deliberately NO stacking and
 * NO layer-by-layer bracket walk: the estimate that consumes these
 * (`tax-estimate.ts`) is a rough UPPER BOUND, not a Schedule-D calculator
 * (decision 7a). Precise bracket-walking is a documented follow-up.
 *
 * FIGURES: published 2026 federal figures from IRS Rev. Proc. 2025-32 (reflecting
 * the OBBBA), as tabulated by the Tax Foundation
 * (https://taxfoundation.org/data/all/federal/2026-tax-brackets/) and Kiplinger
 * (https://www.kiplinger.com/taxes/irs-updates-capital-gains-tax-thresholds).
 * Each band's `upTo` is the published MAXIMUM taxable income taxed at that rate;
 * the top band is `Infinity`. Versioned by `TAX_YEAR` — a new year is one edit.
 *
 * Pure leaf (BP-019): imports only `zod`-adjacent types via `./tax-schema`, no
 * `@flow-state-dev/core`, browser-safe.
 */
import type { FilingStatus } from "./tax-schema";

/** The tax year these tables encode. The estimator notes when a run's year
 *  differs from this. */
export const TAX_YEAR = 2026;

/** Provenance for the figures below — surfaced in the estimate output. */
export const TAX_TABLE_SOURCE = "Rev. Proc. 2025-32";

/** One bracket band: every taxable dollar up to `upTo` (inclusive) is taxed at
 *  `rate` (a fraction). The top band uses `upTo: Infinity`. */
type Band = { readonly upTo: number; readonly rate: number };

/**
 * The 2026 ordinary-income brackets (10/12/22/24/32/35/37%) per filing status,
 * as `upTo` bands ascending. `upTo` is the published band ceiling: single 10%
 * runs to $12,400, 12% to $50,400, and so on. A flat lookup returns the rate of
 * the first band whose ceiling the income does not exceed.
 */
const ORDINARY_BRACKETS: Readonly<Record<FilingStatus, readonly Band[]>> = {
  single: [
    { upTo: 12_400, rate: 0.1 },
    { upTo: 50_400, rate: 0.12 },
    { upTo: 105_700, rate: 0.22 },
    { upTo: 201_775, rate: 0.24 },
    { upTo: 256_225, rate: 0.32 },
    { upTo: 640_600, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
  mfj: [
    { upTo: 24_800, rate: 0.1 },
    { upTo: 100_800, rate: 0.12 },
    { upTo: 211_400, rate: 0.22 },
    { upTo: 403_550, rate: 0.24 },
    { upTo: 512_450, rate: 0.32 },
    { upTo: 768_700, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
  hoh: [
    { upTo: 17_700, rate: 0.1 },
    { upTo: 67_450, rate: 0.12 },
    { upTo: 105_700, rate: 0.22 },
    { upTo: 201_775, rate: 0.24 },
    { upTo: 256_200, rate: 0.32 },
    { upTo: 640_600, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
  mfs: [
    { upTo: 12_400, rate: 0.1 },
    { upTo: 50_400, rate: 0.12 },
    { upTo: 105_700, rate: 0.22 },
    { upTo: 201_775, rate: 0.24 },
    { upTo: 256_225, rate: 0.32 },
    { upTo: 384_350, rate: 0.35 },
    { upTo: Infinity, rate: 0.37 },
  ],
} as const;

/**
 * The 2026 long-term capital-gains breakpoints (0/15/20%) per filing status, as
 * `upTo` bands. `upTo` is the published maximum taxable income taxed at 0% and at
 * 15% respectively; above the 15% ceiling is 20%.
 */
const LTCG_BRACKETS: Readonly<Record<FilingStatus, readonly Band[]>> = {
  single: [
    { upTo: 49_450, rate: 0 },
    { upTo: 545_500, rate: 0.15 },
    { upTo: Infinity, rate: 0.2 },
  ],
  mfj: [
    { upTo: 98_900, rate: 0 },
    { upTo: 613_700, rate: 0.15 },
    { upTo: Infinity, rate: 0.2 },
  ],
  hoh: [
    { upTo: 66_200, rate: 0 },
    { upTo: 579_600, rate: 0.15 },
    { upTo: Infinity, rate: 0.2 },
  ],
  mfs: [
    { upTo: 49_450, rate: 0 },
    { upTo: 306_850, rate: 0.15 },
    { upTo: Infinity, rate: 0.2 },
  ],
} as const;

/** Return the rate of the first band whose ceiling `income` does not exceed. A
 *  negative income floors to the lowest band. */
function lookupBand(bands: readonly Band[], income: number): number {
  const taxable = Math.max(0, income);
  for (const band of bands) {
    if (taxable <= band.upTo) return band.rate;
  }
  // Unreachable: the last band is always `Infinity`.
  return bands[bands.length - 1].rate;
}

/**
 * The single 2026 ordinary marginal rate (fraction, 0..0.37) for a filing status
 * and baseline taxable income. Flat single-bracket lookup — the bracket the
 * income falls in, no stacking.
 */
export function marginalOrdinaryRate(status: FilingStatus, taxableIncome: number): number {
  return lookupBand(ORDINARY_BRACKETS[status], taxableIncome);
}

/**
 * The single 2026 long-term capital-gains rate (0, 0.15, or 0.20) for a filing
 * status and baseline taxable income. Flat single-bracket lookup by the LTCG
 * breakpoints.
 */
export function ltcgRate(status: FilingStatus, taxableIncome: number): 0 | 0.15 | 0.2 {
  return lookupBand(LTCG_BRACKETS[status], taxableIncome) as 0 | 0.15 | 0.2;
}
