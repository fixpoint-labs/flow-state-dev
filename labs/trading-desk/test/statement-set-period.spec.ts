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
import {
  buildValuationSpine,
  disclosureHasUnknownPeriod,
  disclosurePrintShape,
  formatValuationSpine,
  periodDisclosureSchema,
} from "@/flows/analysis/lib/valuation-spine";
import { valuationSpineStateSchema } from "@/flows/analysis/valuation-spine-resource";
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
const OLDEST = "2023-09-29";

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

describe("disclosurePrintShape — the ONE classifier both renderers read (review round 4)", () => {
  // Direct, hand-built-literal tests are the right tool HERE, unlike for the
  // renderers above: the classifier's whole job is to interpret whatever
  // fields it is given, so testing it with literals is testing the real
  // thing, not a copy of it.
  it("period-unstated -> 'unstated'", () => {
    expect(
      disclosurePrintShape({ reason: "period-unstated", income: ANCHOR, balance: null, cashflow: ANCHOR }),
    ).toBe("unstated");
  });

  it("periods-disagree -> 'disagree'", () => {
    expect(
      disclosurePrintShape({ reason: "periods-disagree", income: ANCHOR, balance: OLDER, cashflow: ANCHOR }),
    ).toBe("disagree");
  });

  it("settled-for-less-than-seen with agreeing printed periods -> 'uniform-stale'", () => {
    expect(
      disclosurePrintShape({
        reason: "settled-for-less-than-seen",
        income: OLDER,
        balance: OLDER,
        cashflow: OLDER,
        observedNewest: ANCHOR,
      }),
    ).toBe("uniform-stale");
  });

  it("settled-for-less-than-seen with NON-agreeing printed periods -> 'divergent-stale'", () => {
    expect(
      disclosurePrintShape({
        reason: "settled-for-less-than-seen",
        income: OLDER,
        balance: ANCHOR,
        cashflow: ANCHOR,
        observedNewest: ANCHOR,
      }),
    ).toBe("divergent-stale");
  });

  it("settled-for-less-than-seen with an intransitive triple -> 'divergent-stale' (the a-c / b-c mutation coverage, at the classifier)", () => {
    // Same shape as `periodsMutuallyAgree`'s own mutation-killing tests
    // (`financial-period.spec.ts`), asserted here because THIS is the
    // function every renderer actually calls.
    expect(
      disclosurePrintShape({
        reason: "settled-for-less-than-seen",
        income: "2025-09-01",
        balance: "2025-09-27",
        cashflow: "2025-10-20",
        observedNewest: "2026-01-15",
      }),
    ).toBe("divergent-stale");
  });

  it("settled-for-less-than-seen with three null printed periods -> 'divergent-stale' (null does not agree with null)", () => {
    expect(
      disclosurePrintShape({
        reason: "settled-for-less-than-seen",
        income: null,
        balance: null,
        cashflow: null,
        observedNewest: ANCHOR,
      }),
    ).toBe("divergent-stale");
  });
});

describe("disclosureHasUnknownPeriod", () => {
  it("is true when any printed period is null", () => {
    expect(
      disclosureHasUnknownPeriod({ reason: "periods-disagree", income: ANCHOR, balance: null, cashflow: ANCHOR }),
    ).toBe(true);
  });

  it("is false when all three printed periods are real", () => {
    expect(
      disclosureHasUnknownPeriod({ reason: "periods-disagree", income: ANCHOR, balance: OLDER, cashflow: ANCHOR }),
    ).toBe(false);
  });
});

