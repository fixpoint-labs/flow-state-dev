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
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssetType, Holding } from "@/src/flows/portfolio/portfolio-schema";
import type { Quote } from "@/src/flows/portfolio/get-quotes";
import {
  resolveHoldingPrice,
  holdingMarketValue,
} from "@/src/flows/portfolio/value-holding";
import {
  DASH,
  formatMoney,
  formatPercent,
  formatQuantity,
  formatSignedMoney,
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

/** Short uppercase type chips (FIX-773 Slice C). Dense, terminal-style — `EQ`
 *  not "Equity". Surfaced next to the ticker so the user sees WHY a row values
 *  at a quote vs a statement mark vs par. */
const TYPE_LABELS: Record<AssetType, string> = {
  equity: "EQ",
  etf: "ETF",
  mutual_fund: "MF",
  bond: "BOND",
  money_market: "MMF",
  crypto: "CRY",
  option: "OPT",
  other: "OTH",
};

/** Render-ready strings for one holding row/card. Every price-derived field
 *  degrades to "—" when no price resolves for the type — never a fabricated
 *  number. `typeLabel` surfaces the asset type even on an unpriced row. */
export type HoldingRowModel = {
  ticker: string;
  /** Short uppercase asset-type chip (e.g. `EQ`, `BOND`, `MMF`). */
  typeLabel: string;
  quantity: string;
  avgCost: string;
  price: string;
  value: string;
  weight: string;
  upl: { text: string; direction: "up" | "down" | "flat" };
};

/** Build the shared view model behind a table row AND a mobile card. Pure —
 *  exported for the node-env spec (`test/holdings-row-model.spec.ts`).
 *
 *  FIX-773 Slice C: the price is resolved BY TYPE (`value-holding.ts`) — equity
 *  via the live quote, a bond/option at its carried statement mark, MMF/cash at
 *  par — so a bond/MMF shows a real value with no live quote. uP/L stays vs the
 *  informational `costBasis` (null for a snapshot-imported bond → "—"). */
export function buildHoldingRowModel(
  holding: Holding,
  quote: Quote | undefined,
  currency: string,
  accountTotal: number | null,
): HoldingRowModel {
  const { price } = resolveHoldingPrice(holding, quote);
  const value = holdingMarketValue(holding, quote);
  const upl = unrealizedPL(holding.quantity, holding.costBasis, price);
  return {
    ticker: holding.ticker,
    typeLabel: TYPE_LABELS[holding.assetType],
    quantity: formatQuantity(holding.quantity),
    avgCost:
      holding.costBasis === null ? DASH : formatMoney(holding.costBasis, currency),
    price: formatMoney(price, currency),
    value: formatMoney(value, currency),
    weight: formatPercent(weight(value, accountTotal)),
    upl: formatSignedMoney(upl, currency),
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
  onDeleteHolding,
}: HoldingsTableProps): ReactElement {
  if (holdings.length === 0) {
    return (
      <p className="px-2 py-3 text-[11.5px] text-[color:var(--c-fg-muted)]">
        No holdings yet. Import a CSV to add positions.
      </p>
    );
  }

  const rows = holdings.map((h) =>
    buildHoldingRowModel(h, prices.get(h.ticker.toUpperCase()), currency, accountTotal),
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
                <span className="inline-flex items-center gap-1.5">
                  {m.ticker}
                  <TypeChip label={m.typeLabel} />
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
              <TypeChip label={m.typeLabel} />
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

/** A tiny uppercase asset-type chip (FIX-773 Slice C), shown next to the ticker
 *  in both layouts so the user sees the holding's type at a glance — and so a
 *  bond/MMF valued at a statement mark / par reads as deliberate, not a quote. */
function TypeChip({ label }: { label: string }): ReactElement {
  return (
    <span className="rounded-sm border border-[color:var(--c-border)] px-1 py-px font-mono text-[8.5px] uppercase leading-none tracking-wider text-[color:var(--c-fg-faint)]">
      {label}
    </span>
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
