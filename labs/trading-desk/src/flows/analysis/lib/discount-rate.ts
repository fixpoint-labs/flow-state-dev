/**
 * Sector/leverage-aware discount rate for the DCF intrinsic-value method.
 *
 * The snapshot carries no beta, so a full CAPM cost of equity is unsourceable
 * (the same constraint that keeps fair-value on the hurdle rate). Instead this
 * resolves a per-GICS-sector base rate from a hand-maintained table, adds a
 * small leverage premium when net debt is elevated, and clamps the result to a
 * sane band. When the sector is unmapped or null it falls back to the flat 9%
 * hurdle — the discount rate ALWAYS resolves; abstention is reserved for missing
 * cash-flow inputs (see `dcf.ts`), never the discount rate alone.
 *
 * The sector table is HAND-MAINTAINED, not a live feed. Rates sit on the
 * conservative (dexter-heuristic) side, floored near Damodaran's Jan-2026 sector
 * WACCs. Review annually against
 * https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/wacc.html.
 *
 * Keys match `lib/sector-resolution.ts` `GICS_TO_ETF` exactly (Yahoo emits
 * canonical GICS casing), so there is no normalization layer. Financial Services
 * is intentionally absent: the DCF abstains on financials before the lookup, so
 * the table never sees that sector.
 */
import { HURDLE_RATE } from "./expected-return";

/** Per-GICS-sector base discount rate. See file header for sourcing + cadence. */
export const SECTOR_DISCOUNT_RATES: Record<string, number> = {
  Technology: 0.10,
  "Communication Services": 0.085,
  "Consumer Cyclical": 0.09,
  "Consumer Defensive": 0.075,
  Energy: 0.10,
  Healthcare: 0.09,
  Industrials: 0.085,
  "Basic Materials": 0.09,
  "Real Estate": 0.08,
  Utilities: 0.065,
};

/** 6% floor — sits just under the lowest table rate (Utilities, 6.5%) so every
 *  sector rate survives the clamp; the Gordon tail stays safe since r − terminal
 *  ≥ 0.06 − 0.02 = 0.04 > 0. */
export const DISCOUNT_RATE_FLOOR = 0.06;
export const DISCOUNT_RATE_CEILING = 0.14;

/** Elevated net leverage (netDebt / operatingIncome) above this adds a premium. */
const LEVERAGE_PREMIUM_THRESHOLD = 3;
const LEVERAGE_PREMIUM = 0.005;

export interface DiscountRate {
  rate: number;
  /** `"sector"` when the table resolved the sector; `"hurdle-fallback"` otherwise. */
  basis: "sector" | "hurdle-fallback";
}

/**
 * Resolve the discount rate for a name. `sector` keys the base-rate table;
 * `netLeverage` (netDebt / operatingIncome, from `DerivedValuation`) adds a
 * leverage premium when elevated. Always returns a clamped rate — never null.
 */
export function resolveDiscountRate(args: {
  sector: string | null;
  netLeverage: number | null;
}): DiscountRate {
  const { sector, netLeverage } = args;

  const tableRate = sector != null ? SECTOR_DISCOUNT_RATES[sector] : undefined;
  const basis: DiscountRate["basis"] = tableRate != null ? "sector" : "hurdle-fallback";
  let rate = tableRate ?? HURDLE_RATE;

  // Higher leverage → higher cost of capital. No discount for net cash in v1
  // (keep it conservative and simple).
  if (netLeverage != null && netLeverage > LEVERAGE_PREMIUM_THRESHOLD) {
    rate += LEVERAGE_PREMIUM;
  }

  rate = Math.max(DISCOUNT_RATE_FLOOR, Math.min(DISCOUNT_RATE_CEILING, rate));

  return { rate, basis };
}
