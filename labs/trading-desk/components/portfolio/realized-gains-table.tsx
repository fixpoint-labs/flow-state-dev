/**
 * RealizedGainsTable — one account's realized gains (FIX-874), rolled up by
 * (ticker, year, term, currency) via `buildRealizedGainsRowModel`. Two layouts
 * off ONE view model, switched by a CSS container query: a dense table when the
 * container is wide (≥ @3xl), a stacked card list below — the `IncomeTable`
 * precedent.
 *
 * Pure presentational. The parent threads the household's full realized-gains
 * list; this component filters nothing (the caller passes rows already scoped to
 * the account) and only rolls up + formats. Real-money gates: a null proceeds /
 * cost basis / gain renders "—" (never a fabricated 0), and the gain/loss is
 * colored green/red only when it is a real number. The Currency column shows
 * only when a non-USD row exists (a USD-only account stays uncluttered).
 */
"use client";

import { useMemo, type ReactElement } from "react";
import { cn } from "@/lib/utils";
import type { RealizedGainRow } from "@/src/db/repository";
import {
  buildRealizedGainsRowModel,
  computeRealizedGainTotals,
  type RealizedGainRowModel,
  type RealizedGainTotal,
} from "./realized-gains-row-model";
import { formatMoney, formatQuantity, formatSignedMoney } from "./portfolio-format";

type RealizedGainsTableProps = {
  /** Realized-gain rows already filtered to the account by the caller. */
  realizedGains: RealizedGainRow[];
  currency: string;
};

const TERM_LABELS: Record<RealizedGainRowModel["term"], string> = {
  short: "Short",
  long: "Long",
  unknown: "Unknown",
};

const headerClass =
  "px-2 py-1 text-left font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]";
const cellClass = "px-2 py-1 font-mono text-[11.5px] text-[color:var(--c-fg)]";
const numCellClass = cn(cellClass, "text-right tabular-nums");

/** Green for a gain, red for a loss, neutral for zero / unknown — so a wrong
 *  sign can never mis-color a loss as a gain (the `HoldingsTable` P/L rule). */
function directionColor(direction: "up" | "down" | "flat"): string {
  if (direction === "up") return "var(--c-pos, var(--c-fg))";
  if (direction === "down") return "var(--c-warn)";
  return "var(--c-fg-muted)";
}

/** A colored, signed gain/loss figure ("+$200.00" / "-$40.00" / "—"). */
function GainText({
  gain,
  currency,
}: {
  gain: number | null;
  currency: string;
}): ReactElement {
  const fmt = formatSignedMoney(gain, currency);
  return <span style={{ color: directionColor(fmt.direction) }}>{fmt.text}</span>;
}

/** A year/grand total: the summed gain, plus an "excludes N (basis unknown)"
 *  note when some disposals were dropped from the sum for want of a cost basis —
 *  so the total is stated without silently omitting the unknown rows. Stacks
 *  right-aligned in both the table cell and the inline card contexts. */
function TotalGain({
  total,
  currency,
}: {
  total: RealizedGainTotal;
  currency: string;
}): ReactElement {
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <GainText gain={total.gain} currency={currency} />
      {total.excludedCount > 0 ? (
        <span className="font-mono text-[8.5px] font-normal normal-case tracking-normal text-[color:var(--c-fg-faint)]">
          excludes {total.excludedCount} (basis unknown)
        </span>
      ) : null}
    </span>
  );
}

/** No rows for a year is impossible here (years come from the rows), but Map.get
 *  is nullable — coalesce to an empty total for the type-checker. */
const EMPTY_TOTAL: RealizedGainTotal = { gain: null, excludedCount: 0 };

