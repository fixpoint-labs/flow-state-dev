/**
 * The statement-set period contract (FIX-1113) at the outcome level.
 *
 * THE ASSERTION THAT MATTERS HERE IS ON THE VALUE THE REPORT CARRIES, NOT ON
 * THE INTERMEDIATE IT WAS SUPPOSED TO CONSTRAIN. Asserting "the envelope is
 * absent" is NOT asserting the rating is withheld: the envelope only CLAMPS a
 * rating the portfolio manager emits on its own, so its absence means the clamp
 * never runs and the model's value publishes unchanged. A suite that stops at
 * the envelope passes on a build that publishes an unconstrained rating.
 *
 * `buildValuationSpine` is a pure function — the assembled outcome is reachable
 * with no generator, no provider call, and no credential, which is why this can
 * gate in CI at all.
 */
import { describe, it, expect } from "vitest";
import { buildValuationSpine } from "@/flows/analysis/lib/valuation-spine";
import { computeValuation } from "@/flows/analysis/lib/valuation";
import { clampRatingToBand } from "@/flows/analysis/lib/rating-engine";
import { incomeStatementSchema } from "@/flows/analysis/tools/schemas";
import {
  analystStatementDisclosure,
  formatPeriodMismatch,
  statementSetDisclosure,
} from "@/flows/analysis/lib/statement-set-period";

const ANCHOR = "2025-09-27";
const OLDER = "2024-09-28";
/** The market-data source dates the SAME fiscal year three days later. */
const ANCHOR_SKEWED = "2025-09-30";

const income = (periodEnd: string | null) => ({
  source: "edgar" as const,
  ticker: "TEST",
  asOf: periodEnd ?? "2026-05-06",
  periodEnd,
  revenue: 416.161,
  grossProfit: 195.201,
  operatingIncome: 133.05,
  netIncome: 112.01,
  yoyRevenueGrowth: 0.064,
  unit: "USD billions",
});

const balance = (periodEnd: string | null) => ({
  source: "edgar" as const,
  ticker: "TEST",
  asOf: periodEnd ?? "2026-05-06",
  periodEnd,
  totalAssets: 359.241,
  totalLiabilities: 285.508,
  totalEquity: 73.733,
  cashAndEquivalents: 35.934,
  totalDebt: 90.678,
  unit: "USD billions",
});

const cashflow = (periodEnd: string | null) => ({
  source: "edgar" as const,
  ticker: "TEST",
  asOf: periodEnd ?? "2026-05-06",
  periodEnd,
  operating: 111.482,
  investing: 15.195,
  financing: -120.686,
  freeCashFlow: 98.767,
  unit: "USD billions",
});

const fundamentals = {
  source: "yahoo" as const,
  ticker: "TEST",
  asOf: "2026-05-06",
  marketCap: 3000,
  forwardPE: 30,
  trailingPE: 34,
  priceToSales: 7,
  returnOnEquity: 1.5,
  operatingMargin: 0.32,
  grossMargin: 0.47,
  dividendYield: 0.004,
};

const OBS = (returned: string | null, observedNewest: string | null = null) => ({
  observedNewest,
  returned,
});

/** A statement set as the persisted spine holds it. */
function spineSet(opts: {
  income: string | null;
  balance: string | null;
  cashflow: string | null;
  observed?: { income?: string | null; balance?: string | null; cashflow?: string | null };
}) {
  return {
    incomeStatement: income(opts.income),
    balanceSheet: balance(opts.balance),
    cashflow: cashflow(opts.cashflow),
    incomeStatementPeriodObservation: OBS(opts.income, opts.observed?.income ?? null),
    balanceSheetPeriodObservation: OBS(opts.balance, opts.observed?.balance ?? null),
    cashflowPeriodObservation: OBS(opts.cashflow, opts.observed?.cashflow ?? null),
  };
}

