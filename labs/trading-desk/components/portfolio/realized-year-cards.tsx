/**
 * RealizedYearCards — the household Gains & Taxes by-year view (FIX-885
 * follow-up). One card per year with a headline figure; click a year to drill
 * into it. A "Show" toggle switches the headline (and the drill-down) between
 * two metrics:
 *
 *  - **Capital gains** — realized gains from disposals; the drill-down lists the
 *    year's closed positions (ticker · term · gain).
 *  - **Total income** — capital gains + dividends + interest; the drill-down
 *    breaks the year into those three components plus the total.
 *
 * Pure presentational over the `buildRealizedIncomeByYear` model — USD is the
 * household display currency, non-USD rows gate to "—" there (never summed).
 * All derived math is `useMemo` (BP-010); the only state is the metric toggle
 * and the set of expanded years.
 */
"use client";

import { useMemo, useState, type ReactElement } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { IncomeSummaryByYearRow, RealizedGainRow } from "@/src/db/repository";
import { Segmented } from "@/components/ui/segmented";
import {
  buildRealizedGainsRowModel,
  type RealizedGainRowModel,
} from "./realized-gains-row-model";
import {
  buildRealizedIncomeByYear,
  type YearRealizedIncome,
} from "./realized-income-by-year";
import { RealizedStat } from "./realized-stat";
import { DASH, formatMoney } from "./portfolio-format";

type Metric = "gains" | "income";

const METRIC_OPTIONS: ReadonlyArray<{ value: Metric; label: string; title: string }> = [
  { value: "gains", label: "Capital gains", title: "Realized gains from disposals" },
  {
    value: "income",
    label: "Total income",
    title: "Capital gains + dividends + interest",
  },
];

const TERM_LABELS: Record<RealizedGainRowModel["term"], string> = {
  short: "Short",
  long: "Long",
  unknown: "Unknown",
};

type RealizedYearCardsProps = {
  /** Household-wide realized-gain rows, unfiltered (the `useTax` read). */
  realizedGains: RealizedGainRow[];
  /** Household-wide income-by-year rows (dividends + interest), unfiltered. */
  incomeByYear: IncomeSummaryByYearRow[];
  /** Household display currency; non-matching rows gate to "—". */
  currency?: string;
};

export function RealizedYearCards({
  realizedGains,
  incomeByYear,
  currency = "USD",
}: RealizedYearCardsProps): ReactElement {
  const [metric, setMetric] = useState<Metric>("gains");
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());

  const years = useMemo(
    () => buildRealizedIncomeByYear(realizedGains, incomeByYear, currency),
    [realizedGains, incomeByYear, currency],
  );
  // Disposal line items grouped by year, for the capital-gains drill-down.
  // This is a HOUSEHOLD cut: `buildRealizedGainsRowModel` groups by
  // (ticker, year, term, currency) with no account dimension, so the same
  // ticker realized in two accounts (e.g. AAPL short-term in a taxable account
  // and an IRA) collapses into ONE line here — the intended all-accounts
  // rollup, not a bug. Per-account attribution lives in each account's Realized
  // Gains tab (`AccountDetail`), which scopes rows to the account first.
  const gainRowsByYear = useMemo(() => {
    const map = new Map<number, RealizedGainRowModel[]>();
    for (const m of buildRealizedGainsRowModel(realizedGains)) {
      const list = map.get(m.year);
      if (list === undefined) map.set(m.year, [m]);
      else list.push(m);
    }
    return map;
  }, [realizedGains]);

  if (years.length === 0) {
    return (
      <p className="px-2 py-3 text-[11.5px] text-[color:var(--c-fg-muted)]">
        No realized gains or income yet. Closed positions and dividend/interest
        events appear here, grouped by year.
      </p>
    );
  }

  function toggleYear(year: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <Segmented<Metric>
        label="Show"
        value={metric}
        options={METRIC_OPTIONS}
        onChange={setMetric}
      />
      <ul className="flex flex-col gap-2">
        {years.map((year) => (
          <YearCard
            key={year.year}
            year={year}
            metric={metric}
            currency={currency}
            expanded={expanded.has(year.year)}
            onToggle={() => toggleYear(year.year)}
            gainRows={gainRowsByYear.get(year.year) ?? []}
          />
        ))}
      </ul>
    </div>
  );
}

/** One year's card: a clickable header with the metric headline, and — when
 *  expanded — the metric-specific drill-down. */
