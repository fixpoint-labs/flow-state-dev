/**
 * Pure number / currency / percent formatters for the Portfolio view, plus the
 * derived-money math (market value, unrealized P/L, weights).
 *
 * Browser-safe (no framework imports). The "—" sentinel is the real-money trust
 * gate at the formatting layer: any value that depends on a missing current
 * price renders "—", never a fabricated number. Money figures are DISPLAY
 * APPROXIMATIONS (JS floats), not precise accounting — the UI labels them so.
 */

import type { AssetClass } from "@/src/domain/portfolio/schema/portfolio-schema";

/** The sentinel for an unknown / unavailable value. Used everywhere a current
 *  price is missing so the table degrades gracefully (BP-020 spirit). */
export const DASH = "—";

/** Display labels for each asset class — the shared home for the pane totals'
 *  allocation breakdown and the Health view's class bars (one copy, BP-028).
 *  (The HoldingsTable's abbreviated `EQ`/`FI` chips are a deliberately different
 *  map and stay local to that component.) */
export const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  equity: "Equity",
  fixed_income: "Fixed income",
  cash: "Cash",
  crypto: "Crypto",
  alternative: "Alt",
};

/** Format a money amount in the account's currency. `null` → "—" (never 0). */
export function formatMoney(value: number | null, currency = "USD"): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // Unknown currency code — fall back to a bare number with the code.
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** Format a signed money amount with an explicit +/- and a ▲/▼ marker. `null`
 *  → "—". Zero renders without a sign marker. */
export function formatSignedMoney(
  value: number | null,
  currency = "USD",
): { text: string; direction: "up" | "down" | "flat" } {
  if (value === null || !Number.isFinite(value)) {
    return { text: DASH, direction: "flat" };
  }
  const base = formatMoney(Math.abs(value), currency);
  if (value > 0) return { text: `+${base}`, direction: "up" };
  if (value < 0) return { text: `-${base}`, direction: "down" };
  return { text: base, direction: "flat" };
}

/** Format a share quantity. Fractional shares show up to 4 decimals, trimmed. */
export function formatQuantity(value: number): string {
  if (!Number.isFinite(value)) return DASH;
  const fixed = value.toFixed(4);
  // Trim trailing zeros but keep at least a whole number.
  return fixed.replace(/\.?0+$/, "");
}

/** Format a weight as a percent of total. `null` → "—". */
export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  return `${(value * 100).toFixed(1)}%`;
}

/** Format a signed return fraction as "+12.3%" / "-4.0%". `null` → "—".
 *  Zero renders without a sign, matching {@link formatSignedMoney}. */
export function formatSignedPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return DASH;
  const base = `${(Math.abs(value) * 100).toFixed(1)}%`;
  if (value > 0) return `+${base}`;
  if (value < 0) return `-${base}`;
  return base;
}

/** Market value = quantity × current price. `null` price → null value. */
export function marketValue(
  quantity: number,
  price: number | null,
): number | null {
  if (price === null || !Number.isFinite(price)) return null;
  return quantity * price;
}

/** Unrealized P/L = (price − avg cost) × quantity. `null` if either price or
 *  cost basis is unknown — never fabricated from a partial input. */
export function unrealizedPL(
  quantity: number,
  costBasis: number | null,
  price: number | null,
): number | null {
  if (price === null || costBasis === null) return null;
  if (!Number.isFinite(price) || !Number.isFinite(costBasis)) return null;
  return (price - costBasis) * quantity;
}

/** Unrealized P/L as a fraction of cost = (price − avg cost) / avg cost.
 *  `null` when either input is unknown or cost is zero (a zero-cost position
 *  has no meaningful return base) — never fabricated from a partial input. */
export function unrealizedPLPercent(
  costBasis: number | null,
  price: number | null,
): number | null {
  if (price === null || costBasis === null || costBasis === 0) return null;
  if (!Number.isFinite(price) || !Number.isFinite(costBasis)) return null;
  return (price - costBasis) / costBasis;
}

/** Weight = this holding's market value / a total. `null` when either is
 *  unknown or the total is zero. */
export function weight(
  value: number | null,
  total: number | null,
): number | null {
  if (value === null || total === null || total === 0) return null;
  return value / total;
}

/** One asset-class row of the portfolio allocation breakdown: the summed market
 *  value in that class and its fraction (0..1) of the priced total. */
export type AllocationSlice = {
  assetClass: AssetClass;
  value: number;
  weight: number;
};

/** Group per-holding market values into an allocation-by-class breakdown.
 *
 *  An entry with a `null` value (no resolvable price) contributes 0 mass — the
 *  same "—" real-money gate the rest of this module applies, so an unpriced bond
 *  ETF never fabricates a weight. A class whose priced mass is 0 is omitted.
 *  Slices are ordered by value descending (largest exposure first); `weight` is
 *  the slice's fraction of the priced total. Pure — no IO. */
export function allocationByClass(
  entries: { assetClass: AssetClass; value: number | null }[],
): AllocationSlice[] {
  const totals = new Map<AssetClass, number>();
  for (const { assetClass, value } of entries) {
    if (value === null || !Number.isFinite(value)) continue;
    totals.set(assetClass, (totals.get(assetClass) ?? 0) + value);
  }
  const total = [...totals.values()].reduce((sum, v) => sum + v, 0);
  if (total === 0) return [];
  return [...totals.entries()]
    .map(([assetClass, value]) => ({ assetClass, value, weight: value / total }))
    .sort((a, b) => b.value - a.value);
}