function assembleSpine(fin: ReturnType<typeof spineSet>) {
  const periodDisclosure = statementSetDisclosure(fin);
  const valuation = computeValuation({
    fundamentals,
    balanceSheet: fin.balanceSheet,
    incomeStatement: fin.incomeStatement,
    cashflow: fin.cashflow,
    periodsCoherent: periodDisclosure == null,
  });
  const spine = buildValuationSpine({
    ticker: "TEST",
    asOf: "2026-05-06",
    fundamentals,
    balanceSheet: fin.balanceSheet,
    incomeStatement: fin.incomeStatement,
    cashflow: fin.cashflow,
    sector: "Technology",
    quantComposites: { piotroskiF: 7, altmanZone: "safe" },
    factorRanks: { compositeFactorPercentile: 70 },
    technicals: { trend: "up", sma50: 200, sma200: 180 },
    valuation,
    periodDisclosure,
  });
  return { spine, valuation, periodDisclosure };
}

/**
 * What the portfolio-manager commit does with the spine: clamp only when the
 * envelope is present, and mark the rating unanchored when it was withheld for
 * a period mismatch. Mirrors `agents/portfolio-manager/writer.ts` so this suite
 * asserts on the PUBLISHED value rather than on the envelope.
 */
function publishRating(
  spine: ReturnType<typeof assembleSpine>["spine"],
  modelRating: "Sell" | "Underweight" | "Hold" | "Overweight" | "Buy",
) {
  const ratingUnanchored = spine.periodDisclosure != null;
  if (spine.envelope) {
    const clamped = clampRatingToBand(modelRating, spine.envelope, "");
    return { finalRating: clamped.final, ratingClamped: clamped.clamped, ratingUnanchored };
  }
  return { finalRating: modelRating, ratingClamped: false, ratingUnanchored };
}

// ---------------------------------------------------------------------------

describe("MATCHED periods — the cross-statement outputs are still produced", () => {
  // Without this arm, a gate that withholds EVERYTHING passes the mismatch arm.
  const { spine, valuation, periodDisclosure } = assembleSpine(
    spineSet({ income: ANCHOR, balance: ANCHOR, cashflow: ANCHOR }),
  );

  it("reports the set as coherent", () => {
    expect(periodDisclosure).toBeNull();
    expect(spine.periodDisclosure).toBeNull();
  });

  it("produces the expected return and everything downstream of it", () => {
    expect(spine.expectedReturn).not.toBeNull();
    expect(spine.fairValue).not.toBeNull();
    expect(spine.dcf).not.toBeNull();
    expect(spine.triangulation).not.toBeNull();
    expect(spine.setupScore).not.toBeNull();
    expect(spine.envelope).not.toBeNull();
  });

  it("produces the spanning multiples", () => {
    expect(valuation.evToSales.value).not.toBeNull();
    expect(valuation.evToEbit.value).not.toBeNull();
    expect(valuation.roic.value).not.toBeNull();
    expect(valuation.returnOnAssets.value).not.toBeNull();
    expect(valuation.netLeverage.value).not.toBeNull();
  });

  it("publishes a CLAMPED rating and does not mark it unanchored", () => {
    const published = publishRating(spine, "Buy");
    expect(published.finalRating).not.toBeNull();
    expect(published.ratingUnanchored).toBe(false);
  });
});

