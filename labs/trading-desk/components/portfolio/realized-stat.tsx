/**
 * RealizedStat — the inline value for a lifetime net realized gain/loss on the
 * portfolio glance surfaces (the account card + the household summary line). One
 * place for the shared convention so both read identically: a signed, colored
 * figure with an "(excl. N)" suffix when some disposals were dropped from the
 * sum for want of a cost basis, and "—" when there's no realized history or a
 * cross-currency set that can't be stated in one currency.
 *
 * Colors match the sibling uP/L stat on the same lines — only a loss reddens
 * (a gain stays default foreground), so a wrong sign can never mis-color a loss
 * as a gain. Pure presentational; the parent supplies the computed total.
 */
"use client";

import type { ReactElement } from "react";
import type { RealizedGainTotal } from "./realized-gains-row-model";
import { DASH, formatSignedMoney } from "./portfolio-format";

/** The realized figure only, for embedding after a "realized" / "total realized"
 *  label in the existing glance lines. `total: null` → "—" (no realized rows). */
export function RealizedStat({
  total,
  currency,
}: {
  total: RealizedGainTotal | null;
  currency: string;
}): ReactElement {
  if (total === null) {
    return <span className="text-[color:var(--c-fg)]">{DASH}</span>;
  }
  const fmt = formatSignedMoney(total.gain, currency);
  return (
    <span style={{ color: fmt.direction === "down" ? "var(--c-warn)" : "var(--c-fg)" }}>
      {fmt.text}
      {total.excludedCount > 0 ? (
        <span className="text-[color:var(--c-fg-faint)]"> (excl. {total.excludedCount})</span>
      ) : null}
    </span>
  );
}
