/**
 * HoldingsTable — one account's holdings as a dense table: ticker, quantity,
 * average cost, current price, market value, weight %, and unrealized P/L.
 *
 * Pure presentational. The parent (`PortfolioPane`) owns the price map and the
 * derived totals; this component only formats stored quantity/costBasis +
 * looked-up price. Real-money gates: a missing price renders "—" on price,
 * value, weight, and uP/L (never a fabricated number); average cost is labeled
 * "informational" at the section level, not asserted as tax basis.
 */
"use client";

import type { ReactElement } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Holding } from "@/src/flows/trading-desk/portfolio/portfolio-schema";
import type { Quote } from "@/src/flows/trading-desk/portfolio/get-quotes";
import {
  DASH,
  formatMoney,
  formatPercent,
  formatQuantity,
  formatSignedMoney,
  marketValue,
  unrealizedPL,
  weight,
} from "./portfolio-format";

type HoldingsTableProps = {
  holdings: Holding[];
  /** ticker (upper-case) → resolved quote. Missing entry = price unknown. */
  prices: Map<string, Quote>;
  currency: string;
  /** Account total market value, for weight %. `null` while prices load. */
  accountTotal: number | null;
  onDeleteHolding: (ticker: string) => void;
};

const headerClass =
  "px-2 py-1 text-left font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]";
const cellClass = "px-2 py-1 font-mono text-[11.5px] text-[color:var(--c-fg)]";
const numCellClass = cn(cellClass, "text-right tabular-nums");

function directionColor(direction: "up" | "down" | "flat"): string {
  if (direction === "up") return "var(--c-pos, var(--c-fg))";
  if (direction === "down") return "var(--c-warn)";
  return "var(--c-fg-muted)";
}

export function HoldingsTable({
  holdings,
  prices,
  currency,
  accountTotal,
  onDeleteHolding,
}: HoldingsTableProps): ReactElement {
  if (holdings.length === 0) {
    return (
      <p className="px-2 py-3 text-[11.5px] text-[color:var(--c-fg-muted)]">
        No holdings yet. Import a CSV to add positions.
      </p>
    );
  }

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr className="border-b border-[color:var(--c-border)]">
          <th className={headerClass}>Ticker</th>
          <th className={cn(headerClass, "text-right")}>Qty</th>
          <th className={cn(headerClass, "text-right")}>Avg Cost</th>
          <th className={cn(headerClass, "text-right")}>Price</th>
          <th className={cn(headerClass, "text-right")}>Value</th>
          <th className={cn(headerClass, "text-right")}>Weight</th>
          <th className={cn(headerClass, "text-right")}>Unrl P/L</th>
          <th className={cn(headerClass, "text-right")} aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {holdings.map((h) => {
          const quote = prices.get(h.ticker.toUpperCase());
          const price = quote?.price ?? null;
          const value = marketValue(h.quantity, price);
          const upl = unrealizedPL(h.quantity, h.costBasis, price);
          const uplFmt = formatSignedMoney(upl, currency);
          const w = weight(value, accountTotal);
          return (
            <tr
              key={h.ticker}
              className="border-b border-[color:var(--c-border)]/40"
            >
              <td className={cn(cellClass, "font-semibold")}>{h.ticker}</td>
              <td className={numCellClass}>{formatQuantity(h.quantity)}</td>
              <td className={numCellClass}>
                {h.costBasis === null
                  ? DASH
                  : formatMoney(h.costBasis, currency)}
              </td>
              <td className={numCellClass}>{formatMoney(price, currency)}</td>
              <td className={numCellClass}>{formatMoney(value, currency)}</td>
              <td className={numCellClass}>{formatPercent(w)}</td>
              <td
                className={numCellClass}
                style={{ color: directionColor(uplFmt.direction) }}
              >
                {uplFmt.text}
                {uplFmt.direction === "up"
                  ? " ▲"
                  : uplFmt.direction === "down"
                    ? " ▼"
                    : ""}
              </td>
              <td className={cn(cellClass, "text-right")}>
                <button
                  type="button"
                  onClick={() => onDeleteHolding(h.ticker)}
                  className="rounded p-1 text-[color:var(--c-fg-faint)] hover:bg-[color:var(--c-surface-2)] hover:text-[color:var(--c-warn)]"
                  aria-label={`Delete ${h.ticker}`}
                  title={`Delete ${h.ticker}`}
                >
                  <Trash2 className="h-3 w-3" aria-hidden />
                </button>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
