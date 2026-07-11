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
import { Trash2, NotebookPen } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AssetClass, AssetType, Holding } from "@/src/flows/portfolio/portfolio-schema";
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
  /** Household tickers (upper-case) that have a standing thesis (FIX-760). */
  thesisTickers: ReadonlySet<string>;
  /** Whether the household theses have finished loading. The thesis button is
   *  disabled until then, so a click can't open a blank editor against a partial
   *  list and overwrite an unloaded thesis (FIX-760). Defaults to true. */
  thesisReady?: boolean;
  onDeleteHolding: (ticker: string) => void;
  /** Open the thesis editor for one holding (the per-holding thesis affordance). */
  onEditThesis: (ticker: string) => void;
  /** Manually set a holding's allocation class (marks it a manual override, so
   *  auto-classification preserves it). */
  onSetAssetClass: (ticker: string, assetClass: AssetClass) => void;
  /** Open the "resolve split" dialog for a flagged inconsistent-history row
   *  (FIX-876). Omitted → the ⚠ marker is a static badge (no resolve action). */
  onResolveSplit?: (ticker: string) => void;
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
  /** Allocation bucket, for the per-row class picker (the editable override). */
  assetClass: AssetClass;
  quantity: string;
  avgCost: string;
  price: string;
  /** Provenance of `price` (FIX-773 Slice C): a live quote, a carried statement
   *  mark, par, or none. Surfaced as a marker + tooltip so a stale statement mark
   *  is never shown as if it were a live quote (the honesty this module polices). */
  priceSource: PriceSource;
  /** The quote's own market time for a quote-sourced price (FIX-823), so the row
   *  can label per-holding staleness; null for par / a bare statement mark /
   *  unavailable. Named `priceAsOf` (not `asOf`) to avoid conflating it with the
   *  `asOf: Date` "now" baseline `buildHoldingRowModel` takes for term classification. */
  priceAsOf: string | null;
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
  /** Whether the household has a standing thesis for this name (FIX-760).
   *  Derived from the household thesis set; drives the quiet per-holding
   *  indicator in BOTH the table cell and the stacked card. */
  hasThesis: boolean;
  /** Flagged inconsistent history (FIX-876): the ledger derived this ticker to an
   *  impossible over-sold state (an unaccounted corporate action — usually an
   *  unrecorded split). The row is materialized flagged rather than deleted; the
   *  UI shows a ⚠ "review transactions" marker and blanks the (meaningless)
   *  quantity/value/weight/P-L so no fabricated position is implied. */
  inconsistent: boolean;
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
 *  defaults to now; tests pin it. `thesisTickers` is the household's set of
 *  upper-cased tickers that have a thesis (household × ticker, FIX-760); omitted
 *  → no thesis indicator. */