function YearCard({
  year,
  metric,
  currency,
  expanded,
  onToggle,
  gainRows,
}: {
  year: YearRealizedIncome;
  metric: Metric;
  currency: string;
  expanded: boolean;
  onToggle: () => void;
  gainRows: RealizedGainRowModel[];
}): ReactElement {
  // Total income reuses `RealizedStat` (the signed/colored/excl-N convention):
  // the basis-unknown `excludedCount` from the capital-gains leg still applies,
  // and a null total renders "—", never a fabricated figure.
  const headline =
    metric === "gains" ? (
      <RealizedStat total={year.capitalGains} currency={currency} />
    ) : (
      <RealizedStat
        total={{ gain: year.totalIncome, excludedCount: year.capitalGains.excludedCount }}
        currency={currency}
      />
    );

  return (
    <li className="rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-surface)]">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[color:var(--c-surface-2)]/50"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-[color:var(--c-fg-faint)] transition-transform",
            expanded && "rotate-90",
          )}
          aria-hidden
        />
        <span className="font-mono text-[12px] font-semibold text-[color:var(--c-fg)]">
          {year.year}
        </span>
        <span className="ml-auto font-mono text-[12px] tabular-nums">{headline}</span>
      </button>
      {expanded ? (
        <div className="border-t border-[color:var(--c-border)] px-3 py-2">
          {metric === "gains" ? (
            <GainsDrilldown rows={gainRows} currency={currency} />
          ) : (
            <IncomeDrilldown year={year} currency={currency} />
          )}
        </div>
      ) : null}
    </li>
  );
}

/** The capital-gains drill-down: the year's closed positions, one per row. */
function GainsDrilldown({
  rows,
  currency,
}: {
  rows: RealizedGainRowModel[];
  currency: string;
}): ReactElement {
  if (rows.length === 0) {
    return (
      <p className="text-[11px] text-[color:var(--c-fg-muted)]">
        No disposals this year — the year's income sits under Total income.
      </p>
    );
  }
  return (
    <ul className="flex flex-col gap-1">
      {rows.map((m) => (
        <li
          key={`${m.ticker}:${m.term}:${m.currency}`}
          className="flex items-center gap-2 font-mono text-[11.5px]"
        >
          <span className="font-semibold text-[color:var(--c-fg)]">{m.ticker}</span>
          <span className="text-[9px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
            {TERM_LABELS[m.term]}
          </span>
          <span className="ml-auto tabular-nums">
            {/* Per-line gain: no excluded note at the line level (a single row is
                either known or "—" on its own). */}
            <RealizedStat total={{ gain: m.gain, excludedCount: 0 }} currency={m.currency} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The total-income drill-down: the three components plus the year total. */
function IncomeDrilldown({
  year,
  currency,
}: {
  year: YearRealizedIncome;
  currency: string;
}): ReactElement {
  return (
    <dl className="flex flex-col gap-1 font-mono text-[11.5px]">
      <BreakdownRow label="Capital gains">
        <RealizedStat total={year.capitalGains} currency={currency} />
      </BreakdownRow>
      <BreakdownRow label="Dividends">
        <MoneyOrDash value={year.dividends} currency={currency} />
      </BreakdownRow>
      <BreakdownRow label="Interest">
        <MoneyOrDash value={year.interest} currency={currency} />
      </BreakdownRow>
      <div className="mt-0.5 border-t border-[color:var(--c-border)]/60 pt-1">
        <BreakdownRow label="Total realized" strong>
          <RealizedStat
            total={{
              gain: year.totalIncome,
              excludedCount: year.capitalGains.excludedCount,
            }}
            currency={currency}
          />
        </BreakdownRow>
      </div>
    </dl>
  );
}

/** One label/value line in the income breakdown. */
function BreakdownRow({
  label,
  strong,
  children,
}: {
  label: string;
  strong?: boolean;
  children: ReactElement;
}): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt
        className={cn(
          "uppercase tracking-wider text-[color:var(--c-fg-faint)]",
          "text-[9.5px]",
          strong && "text-[color:var(--c-fg-muted)]",
        )}
      >
        {label}
      </dt>
      <dd className={cn("tabular-nums", strong && "font-semibold")}>{children}</dd>
    </div>
  );
}

/** A plain money figure (dividends / interest), or "—" when currency-gated. */
function MoneyOrDash({
  value,
  currency,
}: {
  value: number | null;
  currency: string;
}): ReactElement {
  return (
    <span className="text-[color:var(--c-fg)]">
      {value === null ? DASH : formatMoney(value, currency)}
    </span>
  );
}
