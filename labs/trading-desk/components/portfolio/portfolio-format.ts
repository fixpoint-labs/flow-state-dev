/**
 * Pure number / currency / percent formatters for the Portfolio view, plus the
 * derived-money math (market value, unrealized P/L, weights).
 *
 * Browser-safe (no framework imports). The "—" sentinel is the real-money trust
 * gate at the formatting layer: any value that depends on a missing current
 * price renders "—", never a fabricated number. Money figures are DISPLAY
 * APPROXIMATIONS (JS floats), not precise accounting — the UI labels them so.
 */

/** The sentinel for an unknown / unavailable value. Used everywhere a current
 *  price is missing so the table degrades gracefully (BP-020 spirit). */
export const DASH = "—";

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

/** Weight = this holding's market value / a total. `null` when either is
 *  unknown or the total is zero. */
export function weight(
  value: number | null,
  total: number | null,
): number | null {
  if (value === null || total === null || total === 0) return null;
  return value / total;
}