export function RealizedGainsTable({
  realizedGains,
  currency,
}: RealizedGainsTableProps): ReactElement {
  const rows = useMemo(
    () => buildRealizedGainsRowModel(realizedGains),
    [realizedGains],
  );
  const totals = useMemo(
    () => computeRealizedGainTotals(rows, currency),
    [rows, currency],
  );
  const showCurrency = useMemo(
    () => rows.some((r) => r.currency !== "USD"),
    [rows],
  );

  if (rows.length === 0) {
    return (
      <p className="px-2 py-3 text-[11.5px] text-[color:var(--c-fg-muted)]">
        No realized gains yet. Closed positions with a sell in the ledger appear
        here, split by holding period and year.
      </p>
    );
  }

  // Years in the model's sort order (newest first) — one grouped block each.
  const years = [...new Set(rows.map((r) => r.year))];

  return (
    <div className="@container">
      {/* Wide container (≥ @3xl): the dense table, grouped by year with a
          per-year subtotal and a grand-total footer. */}
      <table className="hidden w-full border-collapse @3xl:table">
        <thead>
          <tr className="border-b border-[color:var(--c-border)]">
            <th className={headerClass}>Ticker</th>
            <th className={cn(headerClass, "text-right")}>Year</th>
            <th className={headerClass}>Term</th>
            <th className={cn(headerClass, "text-right")}>Quantity</th>
            <th className={cn(headerClass, "text-right")}>Proceeds</th>
            <th className={cn(headerClass, "text-right")}>Cost Basis</th>
            <th className={cn(headerClass, "text-right")}>Gain/Loss</th>
            {showCurrency ? (
              <th className={cn(headerClass, "text-right")}>Currency</th>
            ) : null}
          </tr>
        </thead>
        {years.map((year) => {
          const yearRows = rows.filter((r) => r.year === year);
          return (
            <tbody key={year}>
              {yearRows.map((m) => (
                <tr
                  key={`${m.ticker}:${m.term}:${m.currency}`}
                  className="border-b border-[color:var(--c-border)]/40"
                >
                  <td className={cn(cellClass, "font-semibold")}>{m.ticker}</td>
                  <td className={numCellClass}>{m.year}</td>
                  <td className={cn(cellClass, "text-[color:var(--c-fg-muted)]")}>
                    {TERM_LABELS[m.term]}
                  </td>
                  <td className={numCellClass}>{formatQuantity(m.quantity)}</td>
                  <td className={numCellClass}>{formatMoney(m.proceeds, m.currency)}</td>
                  <td className={numCellClass}>{formatMoney(m.costBasis, m.currency)}</td>
                  <td className={numCellClass}>
                    <GainText gain={m.gain} currency={m.currency} />
                  </td>
                  {showCurrency ? (
                    <td className={cn(numCellClass, "text-[color:var(--c-fg-muted)]")}>
                      {m.currency}
                    </td>
                  ) : null}
                </tr>
              ))}
              <tr className="border-b border-[color:var(--c-border)] bg-[color:var(--c-surface-2)]/40">
                <td
                  className={cn(cellClass, "text-[color:var(--c-fg-muted)]")}
                  colSpan={6}
                >
                  {year} total
                </td>
                <td className={numCellClass}>
                  <TotalGain total={totals.byYear.get(year) ?? EMPTY_TOTAL} currency={currency} />
                </td>
                {showCurrency ? <td className={cellClass} /> : null}
              </tr>
            </tbody>
          );
        })}
        <tfoot>
          <tr className="border-t border-[color:var(--c-border)]">
            <td className={cn(cellClass, "font-semibold")} colSpan={6}>
              Total gain/loss
            </td>
            <td className={cn(numCellClass, "font-semibold")}>
              <TotalGain total={totals.grandTotal} currency={currency} />
            </td>
            {showCurrency ? <td className={cellClass} /> : null}
          </tr>
        </tfoot>
      </table>

      {/* Narrow container (< @3xl): year sections of stacked cards, each with a
          subtotal, and a grand total below. */}
      <div className="flex flex-col gap-3 @3xl:hidden">
        {years.map((year) => (
          <div key={year} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                {year}
              </span>
              <span className="font-mono text-[11.5px] tabular-nums">
                <TotalGain total={totals.byYear.get(year) ?? EMPTY_TOTAL} currency={currency} />
              </span>
            </div>
            <ul className="flex flex-col gap-2">
              {rows
                .filter((r) => r.year === year)
                .map((m) => (
                  <li
                    key={`${m.ticker}:${m.term}:${m.currency}`}
                    className="rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12.5px] font-semibold text-[color:var(--c-fg)]">
                        {m.ticker}
                      </span>
                      <span className="rounded-sm border border-[color:var(--c-border)] px-1 py-px font-mono text-[8.5px] uppercase leading-none tracking-wider text-[color:var(--c-fg-faint)]">
                        {TERM_LABELS[m.term]}
                      </span>
                      {showCurrency ? (
                        <span className="font-mono text-[9.5px] text-[color:var(--c-fg-faint)]">
                          {m.currency}
                        </span>
                      ) : null}
                      <span className="ml-auto font-mono text-[12.5px] tabular-nums">
                        <GainText gain={m.gain} currency={m.currency} />
                      </span>
                    </div>
                    <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5">
                      <CardStat label="Quantity" value={formatQuantity(m.quantity)} />
                      <CardStat label="Proceeds" value={formatMoney(m.proceeds, m.currency)} />
                      <CardStat label="Cost basis" value={formatMoney(m.costBasis, m.currency)} />
                    </dl>
                  </li>
                ))}
            </ul>
          </div>
        ))}
        <div className="flex items-baseline justify-between border-t border-[color:var(--c-border)] pt-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            Total gain/loss
          </span>
          <span className="font-mono text-[12.5px] font-semibold tabular-nums">
            <TotalGain total={totals.grandTotal} currency={currency} />
          </span>
        </div>
      </div>
    </div>
  );
}

/** One label/value pair inside a realized-gain card's mini grid. */
function CardStat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
        {label}
      </dt>
      <dd className="font-mono text-[11.5px] tabular-nums text-[color:var(--c-fg)]">
        {value}
      </dd>
    </div>
  );
}
