/**
 * HoldingsTable — one account's holdings. Two layouts off ONE view model:
 * a dense 8-column table when the container is wide (desktop panes), and a
 * stacked card list when it is narrow (phones — FIX-757). The switch is a CSS
 * container query (`@container` / `@3xl:`), so the component adapts to the
 * width it actually renders at, not the viewport.
 *
 * Pure presentational. The parent (`PortfolioPane`) owns the price map and the
 * derived totals; this component only formats stored quantity/costBasis +
 * looked-up price via `buildHoldingRowModel` — the SAME model feeds both
 * layouts, so table/card formatting parity holds by construction. Real-money
 * gates: a missing price renders "—" on price, value, weight, and uP/L (never
 * a fabricated number); average cost is labeled "informational" at the section
 * level, not asserted as tax basis.
 */
"use client";

import type { ReactElement } from "react";
import { Trash2, NotebookPen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Holding } from "@/src/flows/portfolio/portfolio-schema";
import type { Quote } from "@/src/flows/portfolio/get-quotes";
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
  /** Household tickers (upper-case) that have a standing thesis (FIX-760). */
  thesisTickers: ReadonlySet<string>;
  onDeleteHolding: (ticker: string) => void;
  /** Open the thesis editor for one holding (the per-holding thesis affordance). */
  onEditThesis: (ticker: string) => void;
};

/** Render-ready strings for one holding row/card. Every price-derived field
 *  degrades to "—" when the quote is missing — never a fabricated number. */
export type HoldingRowModel = {
  ticker: string;
  quantity: string;
  avgCost: string;
  price: string;
  value: string;
  weight: string;
  upl: { text: string; direction: "up" | "down" | "flat" };
  /** Whether the household has a standing thesis for this name (FIX-760).
   *  Derived from the household thesis set; drives the quiet per-holding
   *  indicator in BOTH the table cell and the stacked card. */
  hasThesis: boolean;
};

/** Build the shared view model behind a table row AND a mobile card. Pure —
 *  exported for the node-env spec (`test/holdings-row-model.spec.ts`).
 *  `thesisTickers` is the household's set of upper-cased tickers that have a
 *  thesis (household × ticker, FIX-760); omitted → no thesis indicator. */
export function buildHoldingRowModel(
  holding: Holding,
  quote: Quote | undefined,
  currency: string,
  accountTotal: number | null,
  thesisTickers?: ReadonlySet<string>,
): HoldingRowModel {
  const price = quote?.price ?? null;
  const value = marketValue(holding.quantity, price);
  const upl = unrealizedPL(holding.quantity, holding.costBasis, price);
  return {
    ticker: holding.ticker,
    quantity: formatQuantity(holding.quantity),
    avgCost:
      holding.costBasis === null ? DASH : formatMoney(holding.costBasis, currency),
    price: formatMoney(price, currency),
    value: formatMoney(value, currency),
    weight: formatPercent(weight(value, accountTotal)),
    upl: formatSignedMoney(upl, currency),
    hasThesis: thesisTickers?.has(holding.ticker.toUpperCase()) ?? false,
  };
}

const headerClass =
  "px-2 py-1 text-left font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]";
const cellClass = "px-2 py-1 font-mono text-[11.5px] text-[color:var(--c-fg)]";
const numCellClass = cn(cellClass, "text-right tabular-nums");

function directionColor(direction: "up" | "down" | "flat"): string {
  if (direction === "up") return "var(--c-pos, var(--c-fg))";
  if (direction === "down") return "var(--c-warn)";
  return "var(--c-fg-muted)";
}

/** ▲/▼ marker matching the row's P/L direction; empty when flat. */
function directionMarker(direction: "up" | "down" | "flat"): string {
  return direction === "up" ? " ▲" : direction === "down" ? " ▼" : "";
}