describe("MISMATCHED periods — outright disagreement", () => {
  // The balance sheet fell to the prior year while income and cashflow sit at
  // the anchor. Built on DISAGREEING values on purpose: were all three equal, a
  // broken filter would be indistinguishable from a working one.
  const { spine, valuation, periodDisclosure } = assembleSpine(
    spineSet({ income: ANCHOR, balance: OLDER, cashflow: ANCHOR }),
  );

  it("detects the set as incoherent and names which periods disagreed", () => {
    expect(periodDisclosure).toEqual({
      reason: "periods-disagree",
      income: ANCHOR,
      balance: OLDER,
      cashflow: ANCHOR,
    });
  });

  it("withholds the expected return and EVERYTHING downstream, envelope included", () => {
    expect(spine.expectedReturn).toBeNull();
    expect(spine.fairValue).toBeNull();
    expect(spine.dcf).toBeNull();
    expect(spine.triangulation).toBeNull();
    expect(spine.setupScore).toBeNull();
    expect(spine.envelope).toBeNull();
  });

  it("withholds the SPANNING multiples", () => {
    expect(valuation.evToSales.value).toBeNull();
    expect(valuation.evToEbit.value).toBeNull();
    expect(valuation.evToFcf.value).toBeNull();
    expect(valuation.roic.value).toBeNull();
    expect(valuation.returnOnAssets.value).toBeNull();
    expect(valuation.netLeverage.value).toBeNull();
  });

  it("does NOT blank the single-statement figures — withhold is not 'blank the spine'", () => {
    // Every one of these reads at most ONE of the three statements (plus the
    // market snapshot, which is not a fiscal period). A mismatch elsewhere is no
    // reason to drop them, and an implementation that does has over-corrected.
    expect(valuation.enterpriseValue.value).not.toBeNull();
    expect(valuation.netDebt.value).not.toBeNull();
    expect(valuation.priceToBook.value).not.toBeNull();
    expect(valuation.earningsYield.value).not.toBeNull();
    expect(valuation.fcfYield.value).not.toBeNull();
    expect(valuation.priceToFcf.value).not.toBeNull();
  });

  it("reports the evidence as THIN, so the exposure gate caps new positions", () => {
    // A spine that withheld its cross-statement outputs cannot report the
    // evidence behind them as sufficient — that is signal without substance.
    expect(spine.evidenceBasis).toBe("thin");
  });

  it("STILL PUBLISHES THE RATING, unclamped and marked unanchored", () => {
    // The assertion the whole suite exists for. Withholding the envelope removes
    // the BOUND, not the rating: the clamp sits inside a conditional on the
    // envelope's presence, so absence is fail-open. `Buy` is deliberately a
    // rating a present envelope would have clamped DOWN here.
    const published = publishRating(spine, "Buy");
    expect(published.finalRating).toBe("Buy");
    expect(published.ratingClamped).toBe(false);
    expect(published.ratingUnanchored).toBe(true);
  });

  it("the disclosure names both dates, so a reader can see WHICH years disagreed", () => {
    expect(spine.periodDisclosure?.income).toBe(ANCHOR);
    expect(spine.periodDisclosure?.balance).toBe(OLDER);
  });
});

describe("UNIFORM STALENESS — all three at the same older year, having seen a newer one", () => {
  // The three RETURNED periods agree perfectly, so "do the periods match" says
  // yes. This case fails on a part-(b)-only build, which is exactly why it is
  // here. The balance sheet's own resolution observed the anchor before settling
  // for the older complete payload.
  const { spine, periodDisclosure } = assembleSpine(
    spineSet({
      income: OLDER,
      balance: OLDER,
      cashflow: OLDER,
      observed: { balance: ANCHOR },
    }),
  );

  it("is REJECTED, and for the settled-for-less-than-seen reason", () => {
    expect(periodDisclosure?.reason).toBe("settled-for-less-than-seen");
  });

  it("withholds the cross-statement outputs and publishes the rating unanchored", () => {
    expect(spine.envelope).toBeNull();
    expect(spine.evidenceBasis).toBe("thin");
    expect(publishRating(spine, "Buy").ratingUnanchored).toBe(true);
  });

  it("DETECTION, not assembly — each statement still publishes at its own period", () => {
    // The desk does not make the anchor-year statement win; it detects and
    // withholds. A suite asserting the anchor-year partial won is testing a
    // follow-up this change does not make, and will fail against it.
    expect(spine.periodDisclosure?.income).toBe(OLDER);
    expect(spine.periodDisclosure?.balance).toBe(OLDER);
    expect(spine.periodDisclosure?.cashflow).toBe(OLDER);
  });
});

