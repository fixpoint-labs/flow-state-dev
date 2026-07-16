"use client";

import { useFlowContext } from "@flow-state-dev/react";
import { useApiQuery } from "@/lib/use-api-query";
import type {
  IncomeSummaryByYearRow,
  RealizedGainRow,
  TaxProfileRow,
} from "@/db/repository";
import type { TaxEstimate } from "@/domain/portfolio/math/tax-estimate";

/**
 * Read the household's tax view (FIX-874) from the composite
 * `/api/portfolio/tax` route: the saved tax profile, all-year realized gains,
 * all-year income by year, and the current-year estimate. A thin `useApiQuery`
 * wrapper mirroring `useIncome`/`useLedger` — the pane refetches this right
 * after each ledger mutation, each account save/delete, and a tax-profile save,
 * so no stream-settle backstop is needed.
 *
 * `year` scopes ONLY the estimate; `realizedGains` / `incomeByYear` always come
 * back all-year so the Realized Gains tab and the Gains & Taxes year cards show
 * prior-year history. Omit `year` to use the route's default (current year).
 */
export function useTax(year?: number): {
  profile: TaxProfileRow | null;
  realizedGains: RealizedGainRow[];
  incomeByYear: IncomeSummaryByYearRow[];
  estimate: TaxEstimate | null;
  refetch: () => void;
} {
  const { userId } = useFlowContext();
  const uid = userId ?? "devuser";
  const query = new URLSearchParams({ userId: uid });
  if (year !== undefined) query.set("year", String(year));
  const { data, refetch } = useApiQuery<{
    profile: TaxProfileRow | null;
    realizedGains: RealizedGainRow[];
    incomeByYear: IncomeSummaryByYearRow[];
    estimate: TaxEstimate | null;
  }>(`/api/portfolio/tax?${query.toString()}`);
  return {
    profile: data?.profile ?? null,
    realizedGains: data?.realizedGains ?? [],
    incomeByYear: data?.incomeByYear ?? [],
    estimate: data?.estimate ?? null,
    refetch,
  };
}
