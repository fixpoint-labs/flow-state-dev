/**
 * HoldingsTable — one account's holdings. Two layouts off ONE view model:
 * a dense 10-column table when the container is wide (desktop panes), and a
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

import type { ReactElement, ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssetType, Holding } from "@/src/flows/portfolio/portfolio-schema";
import type { Quote } from "@/src/flows/portfolio/get-quotes";
import { computeHoldingTerm, formatTerm, type TermLot } from "./holding-term";
import {
  resolveHoldingPrice,
  holdingMarketValue,
  holdingUnrealizedPL,
  type PriceSource,
} from "@/src/flows/portfolio/value-holding";
import {
  DASH,
  formatMoney,
  formatPercent,
  formatQuantity,
  formatSignedMoney,
  formatSignedPercent,
  unrealizedPLPercent,
  weight,
} from "./portfolio-format";

type HoldingsTableProps = {
  holdings: Holding[];
  /** ticker (upper-case) → resolved quote. Missing entry = price unknown. */
  prices: Map<string, Quote>;
  /** ticker (upper-case) → dividends earned (ledger-derived, FIX-774). A
   *  missing entry means no dividend history recorded — renders "—", not $0. */
  dividends: Map<string, number>;
  /** ticker (upper-case) → open FIFO lots (ledger-derived), for the per-lot
   *  short/long term split. A holding with no entry falls back to its own
   *  `acquiredDate` as one pseudo-lot; no date at all renders "—". */
  lots: Map<string, TermLot[]>;
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
  /** Provenance of `price` (FIX-773 Slice C): a live quote, a carried statement
   *  mark, par, or none. Surfaced as a marker + tooltip so a stale statement mark
   *  is never shown as if it were a live quote (the honesty this module polices). */
  priceSource: PriceSource;
  value: string;
  weight: string;
  upl: { text: string; direction: "up" | "down" | "flat" };
  /** Unrealized P/L as a signed percent of cost ("+12.3%"); "—" when price or
   *  cost is unknown. */
  uplPct: string;
  /** Dividends earned on this holding per the ledger; "—" when none recorded
   *  (no history ≠ zero income). */
  dividends: string;
  /** Holding-period term: "Long", "Short · N mo to long", a mixed "xL / yS ·
   *  N mo" split, or "—" for undated shares. */
  term: string;
};

/** The marker appended after a price to signal a non-live source. A live quote
 *  gets none; a carried statement mark and par are flagged so the number is not
 *  mistaken for a live quote. */
const PRICE_SOURCE_MARK: Record<PriceSource, string> = {
  quote: "",
  statement: "*",
  par: "≈",
  unavailable: "",
};
const PRICE_SOURCE_TITLE: Record<PriceSource, string> = {
  quote: "live quote",
  statement: "carried statement mark (not a live quote)",
  par: "valued at par ($1.00)",
  unavailable: "no price available",
};

/** Build the shared view model behind a table row AND a mobile card. Pure —
 *  exported for the node-env spec (`test/holdings-row-model.spec.ts`).
 *
 *  FIX-773 Slice C: the price is resolved BY TYPE (`value-holding.ts`) — equity
 *  via the live quote, a bond/option at its carried statement mark, MMF/cash at
 *  par — so a bond/MMF shows a real value with no live quote. uP/L stays vs the
 *  informational `costBasis` (null for a snapshot-imported bond → "—").
 *
 *  The term classifies per LOT when ledger lots exist; a lot-less holding falls
 *  back to its own `acquiredDate` as one pseudo-lot ("—" when undated). `asOf`
 *  defaults to now; tests pin it. */