describe("NEVER FETCHED — the short-circuit case, accepted as the contract's limit", () => {
  // Same statement periods as uniform staleness, DIFFERENT ladder path: every
  // resolution returned a complete payload from the first provider, so the next
  // provider's newer annual period was never observed. Nothing was passed over.
  //
  // Asserted as PASSING and named as the documented limit — a later reader must
  // not "fix" this into an extra provider fetch per statement per run without
  // pricing it. Same data, opposite verdict from the case above: the pair is
  // what pins the contract.
  const { spine, valuation, periodDisclosure } = assembleSpine(
    spineSet({ income: OLDER, balance: OLDER, cashflow: OLDER }),
  );

  it("is ACCEPTED — nothing observed a newer period", () => {
    expect(periodDisclosure).toBeNull();
  });

  it("produces the cross-statement outputs normally", () => {
    expect(spine.envelope).not.toBeNull();
    expect(spine.expectedReturn).not.toBeNull();
    expect(valuation.evToEbit.value).not.toBeNull();
  });
});

describe("CROSS-PROVIDER, SAME FISCAL YEAR — the case a naive fix breaks", () => {
  // Income from the filings source (2025-09-27) paired with a balance sheet from
  // market data (2025-09-30). A check written as string equality passes the
  // mismatch cases above and BREAKS here, on a correct pairing — and a suite
  // that only tested mismatches would ship it.
  const { spine, valuation, periodDisclosure } = assembleSpine(
    spineSet({ income: ANCHOR, balance: ANCHOR_SKEWED, cashflow: ANCHOR }),
  );

  it("is accepted — the two date the same year days apart", () => {
    expect(periodDisclosure).toBeNull();
  });

  it("every cross-statement figure still computes", () => {
    expect(spine.envelope).not.toBeNull();
    expect(valuation.evToSales.value).not.toBeNull();
    expect(valuation.roic.value).not.toBeNull();
  });
});

describe("a prospectus-recovered statement paired with a filings one", () => {
  it("compares like any other provider when it sits at the same period", () => {
    const fin = spineSet({ income: ANCHOR, balance: ANCHOR, cashflow: ANCHOR });
    const recovered = { ...fin, incomeStatement: { ...fin.incomeStatement, source: "edgar-prospectus" as const } };
    expect(statementSetDisclosure(recovered)).toBeNull();
  });

  it("is detected when it sits at an older period", () => {
    const fin = spineSet({ income: OLDER, balance: ANCHOR, cashflow: ANCHOR });
    const recovered = { ...fin, incomeStatement: { ...fin.incomeStatement, source: "edgar-prospectus" as const } };
    expect(statementSetDisclosure(recovered)?.reason).toBe("periods-disagree");
  });
});

/**
 * A LEGACY RECORD: real figures, `periodEnd` null only because the row was
 * stored before the key existed (`.nullable().default(null)` re-parses it that
 * way). This is the population the guard exists for, and the shape a filter on
 * the period alone could not tell apart from the unavailable path.
 *
 * Every fixture here is built with FULL FIGURES on purpose. A fixture built
 * from unavailable statements passes with or without the fix and would certify
 * the bug.
 */