describe("periodDisclosure persistence — anyUndatedWithFigures survives the round trip (review round 5)", () => {
  // `anyUndatedWithFigures` shipped one commit after `observedNewest`, and
  // repeated the exact defect `observedNewest` was added to fix: a field on
  // `PeriodDisclosure` (`valuation-spine.ts`) with no matching key in any of
  // the three PERSISTED schemas. Non-strict zod silently strips an unknown
  // key on `.parse()` — nothing throws, the field is just gone after the
  // first save/reload, and the `periods-disagree` hedge it drives is gone
  // with it.
  it("the shared schema itself preserves the field on a real disclosure", () => {
    const disclosure = statementSetDisclosure(spineSet({ income: ANCHOR, balance: OLDER, cashflow: null }));
    expect(disclosure?.reason).toBe("periods-disagree");
    expect(disclosure?.anyUndatedWithFigures).toBe(true);

    const parsed = periodDisclosureSchema.parse(disclosure);
    expect(parsed.anyUndatedWithFigures).toBe(true);
  });

  it("defaults to false on a record persisted before the field existed", () => {
    // No `anyUndatedWithFigures` key at all — the shape every session
    // persisted before this field existed actually has.
    const legacy = { reason: "periods-disagree", income: ANCHOR, balance: OLDER, cashflow: ANCHOR };
    expect(periodDisclosureSchema.parse(legacy).anyUndatedWithFigures).toBe(false);
  });

  it("round-trips through the valuation-spine RESOURCE schema, not just the shared inner one", () => {
    const fin = spineSet({ income: ANCHOR, balance: OLDER, cashflow: null });
    const { spine } = assembleSpine(fin);
    expect(spine.periodDisclosure?.anyUndatedWithFigures).toBe(true);

    const parsed = valuationSpineStateSchema.parse(spine);
    expect(parsed.periodDisclosure?.anyUndatedWithFigures).toBe(true);
  });
});

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

describe("UNIFORM STALENESS reaches the analyst site too (FIX-1113 P1)", () => {
  // The bug. Same shape as the spine's own UNIFORM STALENESS arm above: the
  // three RETURNED periods all agree at OLDER — so "do the periods match"
  // says yes — but the balance sheet's own resolution SAW the newer ANCHOR
  // period before settling for OLDER, the shape the ladder produces when an
  // older COMPLETE payload beats a newer PARTIAL one. The spine's guard
  // withholds this (part (a)); the analyst site is the SECOND valuation site
  // and must withhold it too, from the SAME observations, threaded through
  // `analystStatementDisclosure`'s second argument the way the fundamentals
  // generator's context slot now does via `ctx.resources.financialsData`.
  const payloads = {
    incomeStatement: income(OLDER),
    balanceSheet: balance(OLDER),
    cashflow: cashflow(OLDER),
  };
  const observations = {
    incomeStatement: OBS(OLDER),
    balanceSheet: OBS(OLDER, ANCHOR),
    cashflow: OBS(OLDER),
  };

  it("is REJECTED for settled-for-less-than-seen, not silently read as a matched set", () => {
    const disclosure = analystStatementDisclosure(payloads, observations);
    expect(disclosure).not.toBeNull();
    expect(disclosure?.reason).toBe("settled-for-less-than-seen");
  });

  it("marks the analyst's own valuation as not period-coherent, withholding the spanning multiples it would otherwise publish", () => {
    const disclosure = analystStatementDisclosure(payloads, observations);
    const v = computeValuation({
      fundamentals,
      ...payloads,
      periodsCoherent: disclosure == null,
    });
    expect(v.evToSales.value).toBeNull();
    expect(v.roic.value).toBeNull();
    // Single-statement figures are untouched — this is withholding, not
    // blanking the analyst's whole valuation.
    expect(v.priceToBook.value).not.toBeNull();
  });

  it("carries a non-empty periodMismatch block, naming the period the desk saw and settled past", () => {
    const block = formatPeriodMismatch(analystStatementDisclosure(payloads, observations));
    expect(block).not.toBe("");
    expect(block).toContain(ANCHOR);
  });
});