export function buildHoldingRowModel(
  holding: Holding,
  quote: Quote | undefined,
  currency: string,
  accountTotal: number | null,
  dividendsEarned: number | null = null,
  lots: TermLot[] | null = null,
  thesisTickers?: ReadonlySet<string>,
  asOf: Date = new Date(),
): HoldingRowModel {
  // FIX-773 Slice C: value BY TYPE (bond/option → carried mark, MMF/cash → par,
  // equity/etf/crypto → live quote), NOT `quote?.price` alone — else a bond/MMF
  // with no live quote regresses to "—". `price` is the type-resolved per-unit
  // value, so uP/L and uplPct below stay consistent with the market value.
  const { price, priceSource, asOf: priceAsOf } = resolveHoldingPrice(holding, quote);
  const value = holdingMarketValue(holding, quote);
  const upl = holdingUnrealizedPL(holding, quote);
  const termLots =
    lots !== null && lots.length > 0
      ? lots
      : [{ quantity: holding.quantity, acquiredDate: holding.acquiredDate }];
  // A flagged inconsistent-history row (FIX-876) has a meaningless derived
  // quantity (0, materialized only to keep the position visible), so blank every
  // quantity/value-derived field to "—" and surface the review marker instead of
  // a fabricated position.
  const inconsistent = holding.dataQuality === "inconsistent_history";
  return {
    ticker: holding.ticker,
    typeLabel: TYPE_LABELS[holding.assetType],
    assetClass: holding.assetClass,
    quantity: inconsistent ? DASH : formatQuantity(holding.quantity),
    avgCost:
      holding.costBasis === null ? DASH : formatMoney(holding.costBasis, currency),
    price: formatMoney(price, currency),
    priceSource,
    priceAsOf,
    value: inconsistent ? DASH : formatMoney(value, currency),
    weight: inconsistent ? DASH : formatPercent(weight(value, accountTotal)),
    upl: inconsistent ? { text: DASH, direction: "flat" } : formatSignedMoney(upl, currency),
    uplPct: inconsistent ? DASH : formatSignedPercent(unrealizedPLPercent(holding.costBasis, price)),
    dividends: formatMoney(dividendsEarned, currency),
    term: inconsistent ? DASH : formatTerm(computeHoldingTerm(termLots, asOf)),
    hasThesis: thesisTickers?.has(holding.ticker.toUpperCase()) ?? false,
    inconsistent,
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
 *  carried statement mark or a par value is not read as a live quote. For a
 *  quote-sourced price the tooltip also labels the quote's own as-of date
 *  (FIX-823), so per-holding staleness is honest (AAPL fresh, TSLA 3 days old). */
function PriceText({ model }: { model: HoldingRowModel }): ReactElement {
  const mark = PRICE_SOURCE_MARK[model.priceSource];
  const title =
    model.priceAsOf !== null
      ? `${PRICE_SOURCE_TITLE[model.priceSource]} · as of ${model.priceAsOf}`
      : PRICE_SOURCE_TITLE[model.priceSource];
  return (
    <span title={title}>
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
  thesisTickers,
  thesisReady = true,
  onDeleteHolding,
  onEditThesis,
  onSetAssetClass,
  onResolveSplit,
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
      thesisTickers,
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
                <span className="inline-flex items-center gap-1">
                  {m.ticker}
                  <TypeChip label={m.typeLabel} />
                  {m.inconsistent ? (
                    <InconsistentBadge
                      onResolve={onResolveSplit ? () => onResolveSplit(m.ticker) : undefined}
                    />
                  ) : null}
                  <AssetClassPicker
                    ticker={m.ticker}
                    assetClass={m.assetClass}
                    onSet={onSetAssetClass}
                  />
                  <ThesisButton
                    ticker={m.ticker}
                    hasThesis={m.hasThesis}
                    disabled={!thesisReady}
                    onEdit={onEditThesis}
                  />
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
              {m.inconsistent ? (
                <InconsistentBadge
                  onResolve={onResolveSplit ? () => onResolveSplit(m.ticker) : undefined}
                />
              ) : null}
              <AssetClassPicker
                ticker={m.ticker}
                assetClass={m.assetClass}
                onSet={onSetAssetClass}
              />
              <ThesisButton
                ticker={m.ticker}
                hasThesis={m.hasThesis}
                disabled={!thesisReady}
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

/** The ⚠ "inconsistent — review transactions" marker (FIX-876), shown next to the
 *  ticker in BOTH layouts when the ledger derived this ticker to an impossible
 *  over-sold state (typically an unrecorded split). It replaces the row's numbers
 *  (blanked to "—" in the row model) so a real position is never silently dropped
 *  nor shown as a fabricated figure. When `onResolve` is provided it is a button
 *  that opens the one-click split resolver ("⚠ resolve"); otherwise a static
 *  "⚠ review" marker. */
function InconsistentBadge({ onResolve }: { onResolve?: () => void }): ReactElement {
  const className =
    "rounded-sm px-1 py-px font-mono text-[8.5px] uppercase leading-none tracking-wider text-[color:var(--c-warn)]";
  const style = { border: "1px solid var(--c-warn)" };
  const title =
    "Inconsistent history — disposals exceed everything held, usually an unrecorded stock split. Record the split to fix (click to resolve).";
  if (onResolve === undefined) {
    return (
      <span className={className} style={style} title={title}>
        ⚠ review
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onResolve}
      className={cn(className, "cursor-pointer hover:bg-[color:var(--c-warn)]/10")}
      style={style}
      title={title}
    >
      ⚠ resolve
    </button>
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

/** Short labels for the per-row asset-class override picker. */
const CLASS_OPTIONS: { value: AssetClass; label: string }[] = [
  { value: "equity", label: "Equity" },
  { value: "fixed_income", label: "Fixed inc" },
  { value: "cash", label: "Cash" },
  { value: "crypto", label: "Crypto" },
  { value: "alternative", label: "Alt" },
];

/** A compact native-select override for a holding's allocation class. Auto-
 *  classification covers the common cases; this is the durable escape hatch for
 *  a ticker the classifier misses (setting it marks the row a manual override, so
 *  a later re-import won't revert it). */
function AssetClassPicker({
  ticker,
  assetClass,
  onSet,
}: {
  ticker: string;
  assetClass: AssetClass;
  onSet: (ticker: string, assetClass: AssetClass) => void;
}): ReactElement {
  return (
    <select
      aria-label={`Asset class for ${ticker}`}
      value={assetClass}
      onChange={(e) => onSet(ticker, e.target.value as AssetClass)}
      className="cursor-pointer rounded-sm border border-[color:var(--c-border)] bg-[color:var(--c-surface)] px-1 py-px font-mono text-[8.5px] uppercase leading-none tracking-wider text-[color:var(--c-fg-muted)]"
    >
      {CLASS_OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
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

/** The shared per-holding thesis affordance (table cell + card header). A quiet
 *  notebook glyph: filled-accent when a thesis exists, faint when it doesn't.
 *  Clicking opens the thesis editor (pre-filled when one exists). The flag
 *  travels through the row model, so both layouts get the indicator identically. */
function ThesisButton({
  ticker,
  hasThesis,
  disabled = false,
  onEdit,
}: {
  ticker: string;
  hasThesis: boolean;
  /** Disabled until the household theses finish loading — a click against a
   *  partial list could blank-edit and overwrite an unloaded thesis (FIX-760). */
  disabled?: boolean;
  onEdit: (ticker: string) => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={() => onEdit(ticker)}
      disabled={disabled}
      className={cn(
        "rounded p-0.5",
        disabled
          ? "cursor-not-allowed text-[color:var(--c-fg-faint)] opacity-40"
          : cn(
              "hover:bg-[color:var(--c-surface-2)]",
              hasThesis
                ? "text-[color:var(--c-accent)]"
                : "text-[color:var(--c-fg-faint)] hover:text-[color:var(--c-fg-muted)]",
            ),
      )}
      aria-label={hasThesis ? `Edit thesis for ${ticker}` : `Add thesis for ${ticker}`}
      title={
        disabled
          ? "Loading theses…"
          : hasThesis
            ? `Thesis recorded — edit ${ticker}`
            : `Add a thesis for ${ticker}`
      }
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