describe("LEGACY RECORDS — populated statements with no stated period", () => {
  describe("all three legacy", () => {
    const { spine, valuation, periodDisclosure } = assembleSpine(
      spineSet({ income: null, balance: null, cashflow: null }),
    );

    it("is REJECTED — it never established a shared period, so it cannot claim one", () => {
      // The pre-fix build returned `coherent: true` here: with no periods to
      // compare, the compatibility loop never executed at all.
      expect(periodDisclosure?.reason).toBe("period-unstated");
    });

    it("withholds the cross-statement outputs and the spanning multiples", () => {
      expect(spine.expectedReturn).toBeNull();
      expect(spine.envelope).toBeNull();
      expect(spine.evidenceBasis).toBe("thin");
      expect(valuation.evToSales.value).toBeNull();
      expect(valuation.roic.value).toBeNull();
    });

    it("keeps the single-statement figures — withhold is not 'blank the spine'", () => {
      expect(valuation.priceToBook.value).not.toBeNull();
      expect(valuation.earningsYield.value).not.toBeNull();
    });

    it("publishes the rating unanchored", () => {
      expect(publishRating(spine, "Buy").ratingUnanchored).toBe(true);
    });
  });

  describe("one legacy statement alongside two dated peers", () => {
    // The subtler half: the two dated peers AGREE, so the old filter compared
    // them, found them compatible, and declared the set coherent — while the
    // legacy statement (from any year at all) was fed into the cross-statement
    // valuations anyway.
    const { spine, valuation, periodDisclosure } = assembleSpine(
      spineSet({ income: ANCHOR, balance: null, cashflow: ANCHOR }),
    );

    it("is REJECTED even though the two dated statements agree", () => {
      expect(periodDisclosure?.reason).toBe("period-unstated");
    });

    it("withholds the spanning figures the legacy statement would have entered", () => {
      expect(spine.envelope).toBeNull();
      expect(valuation.roic.value).toBeNull();
      expect(valuation.netLeverage.value).toBeNull();
    });

    it("names the periods it did and did not have", () => {
      expect(spine.periodDisclosure?.income).toBe(ANCHOR);
      expect(spine.periodDisclosure?.balance).toBeNull();
    });
  });

  describe("a FIGURELESS statement alongside two dated peers", () => {
    // The control. Same missing period, no figures — genuinely unavailable, so
    // it makes no claim and the set is still coherent. Without this arm a fix
    // that simply withheld on every null period would pass everything above
    // while withholding on every ordinary data-outage run.
    const empty = {
      source: "unavailable" as const,
      ticker: "TEST",
      asOf: "2026-05-06",
      periodEnd: null,
      totalAssets: null,
      totalLiabilities: null,
      totalEquity: null,
      cashAndEquivalents: null,
      totalDebt: null,
      unit: "USD billions",
    };
    const fin = spineSet({ income: ANCHOR, balance: ANCHOR, cashflow: ANCHOR });

    it("is ACCEPTED — no figures, so no claim to disagree with", () => {
      const disclosure = statementSetDisclosure({
        ...fin,
        balanceSheet: empty,
        balanceSheetPeriodObservation: OBS(null, null),
      });
      expect(disclosure).toBeNull();
    });
  });

  describe("the analyst layer sees it too", () => {
    it("detects a legacy statement from the analyst's own payloads", () => {
      // The second valuation site computes BEFORE the spine exists, so a guard
      // that only reached the spine would leave the live memo combining a
      // legacy statement across periods.
      expect(
        analystStatementDisclosure({
          incomeStatement: income(ANCHOR),
          balanceSheet: balance(null),
          cashflow: cashflow(ANCHOR),
        })?.reason,
      ).toBe("period-unstated");
    });
  });

  describe("the disclosure a reader is shown", () => {
    it("says the period could NOT BE ESTABLISHED, and does not claim a disagreement", () => {
      // Printing "these do NOT describe the same fiscal period" here would be a
      // second false claim: the desk never compared two known periods.
      const text = formatPeriodMismatch({
        reason: "period-unstated",
        income: ANCHOR,
        balance: null,
        cashflow: ANCHOR,
      });
      expect(text).toContain("CANNOT ESTABLISH");
      expect(text).toContain("no period stated");
      expect(text).not.toContain("do NOT describe the same fiscal period");
    });

    it("still says DISAGREE on the outright-disagreement path", () => {
      const text = formatPeriodMismatch({
        reason: "periods-disagree",
        income: ANCHOR,
        balance: OLDER,
        cashflow: ANCHOR,
      });
      expect(text).toContain("do NOT describe the same fiscal period");
    });
  });
});