describe("the settled-for-less-than-seen lead — states staleness, not disagreement", () => {
  it("does not claim the periods differ, and names the newer observed period", () => {
    const text = formatPeriodMismatch({
      reason: "settled-for-less-than-seen",
      income: OLDER,
      balance: OLDER,
      cashflow: OLDER,
      observedNewest: ANCHOR,
    });
    // The false statement this guards against: three IDENTICAL periods
    // printed under a claim that they differ.
    expect(text).not.toContain("do NOT describe the same fiscal period");
    expect(text).toContain(ANCHOR);
  });

  it("does NOT carry the mix-fiscal-periods justification — the three periods are not mixed here", () => {
    // The lead is only half the block. On this reason the three statements
    // agree on ONE period, so "it would mix fiscal periods" is false here even
    // though it is true on the other two reasons — the same class of defect the
    // lead sentence fixed, one level down in the same block.
    const text = formatPeriodMismatch({
      reason: "settled-for-less-than-seen",
      income: OLDER,
      balance: OLDER,
      cashflow: OLDER,
      observedNewest: ANCHOR,
    });
    expect(text).not.toContain("it would mix fiscal periods");
    expect(text).not.toContain("Figures WITHIN a");
    // Still withholds — the instruction not to compute the cross-statement
    // ratio survives, only the "because" changes.
    expect(text).toMatch(/Do NOT compute any ratio/);
  });
});

describe("periods-disagree — the mix-fiscal-periods justification is unchanged", () => {
  // The control this fix needs: a rewrite that flattened every reason's
  // justification into one message would pass the arms above and fail here.
  // `periods-disagree` is the one reason where "it would mix fiscal periods"
  // is a CONFIRMED fact — part (b) only returns it when two non-null, present
  // periods genuinely fail `samePeriod` — so this stays unconditional.
  it("still carries the original justification", () => {
    const text = formatPeriodMismatch({
      reason: "periods-disagree",
      income: ANCHOR,
      balance: OLDER,
      cashflow: ANCHOR,
    });
    expect(text).toContain("it would mix fiscal periods");
    expect(text).toContain("Figures WITHIN a");
  });

  it("derived from the real predicate, not a hand-built literal", () => {
    const fin = spineSet({ income: ANCHOR, balance: OLDER, cashflow: ANCHOR });
    const disclosure = statementSetDisclosure(fin);
    expect(disclosure?.reason).toBe("periods-disagree");
    const text = formatPeriodMismatch(disclosure);
    expect(text).toContain("it would mix fiscal periods");
    expect(text).toContain("Figures WITHIN a");
  });
});

describe("period-unstated — the justification is HEDGED, not asserted as fact (P2)", () => {
  // The lead already says the desk CANNOT ESTABLISH whether these share a
  // period. The justification asserting "it would mix fiscal periods" one
  // line later is the same class of defect as the settled-for-less-than-seen
  // lead: a claim of KNOWN fact where the desk only has a possibility. The
  // withholding instruction itself stays — the desk really does withhold
  // here — only the "because" is hedged.
  it("does not assert mixing as fact; states it as a possibility instead", () => {
    const fin = spineSet({ income: ANCHOR, balance: null, cashflow: ANCHOR });
    const disclosure = statementSetDisclosure(fin);
    expect(disclosure?.reason).toBe("period-unstated");
    const text = formatPeriodMismatch(disclosure);
    expect(text).not.toContain("it would mix fiscal periods");
    expect(text).toContain("COULD combine two different fiscal periods");
    // Still withholds — only the "because" changed.
    expect(text).toMatch(/Do NOT compute any ratio/);
  });
});