export function buildHoldingRowModel(
  holding: Holding,
  quote: Quote | undefined,
  currency: string,
  accountTotal: number | null,
  dividendsEarned: number | null = null,
  lots: TermLot[] | null = null,
  asOf: Date = new Date(),
): HoldingRowModel {
  // FIX-773 Slice C: value BY TYPE (bond/option → carried mark, MMF/cash → par,
  // equity/etf/crypto → live quote), NOT `quote?.price` alone — else a bond/MMF
  // with no live quote regresses to "—". `price` is the type-resolved per-unit
  // value, so uP/L and uplPct below stay consistent with the market value.
  const { price, priceSource } = resolveHoldingPrice(holding, quote);
  const value = holdingMarketValue(holding, quote);
  const upl = holdingUnrealizedPL(holding, quote);
  const termLots =
    lots !== null && lots.length > 0
      ? lots
      : [{ quantity: holding.quantity, acquiredDate: holding.acquiredDate }];
  return {
    ticker: holding.ticker,
    typeLabel: TYPE_LABELS[holding.assetType],
    quantity: formatQuantity(holding.quantity),
    avgCost:
      holding.costBasis === null ? DASH : formatMoney(holding.costBasis, currency),
    price: formatMoney(price, currency),
    priceSource,
    value: formatMoney(value, currency),
    weight: formatPercent(weight(value, accountTotal)),
    upl: formatSignedMoney(upl, currency),
    uplPct: formatSignedPercent(unrealizedPLPercent(holding.costBasis, price)),
    dividends: formatMoney(dividendsEarned, currency),
    term: formatTerm(computeHoldingTerm(termLots, asOf)),
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

/** A price with a small non-live-source marker + tooltip (FIX-773 Slice C), so a
 *  carried statement mark or a par value is not read as a live quote. */
function PriceText({ model }: { model: HoldingRowModel }): ReactElement {
  const mark = PRICE_SOURCE_MARK[model.priceSource];
  return (
    <span title={PRICE_SOURCE_TITLE[model.priceSource]}>
      {model.price}
      {mark !== "" && (
        <sup className="ml-0.5 text-[color:var(--c-fg-faint)]">{mark}</sup>
      )}
    </span>
  );
}

export function HoldingsTable({
  holdings,
  prices,
  dividends,
  lots,
  currency,
  accountTotal,
  onDeleteHolding,
}: HoldingsTableProps): ReactElement {
  if (holdings.length === 0) {
    return (
      <p className="px-2 py-3 text-[11.5px] text-[color:var(--c-fg-muted)]">
        No holdings yet. Import a CSV or a transaction file to add positions.
      </p>
    );
  }

  const rows = holdings.map((h) =>
    buildHoldingRowModel(
      h,
      prices.get(h.ticker.toUpperCase()),
      currency,
      accountTotal,
      dividends.get(h.ticker.toUpperCase()) ?? null,
      lots.get(h.ticker.toUpperCase()) ?? null,
    ),
  );

  return (
    <div className="@container">
      {/* Wide container (≥ @3xl / 768px): the dense 10-column table. */}
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
            <th className={cn(headerClass, "text-right")}>Dividends</th>
            <th className={cn(headerClass, "text-right")}>Term</th>
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
              <td className={numCellClass}>
                <PriceText model={m} />
              </td>
              <td className={numCellClass}>{m.value}</td>
              <td className={numCellClass}>{m.weight}</td>
              <td
                className={numCellClass}
                style={{ color: directionColor(m.upl.direction) }}
              >
                {m.upl.text}
                {m.uplPct === DASH ? "" : ` (${m.uplPct})`}
                {directionMarker(m.upl.direction)}
              </td>
              <td className={numCellClass}>{m.dividends}</td>
              <td className={cn(numCellClass, "whitespace-nowrap")}>{m.term}</td>
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
              <CardStat label="Price" value={<PriceText model={m} />} />
              <CardStat label="Weight" value={m.weight} />
              <CardStat
                label="Unrl P/L"
                value={`${m.upl.text}${m.uplPct === DASH ? "" : ` (${m.uplPct})`}${directionMarker(m.upl.direction)}`}
                valueColor={directionColor(m.upl.direction)}
              />
              <CardStat label="Dividends" value={m.dividends} />
              <CardStat label="Term" value={m.term} />
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
  value: ReactNode;
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
