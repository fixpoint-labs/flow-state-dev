/**
 * GainsTaxesSection — the portfolio pane's household Gains & Taxes perspective
 * (FIX-885): current-year + lifetime realized summary stats, the relocated
 * tax-estimate card, and the household-wide year-by-year realized-gains table.
 *
 * The parent threads the household's FULL realized-gains list unfiltered — the
 * table's per-year subtotals are the all-accounts cut (per-account gains stay
 * in `AccountDetail`'s Realized Gains tab; this is a different cut, not a
 * replacement). USD is the household display currency: non-USD rows gate to
 * "—" via `computeRealizedGainTotals`'s currency guard, never silently summed.
 * All derived math is `useMemo` (BP-010); no IO of its own.
 */
"use client";

import { useMemo, type ReactElement } from "react";
import type { RealizedGainRow, TaxProfileRow } from "@/src/db/repository";
import type { TaxEstimate } from "@/src/flows/portfolio/tax-estimate";
import {
  buildRealizedGainsRowModel,
  computeRealizedGainTotals,
} from "./realized-gains-row-model";
import { RealizedGainsTable } from "./realized-gains-table";
import { RealizedStat } from "./realized-stat";
import { TaxEstimateCard } from "./tax-estimate-card";

type GainsTaxesSectionProps = {
  /** Household-wide realized-gain rows, unfiltered (the `useTax` read). */
  realizedGains: RealizedGainRow[];
  /** The current-year estimate; null until loaded / no profile inputs. */
  estimate: TaxEstimate | null;
  /** The saved tax profile; null when unset. */
  profile: TaxProfileRow | null;
  /** Open the tax-profile editor (the dialog stays mounted at pane level). */
  onEditProfile: () => void;
};

export function GainsTaxesSection({
  realizedGains,
  estimate,
  profile,
  onEditProfile,
}: GainsTaxesSectionProps): ReactElement {
  // Household totals in USD. The "current year" is the estimate's tax year when
  // present (the year the card below describes), else the calendar year. An
  // empty book keeps the lifetime figure a real $0 (no disposals, no gain —
  // matching the toolbar stat), while a missing current-year entry renders "—"
  // (`byYear.get` is `| undefined`; `RealizedStat` takes `| null`).
  const { currentYear, currentYearTotal, lifetimeTotal } = useMemo(() => {
    const totals = computeRealizedGainTotals(
      buildRealizedGainsRowModel(realizedGains),
      "USD",
    );
    const currentYear = estimate?.year ?? new Date().getFullYear();
    return {
      currentYear,
      currentYearTotal: totals.byYear.get(currentYear) ?? null,
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
          Realized gains — all accounts
        </div>
        <RealizedGainsTable realizedGains={realizedGains} currency="USD" />
      </div>
    </>
  );
}