describe("settled-for-less-than-seen — state enumeration (review round 2, P1)", () => {
  // `isCoherentStatementSet` returns this reason on the FIRST statement whose
  // own resolution settled for less than it saw (part a) — BEFORE it ever
  // checks whether the three RETURNED periods agree with each other (part b).
  // So the reason covers two different printed shapes, and every test below
  // is built through the REAL `statementSetDisclosure`, not a hand-assembled
  // `PeriodDisclosure` — a hand-built literal is exactly what let the P1 ship
  // green last round.
  //
  // BUCKET A — the three returned periods genuinely agree (uniform
  // staleness). BUCKET B — they do not: the offending statement diverges from
  // agreeing peers, all three mutually disagree, or the offending statement's
  // own returned period is `null`. Every enumerated state below lands in
  // exactly one of these two buckets; the block's text must be true for
  // whichever bucket produced it.

  it("bucket A — uniform staleness: all three agree, derived from the real predicate", () => {
    const fin = spineSet({
      income: OLDER,
      balance: OLDER,
      cashflow: OLDER,
      observed: { balance: ANCHOR },
    });
    const disclosure = statementSetDisclosure(fin);
    expect(disclosure?.reason).toBe("settled-for-less-than-seen");
    expect(disclosure?.observedNewest).toBe(ANCHOR);
    const text = formatPeriodMismatch(disclosure);
    expect(text).toContain("agree on a fiscal period");
    expect(text).not.toContain("NOT confirmed to all describe");
    expect(text).toContain(ANCHOR);
  });

  it("bucket B — the offending statement diverges from two AGREEING peers (the reported P1)", () => {
    // Income's ladder saw the anchor and settled for the prior year; balance
    // and cashflow both resolve cleanly at the anchor. The three returned
    // periods do NOT all agree, and this IS the `periods-disagree` shape by
    // value — reached through the settled-for-less-than-seen reason instead,
    // because part (a) returns before part (b) ever runs.
    const fin = spineSet({
      income: OLDER,
      balance: ANCHOR,
      cashflow: ANCHOR,
      observed: { income: ANCHOR },
    });
    const disclosure = statementSetDisclosure(fin);
    expect(disclosure).toEqual({
      reason: "settled-for-less-than-seen",
      income: OLDER,
      balance: ANCHOR,
      cashflow: ANCHOR,
      observedNewest: ANCHOR,
    });
    const text = formatPeriodMismatch(disclosure);
    // The defect: claiming agreement, or "STALE period" for every figure,
    // over periods that visibly differ two lines below.
    expect(text).not.toContain("agree on a fiscal period");
    expect(text).not.toContain("every one of them is drawn from the STALE period");
    // And not the periods-disagree phrasing either — this reason renders its
    // own true sentence, not a borrowed one that happens to also be true.
    expect(text).not.toContain("do NOT describe the same fiscal period");
    expect(text).not.toContain("it would mix fiscal periods");
    // What must be true instead — hedged, and it names the observed period.
    expect(text).toContain("NOT confirmed to all describe one shared fiscal period");
    expect(text).toContain(ANCHOR);
    expect(text).toContain(`  income statement: ${OLDER}`);
    expect(text).toContain(`  balance sheet:    ${ANCHOR}`);
    expect(text).toContain(`  cash flow:        ${ANCHOR}`);
    // No statement here returned nothing — every printed period is real, so
    // this IS genuine staleness, and the text says so (review round 3, item 2).
    expect(text).toContain("is STALE");
    expect(text).not.toContain("MISSING");
  });

  it("bucket B — all three mutually disagree", () => {
    const fin = spineSet({
      income: OLDEST,
      balance: OLDER,
      cashflow: ANCHOR,
      observed: { income: ANCHOR },
    });
    const disclosure = statementSetDisclosure(fin);
    expect(disclosure?.reason).toBe("settled-for-less-than-seen");
    const text = formatPeriodMismatch(disclosure);
    expect(text).not.toContain("agree on a fiscal period");
    expect(text).toContain("NOT confirmed to all describe one shared fiscal period");
  });

  it("bucket B — the offending statement's own returned period is null", () => {
    // The final settled payload for income carries no `periodEnd` (a
    // legacy-shaped outcome) even though its own resolution observed a real
    // period along the way. Balance and cashflow resolve cleanly and agree
    // with each other — but not all three are confirmed to share a period.
    const fin = spineSet({
      income: null,
      balance: ANCHOR,
      cashflow: ANCHOR,
      observed: { income: ANCHOR },
    });
    const disclosure = statementSetDisclosure(fin);
    expect(disclosure?.reason).toBe("settled-for-less-than-seen");
    const text = formatPeriodMismatch(disclosure);
    expect(text).not.toContain("agree on a fiscal period");
    expect(text).toContain("NOT confirmed to all describe one shared fiscal period");
    expect(text).toContain("income statement: no period stated");
    // A statement that returned NOTHING is not the same claim as one that
    // returned a real but older figure (review round 3, item 2) — this text
    // must not call an absent statement "STALE".
    expect(text).toContain("MISSING");
    expect(text).not.toContain("is STALE");
  });

  it("observedNewest is present on this reason and absent on the other two — derived from the real function", () => {
    const stale = spineSet({
      income: OLDER,
      balance: OLDER,
      cashflow: OLDER,
      observed: { balance: ANCHOR },
    });
    expect(statementSetDisclosure(stale)).toHaveProperty("observedNewest", ANCHOR);

    const disagreeing = spineSet({ income: ANCHOR, balance: OLDER, cashflow: ANCHOR });
    const disagreeDisclosure = statementSetDisclosure(disagreeing);
    expect(disagreeDisclosure?.reason).toBe("periods-disagree");
    expect(disagreeDisclosure).not.toHaveProperty("observedNewest");

    const unstated = spineSet({ income: ANCHOR, balance: null, cashflow: ANCHOR });
    const unstatedDisclosure = statementSetDisclosure(unstated);
    expect(unstatedDisclosure?.reason).toBe("period-unstated");
    expect(unstatedDisclosure).not.toHaveProperty("observedNewest");
  });
});

