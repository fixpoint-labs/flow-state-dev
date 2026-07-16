/**
 * IncomeTable — ledger-derived income per (account, ticker): dividends and
 * interest, INCLUDING positions that have since closed (the holdings row is
 * gone; the income was still earned) and account-level cash income with no
 * security (`ticker: null` → "Cash / account"). Two layouts off one row list,
 * switched by a CSS container query — the `LedgerTable` precedent.
 *
 * Pure presentational. The parent owns the read (`useIncome`); this component
 * only formats. Amounts sum non-voided ledger events, so a voided correction
 * drops out of the figure automatically.
 */
"use client";

import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import type { IncomeSummaryRow } from "@/db/repository";
import { formatMoney } from "./portfolio-format";

type IncomeTableProps = {
  income: IncomeSummaryRow[];
  /** accountId → display name, for the account column. */
  accountNames: Map<string, string>;
  /** The set of tickers with an ACTIVE holdings row, to tag closed positions. */
  activeTickers: Set<string>;
  currency: string;
};

const headerClass =
  "px-2 py-1 text-left font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]";
const cellClass = "px-2 py-1 font-mono text-[11.5px] text-[color:var(--c-fg)]";
const numCellClass = cn(cellClass, "text-right tabular-nums");

/** A small "closed" pill marking income from a position no longer held. */
function ClosedBadge(): ReactElement {
  return (
    <span
      className="ml-1.5 rounded px-1 py-0.5 font-mono text-[8.5px] uppercase tracking-wider text-[color:var(--c-fg-muted)]"
      style={{ border: "1px solid var(--c-border)" }}
      title="Position no longer held — income earned while it was open"
    >
      closed
    </span>
  );
}

export function IncomeTable({
  income,
  accountNames,
  activeTickers,
  currency,
}: IncomeTableProps): ReactElement {
  if (income.length === 0) {
    return (
      <p className="px-2 py-3 text-[11.5px] text-[color:var(--c-fg-muted)]">
        No income recorded yet. Dividends and interest appear here as the ledger
        records them.
      </p>
    );
  }

  return (
    <div className="@container">
      {/* Wide container (≥ @3xl): the dense table. */}
      <table className="hidden w-full border-collapse @3xl:table">
        <thead>
          <tr className="border-b border-[color:var(--c-border)]">
            <th className={headerClass}>Ticker</th>
            <th className={headerClass}>Account</th>
            <th className={cn(headerClass, "text-right")}>Dividends</th>
            <th className={cn(headerClass, "text-right")}>Interest</th>
            <th className={cn(headerClass, "text-right")}>Last Event</th>
          </tr>
        </thead>
        <tbody>
          {income.map((r) => (
            <tr
              key={`${r.accountId}:${r.ticker ?? ""}`}
              className="border-b border-[color:var(--c-border)]/40"
            >
              <td className={cn(cellClass, "font-semibold")}>
                {r.ticker ?? "Cash / account"}
                {r.ticker !== null && !activeTickers.has(r.ticker) ? <ClosedBadge /> : null}
              </td>
              <td className={cn(cellClass, "text-[color:var(--c-fg-muted)]")}>
                {accountNames.get(r.accountId) ?? r.accountId}
              </td>
              <td className={numCellClass}>{formatMoney(r.dividends, currency)}</td>
              <td className={numCellClass}>{formatMoney(r.interest, currency)}</td>
              <td className={cn(numCellClass, "text-[color:var(--c-fg-muted)]")}>
                {r.lastEventDate}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Narrow container (< @3xl): one stacked card per income row. */}
      <ul className="flex flex-col gap-2 @3xl:hidden">
        {income.map((r) => (
          <li
            key={`${r.accountId}:${r.ticker ?? ""}`}
            className="rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-2.5"
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12.5px] font-semibold text-[color:var(--c-fg)]">
                {r.ticker ?? "Cash / account"}
              </span>
              {r.ticker !== null && !activeTickers.has(r.ticker) ? <ClosedBadge /> : null}
              <span className="ml-auto font-mono text-[12.5px] tabular-nums text-[color:var(--c-fg)]">
                {formatMoney(r.dividends + r.interest, currency)}
              </span>
            </div>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5">
              <CardStat label="Account" value={accountNames.get(r.accountId) ?? r.accountId} />
              <CardStat label="Dividends" value={formatMoney(r.dividends, currency)} />
              <CardStat label="Interest" value={formatMoney(r.interest, currency)} />
              <CardStat label="Last event" value={r.lastEventDate} />
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One label/value pair inside an income card's mini grid. */
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
