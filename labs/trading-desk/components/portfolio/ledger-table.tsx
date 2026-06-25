/**
 * LedgerTable — the transactions list (FIX-774). Two layouts off ONE view model:
 * a dense 6-column table when the container is wide (desktop panes) and a stacked
 * card list when it is narrow (phones), switched by a CSS container query
 * (`@container` / `@3xl:`) — the `HoldingsTable` precedent.
 *
 * Pure presentational. Every row is mapped through `buildLedgerRowModel`, so the
 * real-money "—"-for-missing gate, the signed amount/quantity, the basis-unknown
 * badge, and the voided-row muting hold in both layouts by construction. The
 * parent owns the read (`useLedger`); this component only formats.
 */
"use client";

import { useMemo, type ReactElement } from "react";
import { cn } from "@/lib/utils";
import type { LedgerRow } from "@/src/flows/portfolio/ledger-schema";
import { buildLedgerRowModel, type LedgerRowModel } from "./ledger-row-model";

type LedgerTableProps = {
  events: LedgerRow[];
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

/** A small "basis?" pill marking a transfer-in with no acquisition record. */
function BasisBadge(): ReactElement {
  return (
    <span
      className="ml-1.5 rounded px-1 py-0.5 font-mono text-[8.5px] uppercase tracking-wider text-[color:var(--c-warn)]"
      style={{ border: "1px solid var(--c-warn)" }}
      title="Transfer-in with no acquisition record — cost basis unknown"
    >
      basis?
    </span>
  );
}

export function LedgerTable({ events }: LedgerTableProps): ReactElement {
  // Derive every display string in a memo (BP-010), never an effect.
  const rows = useMemo<LedgerRowModel[]>(
    () => events.map(buildLedgerRowModel),
    [events],
  );

  if (rows.length === 0) {
    return (
      <p className="px-2 py-3 text-[11.5px] text-[color:var(--c-fg-muted)]">
        No transactions yet. Add one to start the ledger.
      </p>
    );
  }

  return (
    <div className="@container">
      {/* Wide container (≥ @3xl): the dense 6-column table. */}
      <table className="hidden w-full border-collapse @3xl:table">
        <thead>
          <tr className="border-b border-[color:var(--c-border)]">
            <th className={headerClass}>Date</th>
            <th className={headerClass}>Type</th>
            <th className={headerClass}>Ticker</th>
            <th className={cn(headerClass, "text-right")}>Qty</th>
            <th className={cn(headerClass, "text-right")}>Amount</th>
            <th className={cn(headerClass, "text-right")}>Source</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr
              key={m.id}
              className={cn(
                "border-b border-[color:var(--c-border)]/40",
                m.voided && "text-[color:var(--c-fg-muted)] line-through",
              )}
            >
              <td className={cellClass}>{m.tradeDate}</td>
              <td className={cn(cellClass, "font-semibold")}>
                {m.type}
                {m.basisUnknown ? <BasisBadge /> : null}
              </td>
              <td className={cellClass}>{m.ticker}</td>
              <td className={numCellClass}>{m.quantity}</td>
              <td
                className={numCellClass}
                style={{ color: m.voided ? undefined : directionColor(m.amount.direction) }}
              >
                {m.amount.text}
              </td>
              <td className={cn(numCellClass, "text-[color:var(--c-fg-muted)]")}>
                {m.source}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Narrow container (< @3xl): one stacked card per transaction. */}
      <ul className="flex flex-col gap-2 @3xl:hidden">
        {rows.map((m) => (
          <li
            key={m.id}
            className={cn(
              "rounded-md border p-2.5",
              "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
              m.voided && "text-[color:var(--c-fg-muted)] line-through",
            )}
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-[12.5px] font-semibold text-[color:var(--c-fg)]">
                {m.type}
              </span>
              {m.basisUnknown ? <BasisBadge /> : null}
              <span
                className="ml-auto font-mono text-[12.5px] tabular-nums"
                style={{
                  color: m.voided ? undefined : directionColor(m.amount.direction),
                }}
              >
                {m.amount.text}
              </span>
            </div>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5">
              <CardStat label="Date" value={m.tradeDate} />
              <CardStat label="Ticker" value={m.ticker} />
              <CardStat label="Qty" value={m.quantity} />
              <CardStat label="Source" value={m.source} />
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One label/value pair inside a transaction card's mini grid. */
function CardStat({
  label,
  value,
}: {
  label: string;
  value: string;
}): ReactElement {
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