describe("settled-for-less-than-seen — end-to-end coverage for periodsMutuallyAgree (review round 3, item 1)", () => {
  // Every bucket-B fixture above used a FIRST pair that already fails
  // `samePeriod`, so pairs two and three were never exercised — the
  // enumeration was over PRINTED SHAPES, never over WHICH PAIR fails. These
  // three reproduce the surviving mutations end-to-end, through the real
  // `statementSetDisclosure` / `formatPeriodMismatch` pipeline, not just the
  // unit-level `periodsMutuallyAgree` (see `financial-period.spec.ts` for
  // those).
  it("an intransitive triple where only the a–c pair fails (49 days apart) does not render 'agree'", () => {
    // a-b: 26 days (agree). b-c: 23 days (agree). a-c: 49 days (NOT agree).
    // Dropping the a-c check would make this render "the three... agree".
    const fin = spineSet({
      income: "2025-09-01",
      balance: "2025-09-27",
      cashflow: "2025-10-20",
      observed: { income: "2026-01-15" },
    });
    const disclosure = statementSetDisclosure(fin);
    expect(disclosure?.reason).toBe("settled-for-less-than-seen");
    const text = formatPeriodMismatch(disclosure);
    expect(text).not.toContain("agree on a fiscal period");
    expect(text).toContain("NOT confirmed to all describe one shared fiscal period");
  });

  it("an intransitive triple where only the b–c pair fails does not render 'agree'", () => {
    // a-b: 14 days (agree). a-c: 25 days (agree). b-c: 39 days (NOT agree).
    // Dropping the b-c check would make this render "the three... agree".
    const fin = spineSet({
      income: "2025-09-15",
      balance: "2025-09-01",
      cashflow: "2025-10-10",
      observed: { income: "2026-01-01" },
    });
    const disclosure = statementSetDisclosure(fin);
    expect(disclosure?.reason).toBe("settled-for-less-than-seen");
    const text = formatPeriodMismatch(disclosure);
    expect(text).not.toContain("agree on a fiscal period");
    expect(text).toContain("NOT confirmed to all describe one shared fiscal period");
  });

  it("three null printed periods does not render 'agree' — null must not agree with null", () => {
    // If `periodsMutuallyAgree` (or the `samePeriod` it calls) ever treated
    // `null` as agreeing with `null`, this would render "the three... agree
    // on a fiscal period" over three "no period stated" lines.
    const fin = spineSet({
      income: null,
      balance: null,
      cashflow: null,
      observed: { income: ANCHOR },
    });
    const disclosure = statementSetDisclosure(fin);
    expect(disclosure?.reason).toBe("settled-for-less-than-seen");
    const text = formatPeriodMismatch(disclosure);
    expect(text).not.toContain("agree on a fiscal period");
    expect(text).toContain("NOT confirmed to all describe one shared fiscal period");
  });
});