describe("only one statement present", () => {
  it("has no cross-statement figure to withhold, so it is not a period mismatch", () => {
    // The envelope is absent for the ORDINARY reason here. Attributing that to
    // a period mismatch would mark a data-poor run as unanchored, which is a
    // different and false claim.
    const fin = spineSet({ income: ANCHOR, balance: ANCHOR, cashflow: ANCHOR });
    expect(
      statementSetDisclosure({ ...fin, balanceSheet: undefined }),
    ).toBeNull();
  });
});

describe("the analyst layer — the SECOND valuation site", () => {
  // The fundamentals analyst computes and publishes its own valuation BEFORE
  // the spine exists, so every behaviour above has to hold on its payloads too.
  // A suite that checks only the spine passes while the live memo publishes
  // cross-period ratios.
  const mismatched = {
    incomeStatement: income(ANCHOR),
    balanceSheet: balance(OLDER),
    cashflow: cashflow(ANCHOR),
  };
  const matched = {
    incomeStatement: income(ANCHOR),
    balanceSheet: balance(ANCHOR),
    cashflow: cashflow(ANCHOR),
  };

  it("detects the mismatch from the analyst's own tool payloads", () => {
    expect(analystStatementDisclosure(mismatched)?.reason).toBe("periods-disagree");
    expect(analystStatementDisclosure(matched)).toBeNull();
  });

  it("omits the spanning figures from the analyst's valuation, and keeps the rest", () => {
    const v = computeValuation({
      fundamentals,
      ...mismatched,
      periodsCoherent: analystStatementDisclosure(mismatched) == null,
    });
    expect(v.evToSales.value).toBeNull();
    expect(v.roic.value).toBeNull();
    expect(v.priceToBook.value).not.toBeNull();
  });

  it("publishes them when the periods match", () => {
    const v = computeValuation({
      fundamentals,
      ...matched,
      periodsCoherent: analystStatementDisclosure(matched) == null,
    });
    expect(v.evToSales.value).not.toBeNull();
    expect(v.roic.value).not.toBeNull();
  });

  it("states the mismatch and the instruction IN THE CONTEXT — an ADVISORY claim", () => {
    // The assertion is about what the analyst was TOLD, never about what it
    // concluded. A test asserting "the memo contains no cross-period ratio"
    // would be a claim about a model's output: flaky when it fails and falsely
    // reassuring when it passes. The residual is real — a memo can still carry
    // a figure the spine withheld, and nothing here rules that out.
    const block = formatPeriodMismatch(analystStatementDisclosure(mismatched));
    expect(block).toContain("do NOT describe the same fiscal period");
    expect(block).toContain(ANCHOR);
    expect(block).toContain(OLDER);
    expect(block).toMatch(/Do NOT compute any ratio/);
  });

  it("says nothing at all when the periods match", () => {
    expect(formatPeriodMismatch(analystStatementDisclosure(matched))).toBe("");
  });
});

describe("BP-030 — a stored record written before the period field", () => {
  it("parses with the key ABSENT, not merely with an explicit null", () => {
    // The value fields are nullable but NOT optional, so a stored record that
    // predates a new key fails to parse while an explicit `null` succeeds. The
    // shape that matters is the MISSING key — testing the null one proves
    // nothing about a real legacy record.
    const legacy = {
      source: "edgar",
      ticker: "TEST",
      asOf: "2025-09-27",
      revenue: 416.161,
      grossProfit: 195.201,
      operatingIncome: 133.05,
      netIncome: 112.01,
      yoyRevenueGrowth: 0.064,
      unit: "USD billions",
      // no `periodEnd` key at all
    };
    const parsed = incomeStatementSchema.parse(legacy);
    expect(parsed.periodEnd).toBeNull();
    expect(parsed.revenue).toBe(416.161);
  });
});