export function HoldingsTable({
  holdings,
  prices,
  currency,
  accountTotal,
  thesisTickers,
  onDeleteHolding,
  onEditThesis,
}: HoldingsTableProps): ReactElement {
  if (holdings.length === 0) {
    return (
      <p className="px-2 py-3 text-[11.5px] text-[color:var(--c-fg-muted)]">
        No holdings yet. Import a CSV to add positions.
      </p>
    );
  }

  const rows = holdings.map((h) =>
    buildHoldingRowModel(
      h,
      prices.get(h.ticker.toUpperCase()),
      currency,
      accountTotal,
      thesisTickers,
    ),
  );

  return (
    <div className="@container">
      {/* Wide container (≥ @3xl / 768px): the dense 8-column table. */}
      <table className="hidden w-full border-collapse @3xl:table">
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
          {rows.map((m) => (
            <tr
              key={m.ticker}
              className="border-b border-[color:var(--c-border)]/40"
            >
              <td className={cn(cellClass, "font-semibold")}>
                <span className="inline-flex items-center gap-1">
                  {m.ticker}
                  <ThesisButton
                    ticker={m.ticker}
                    hasThesis={m.hasThesis}
                    onEdit={onEditThesis}
                  />
                </span>
              </td>
              <td className={numCellClass}>{m.quantity}</td>
              <td className={numCellClass}>{m.avgCost}</td>
              <td className={numCellClass}>{m.price}</td>
              <td className={numCellClass}>{m.value}</td>
              <td className={numCellClass}>{m.weight}</td>
              <td
                className={numCellClass}
                style={{ color: directionColor(m.upl.direction) }}
              >
                {m.upl.text}
                {directionMarker(m.upl.direction)}
              </td>
              <td className={cn(cellClass, "text-right")}>
                <DeleteHoldingButton
                  ticker={m.ticker}
                  onDelete={onDeleteHolding}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Narrow container (< @3xl): one stacked card per holding. */}
      <ul className="flex flex-col gap-2 @3xl:hidden">
        {rows.map((m) => (
          <li
            key={m.ticker}
            className={cn(
              "rounded-md border p-2.5",
              "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
            )}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12.5px] font-semibold text-[color:var(--c-fg)]">
                {m.ticker}
              </span>
              <ThesisButton
                ticker={m.ticker}
                hasThesis={m.hasThesis}
                onEdit={onEditThesis}
              />
              <span className="ml-auto font-mono text-[12.5px] tabular-nums text-[color:var(--c-fg)]">
                {m.value}
              </span>
              <DeleteHoldingButton ticker={m.ticker} onDelete={onDeleteHolding} />
            </div>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5">
              <CardStat label="Qty" value={m.quantity} />
              <CardStat label="Avg cost" value={m.avgCost} />
              <CardStat label="Price" value={m.price} />
              <CardStat label="Weight" value={m.weight} />
              <CardStat
                label="Unrl P/L"
                value={`${m.upl.text}${directionMarker(m.upl.direction)}`}
                valueColor={directionColor(m.upl.direction)}
              />
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One label/value pair inside a holding card's mini grid. */
function CardStat({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
        {label}
      </dt>
      <dd
        className="font-mono text-[11.5px] tabular-nums text-[color:var(--c-fg)]"
        style={valueColor !== undefined ? { color: valueColor } : undefined}
      >
        {value}
      </dd>
    </div>
  );
}

/** The shared per-holding thesis affordance (table cell + card header). A quiet
 *  notebook glyph: filled-accent when a thesis exists, faint when it doesn't.
 *  Clicking opens the thesis editor (pre-filled when one exists). The flag
 *  travels through the row model, so both layouts get the indicator identically. */
function ThesisButton({
  ticker,
  hasThesis,
  onEdit,
}: {
  ticker: string;
  hasThesis: boolean;
  onEdit: (ticker: string) => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={() => onEdit(ticker)}
      className={cn(
        "rounded p-0.5 hover:bg-[color:var(--c-surface-2)]",
        hasThesis
          ? "text-[color:var(--c-accent)]"
          : "text-[color:var(--c-fg-faint)] hover:text-[color:var(--c-fg-muted)]",
      )}
      aria-label={hasThesis ? `Edit thesis for ${ticker}` : `Add thesis for ${ticker}`}
      title={hasThesis ? `Thesis recorded — edit ${ticker}` : `Add a thesis for ${ticker}`}
    >
      <NotebookPen className="h-3 w-3" aria-hidden />
    </button>
  );
}

/** The shared per-holding delete affordance (table row + card header). */
function DeleteHoldingButton({
  ticker,
  onDelete,
}: {
  ticker: string;
  onDelete: (ticker: string) => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={() => onDelete(ticker)}
      className="rounded p-1 text-[color:var(--c-fg-faint)] hover:bg-[color:var(--c-surface-2)] hover:text-[color:var(--c-warn)]"
      aria-label={`Delete ${ticker}`}
      title={`Delete ${ticker}`}
    >
      <Trash2 className="h-3 w-3" aria-hidden />
    </button>
  );
}