describe("settled-for-less-than-seen — ABSENT is not STALE (review round 3, item 2)", () => {
  // `statement-recovery.ts`'s `bestPartial() ?? empty()` path: a statement
  // whose providers all came back critically sparse settles on the EMPTY
  // payload after `observe()` already recorded a real period along the way.
  // That statement returned NOTHING — it is MISSING, not merely outdated —
  // and the withholding is right even though "stale" is the wrong word for it.
  it("a genuinely figureless statement that observed a real period renders MISSING, not STALE", () => {
    const absentBalance = {
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
    const fin = {
      incomeStatement: income(ANCHOR),
      balanceSheet: absentBalance,
      cashflow: cashflow(ANCHOR),
      incomeStatementPeriodObservation: OBS(ANCHOR, null),
      // Observed the anchor while resolving, but settled on the empty payload.
      balanceSheetPeriodObservation: OBS(null, ANCHOR),
      cashflowPeriodObservation: OBS(ANCHOR, null),
    };
    const disclosure = statementSetDisclosure(fin);
    expect(disclosure?.reason).toBe("settled-for-less-than-seen");
    expect(disclosure?.balance).toBeNull();
    const text = formatPeriodMismatch(disclosure);
    expect(text).toContain("MISSING");
    expect(text).not.toContain("is STALE");
    expect(text).toContain("balance sheet:    no period stated");

    // The withholding itself is unaffected — only the reason's WORDING changed.
    const v = computeValuation({
      fundamentals,
      balanceSheet: fin.balanceSheet,
      incomeStatement: fin.incomeStatement,
      cashflow: fin.cashflow,
      periodsCoherent: disclosure == null,
    });
    expect(v.evToSales.value).toBeNull();
  });

  it("formatValuationSpine's WITHHELD line renders the same MISSING distinction", () => {
    const absentBalance = {
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
    const fin = {
      incomeStatement: income(ANCHOR),
      balanceSheet: absentBalance,
      cashflow: cashflow(ANCHOR),
      incomeStatementPeriodObservation: OBS(ANCHOR, null),
      balanceSheetPeriodObservation: OBS(null, ANCHOR),
      cashflowPeriodObservation: OBS(ANCHOR, null),
    };
    const { spine } = assembleSpine(fin as unknown as ReturnType<typeof spineSet>);
    const text = formatValuationSpine(spine);
    expect(text).toContain("MISSING");
    expect(text).not.toContain("is STALE");
  });
});

describe("periods-disagree — hedged when a THIRD statement is undated-with-figures (review round 3, item 3)", () => {
  // `isCoherentStatementSet` returns `periods-disagree` ahead of
  // `period-unstated` because the clash is the more specific finding — but a
  // third, undated-but-figured statement riding along is a real, independent
  // risk. The un-hedged "it would mix fiscal periods" is a claim of KNOWN
  // disagreement, and it is only known for the TWO that actually clashed.
  it("hedges the ratio warning for the undated third statement, keeps the clash confirmed for the other two", () => {
    // income vs balance is a CONFIRMED clash. cashflow carries real figures
    // (the `cashflow()` fixture always does) but no period at all.
    const fin = spineSet({ income: ANCHOR, balance: OLDER, cashflow: null });
    const disclosure = statementSetDisclosure(fin);
    expect(disclosure?.reason).toBe("periods-disagree");
    expect(disclosure).toHaveProperty("anyUndatedWithFigures", true);

    const text = formatPeriodMismatch(disclosure);
    expect(text).toContain("CONFIRMED to describe");
    expect(text).toContain("COULD combine");
    expect(text).not.toContain("it would mix fiscal periods");
    expect(text).toMatch(/Do NOT compute any ratio/);
  });

  it("formatValuationSpine's WITHHELD line is hedged the same way", () => {
    const fin = spineSet({ income: ANCHOR, balance: OLDER, cashflow: null });
    const { spine } = assembleSpine(fin);
    const text = formatValuationSpine(spine);
    expect(text).toContain("CONFIRMED to describe different");
    expect(text).toContain("COULD ALSO combine");
    expect(text).not.toContain("could not establish a single fiscal period");
  });

  it("control — no undated third statement keeps the un-hedged wording (pinned again, end-to-end)", () => {
    const fin = spineSet({ income: ANCHOR, balance: OLDER, cashflow: ANCHOR });
    const disclosure = statementSetDisclosure(fin);
    expect(disclosure?.reason).toBe("periods-disagree");
    expect(disclosure).not.toHaveProperty("anyUndatedWithFigures");
    const text = formatPeriodMismatch(disclosure);
    expect(text).toContain("it would mix fiscal periods");
  });
});

describe("settled-for-less-than-seen — observedNewest reports the FRONTIER (review round 3, item 4)", () => {
  it("reports the max observed period across every offending statement, not the first one in iteration order, end-to-end", () => {
    const fin = {
      incomeStatement: income(OLDEST),
      balanceSheet: balance(OLDEST),
      cashflow: cashflow(OLDEST),
      // Triggers first, in iteration order — but its own observed period is
      // the SMALLER of the two.
      incomeStatementPeriodObservation: OBS(OLDEST, OLDER),
      balanceSheetPeriodObservation: OBS(OLDEST, null),
      // Triggers too, and its observed period is the TRUE frontier.
      cashflowPeriodObservation: OBS(OLDEST, ANCHOR),
    };
    const disclosure = statementSetDisclosure(fin);
    expect(disclosure?.reason).toBe("settled-for-less-than-seen");
    expect(disclosure?.observedNewest).toBe(ANCHOR);
    expect(disclosure?.observedNewest).not.toBe(OLDER);
  });
});

describe("settled-for-less-than-seen — the direction invariant holds end-to-end (review round 3, item 5)", () => {
  it("a reversed 'observation' (older than what was returned) does not withhold anything", () => {
    // If `observedNewest` were ever genuinely OLDER than `returned` — which
    // should never happen upstream, but nothing here enforced it — the
    // desk must not print "saw a more recent one" over a period that is
    // actually older. The whole set stays coherent instead.
    const fin = {
      incomeStatement: income(ANCHOR),
      balanceSheet: balance(ANCHOR),
      cashflow: cashflow(ANCHOR),
      incomeStatementPeriodObservation: OBS(ANCHOR, OLDER),
      balanceSheetPeriodObservation: OBS(ANCHOR, null),
      cashflowPeriodObservation: OBS(ANCHOR, null),
    };
    expect(statementSetDisclosure(fin)).toBeNull();
  });
});

describe("formatValuationSpine's WITHHELD sentence — the same invariant, the PM-facing block", () => {
  // `valuation-spine.ts` has its own reason-blind WITHHELD sentence, fixed
  // over the same enumeration and the same `periodsMutuallyAgree` check —
  // see `withheldReasonLine`. Built through the real `assembleSpine` /
  // `buildValuationSpine` pipeline, not a hand-built `ValuationSpine`.
  it("bucket A — uniform staleness renders the agreement framing", () => {
    const fin = spineSet({
      income: OLDER,
      balance: OLDER,
      cashflow: OLDER,
      observed: { balance: ANCHOR },
    });
    const { spine } = assembleSpine(fin);
    const text = formatValuationSpine(spine);
    expect(text).toContain("agree on a fiscal period");
    expect(text).not.toContain("NOT confirmed");
    expect(text).toContain(ANCHOR);
  });

  it("bucket B — a stale statement diverging from agreeing peers does NOT render the agreement framing", () => {
    const fin = spineSet({
      income: OLDER,
      balance: ANCHOR,
      cashflow: ANCHOR,
      observed: { income: ANCHOR },
    });
    const { spine } = assembleSpine(fin);
    const text = formatValuationSpine(spine);
    expect(text).not.toContain("agree on a fiscal period");
    expect(text).not.toContain("rather than computed across periods");
    expect(text).toContain("NOT confirmed");
    expect(text).toContain(ANCHOR);
    expect(text).toContain("is STALE");
  });

  it("periods-disagree keeps its original wording", () => {
    const fin = spineSet({ income: ANCHOR, balance: OLDER, cashflow: ANCHOR });
    const { spine } = assembleSpine(fin);
    const text = formatValuationSpine(spine);
    expect(text).toContain("could not establish a single fiscal period");
    expect(text).toContain("rather than computed across periods");
  });

  it("period-unstated is hedged, not asserted as fact", () => {
    const fin = spineSet({ income: ANCHOR, balance: null, cashflow: ANCHOR });
    const { spine } = assembleSpine(fin);
    const text = formatValuationSpine(spine);
    expect(text).toContain("CANNOT ESTABLISH");
    expect(text).not.toContain("could not establish a single fiscal period");
    expect(text).toContain("could silently combine two different fiscal periods");
  });
});

describe("control arms — the analyst site does not simply withhold more", () => {
  // These pin the INVERSE of the bug: a fix that made the analyst withhold
  // unconditionally would pass the arm above and fail every test here.
  const matched = {
    incomeStatement: income(ANCHOR),
    balanceSheet: balance(ANCHOR),
    cashflow: cashflow(ANCHOR),
  };
  const matchedObservations = {
    incomeStatement: OBS(ANCHOR),
    balanceSheet: OBS(ANCHOR),
    cashflow: OBS(ANCHOR),
  };
  const mismatched = {
    incomeStatement: income(ANCHOR),
    balanceSheet: balance(OLDER),
    cashflow: cashflow(ANCHOR),
  };
  const mismatchedObservations = {
    incomeStatement: OBS(ANCHOR),
    balanceSheet: OBS(OLDER),
    cashflow: OBS(ANCHOR),
  };

  it("a genuinely coherent set still publishes with no warning, observations included", () => {
    const disclosure = analystStatementDisclosure(matched, matchedObservations);
    expect(disclosure).toBeNull();
    expect(formatPeriodMismatch(disclosure)).toBe("");
  });

  it("outright disagreement is still periods-disagree, with its own lead — not the new stale-set one", () => {
    const disclosure = analystStatementDisclosure(mismatched, mismatchedObservations);
    expect(disclosure?.reason).toBe("periods-disagree");
    expect(formatPeriodMismatch(disclosure)).toContain(
      "do NOT describe the same fiscal period",
    );
  });

  it("a missing/undefined observation degrades to exactly today's behaviour", () => {
    // Fixture mode never runs the live ladder, so the second argument is
    // simply omitted — the same call shape as before this fix.
    expect(analystStatementDisclosure(matched)).toBeNull();
    expect(analystStatementDisclosure(mismatched)?.reason).toBe("periods-disagree");
  });

  it("a figureless statement is still skipped, observations or not", () => {
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
    const payloads = { ...matched, balanceSheet: empty };
    const observations = { ...matchedObservations, balanceSheet: OBS(null) };
    expect(analystStatementDisclosure(payloads, observations)).toBeNull();
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
