/**
 * GainsTaxesSection — the portfolio pane's household Gains & Taxes perspective
 * (FIX-885): current-year + lifetime realized summary stats, the relocated
 * tax-estimate card, and the household-wide by-year realized view — year cards
 * you drill into, with a toggle between capital gains and total realized income
 * (gains + dividends + interest).
 *
 * The parent threads the household's FULL realized-gains + income-by-year lists
 * unfiltered — the by-year totals are the all-accounts cut (per-account gains
 * stay in `AccountDetail`'s Realized Gains table; this is a different cut, not a
 * replacement). USD is the household display currency: non-USD rows gate to "—"
 * in the models, never silently summed. All derived math is `useMemo` (BP-010);
 * no IO of its own.
 */
"use client";

import { useMemo, type ReactElement } from "react";
import type {
  IncomeSummaryByYearRow,
  RealizedGainRow,
  TaxProfileRow,
} from "@/src/db/repository";
import type { TaxEstimate } from "@/src/flows/portfolio/tax-estimate";
import {
  buildRealizedGainsRowModel,
  computeRealizedGainTotals,
} from "./realized-gains-row-model";
import { RealizedYearCards } from "./realized-year-cards";
import { RealizedStat } from "./realized-stat";
import { TaxEstimateCard } from "./tax-estimate-card";

type GainsTaxesSectionProps = {
  /** Household-wide realized-gain rows, unfiltered (the `useTax` read). */
  realizedGains: RealizedGainRow[];
  /** Household-wide income-by-year rows (dividends + interest), unfiltered. */
  incomeByYear: IncomeSummaryByYearRow[];
  /** The current-year estimate; null until loaded / no profile inputs. */
  estimate: TaxEstimate | null;
  /** The saved tax profile; null when unset. */
  profile: TaxProfileRow | null;
  /** Open the tax-profile editor (the dialog stays mounted at pane level). */
  onEditProfile: () => void;
};

export function GainsTaxesSection({
  realizedGains,
  incomeByYear,
  estimate,
  profile,
  onEditProfile,
}: GainsTaxesSectionProps): ReactElement {
  // Household totals in USD. The "current year" is the estimate's tax year when
  // present (the year the card below describes), else the calendar year. A year
  // with no disposals is a real $0 (known zero — "empty set is 0", the same
  // reason the lifetime grandTotal reads $0 for an empty book), NOT "—": a
  // genuinely-unknowable year still produces a `byYear` entry with a null gain,
  // which renders "—" on its own. `byYear.get` is `| undefined` (year absent =
  // zero disposals) — coalesce that to a zero total, matching the lifetime stat.
  const { currentYear, currentYearTotal, lifetimeTotal } = useMemo(() => {
    const totals = computeRealizedGainTotals(
      buildRealizedGainsRowModel(realizedGains),
      "USD",
    );
    const currentYear = estimate?.year ?? new Date().getFullYear();
    return {
      currentYear,
      currentYearTotal: totals.byYear.get(currentYear) ?? { gain: 0, excludedCount: 0 },
      lifetimeTotal: totals.grandTotal,
    };
  }, [realizedGains, estimate]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-4 font-mono text-[11px] text-[color:var(--c-fg-muted)]">
        <span>
          realized ({currentYear}){" "}
          <RealizedStat total={currentYearTotal} currency="USD" />
        </span>
        <span>
          realized (lifetime){" "}
          <RealizedStat total={lifetimeTotal} currency="USD" />
        </span>
      </div>
      <TaxEstimateCard
        estimate={estimate}
        profile={profile}
        onEditProfile={onEditProfile}
      />
      <div>
        <div className="px-2 pb-1 font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
          Realized by year — all accounts
        </div>
        <RealizedYearCards realizedGains={realizedGains} incomeByYear={incomeByYear} />
      </div>
    </>
  );
}
