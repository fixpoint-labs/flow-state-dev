import { type NextRequest, NextResponse } from "next/server";
import { getRepository } from "@/lib/portfolio-db";
import {
  estimateTaxLiability,
  summarizeForTaxEstimate,
} from "@/src/flows/portfolio/tax-estimate";

// The composite tax read (FIX-874) — profile + all-year realized gains +
// all-year income-by-year + the current-year estimate, in ONE request so the
// tax pane has one hook and one refetch (deviates from one-route-per-resource;
// see the spec's Key Decision #4). The estimate is composed in-handler from the
// rows already fetched via the pure `estimateTaxLiability` leaf — no
// `getTaxEstimate` repository method that would re-query.
//
// `year` scopes ONLY the estimate; `realizedGains` / `incomeByYear` come back
// all-year so the Realized Gains tab and income view can show prior-year history.
//
// AUTH POSTURE (dev-only): `userId` is client-asserted, exactly as the lab's
// other read routes are. A real multi-user deployment MUST resolve the caller
// identity server-side before trusting it — otherwise it is an IDOR.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const userId = params.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId query param is required" }, { status: 400 });
  }

  // Validate `year` as a finite integer in a sane range → 400 on `?year=abc`,
  // never `Number(...)`-coerced to NaN/0 (which would mislabel the estimate and
  // filter out every row). Default to the current calendar year.
  const yearParam = params.get("year");
  let year = new Date().getFullYear();
  if (yearParam !== null) {
    const n = Number(yearParam);
    if (!Number.isInteger(n) || n < 1900 || n > 2200) {
      return NextResponse.json(
        { error: "year must be an integer between 1900 and 2200" },
        { status: 400 },
      );
    }
    year = n;
  }

  const repo = await getRepository();
  const [profile, realizedGains, incomeByYear, accounts] = await Promise.all([
    repo.getTaxProfile(userId),
    repo.getRealizedGains(userId, {}), // all-year
    repo.getIncomeSummaryByYear(userId, {}), // all-year
    repo.getAccountsForUser(userId),
  ]);

  // Compose the estimate: taxable-account + USD + requested-year filter, summed
  // by term (the pure leaf both the route and its goal-check test share).
  const taxableAccountIds = new Set(
    accounts.filter((a) => a.type === "taxable").map((a) => a.accountId),
  );
  const summary = summarizeForTaxEstimate({
    realized: realizedGains,
    income: incomeByYear,
    taxableAccountIds,
    year,
  });
  const estimate = estimateTaxLiability({ profile, year, ...summary });

  // Note when non-USD or tax-advantaged rows were excluded, so the card is honest
  // about what the estimate does and doesn't cover.
  const hasNonUsd =
    realizedGains.some((r) => r.currency !== "USD") ||
    incomeByYear.some((i) => i.currency !== "USD");
  if (hasNonUsd) {
    estimate.assumptions.push(
      "Non-USD rows are excluded from the estimate (multi-currency is not modeled).",
    );
  }
  const hasAdvantaged = accounts.some((a) => a.type !== "taxable");
  if (hasAdvantaged) {
    estimate.assumptions.push(
      "Tax-advantaged accounts (IRA/Roth/401k) are shown for reference but excluded from the estimate.",
    );
  }
  return NextResponse.json({ profile, realizedGains, incomeByYear, estimate });
}
