/**
 * The period-selection leaf (FIX-1113) — anchor choice, period equivalence,
 * adjacency, and the statement-set detection predicate.
 *
 * Every equivalence/adjacency case is asserted in BOTH directions, because both
 * naive implementations fail in exactly one of them: calendar-year equality
 * passes the same-year case and drops a 52/53-week filer crossing January, while
 * a loose elapsed-time window passes that and readmits the two-year-change bug.
 * A suite testing one direction ships whichever half it did not test.
 */
import { describe, it, expect } from "vitest";
import {
  areConsecutive,
  chooseAnchorPeriodEnd,
  consecutivePeriodPair,
  isCoherentStatementSet,
  periodsMutuallyAgree,
  samePeriod,
} from "@/lib/providers/financial-period";

describe("chooseAnchorPeriodEnd", () => {
  it("takes the most recent candidate", () => {
    expect(
      chooseAnchorPeriodEnd(["2023-09-30", "2025-09-27", "2024-09-28"]),
    ).toBe("2025-09-27");
  });

  it("does NOT require the core set to be complete — one figure makes a period real", () => {
    // The anchor-year has exactly one contributing figure; the older year has
    // every one of them. Anchoring to completeness would walk the report back a
    // year, which is the abstains-by-construction trap decision 1 rejects.
    const complete = ["2024-09-28", "2024-09-28", "2024-09-28", "2024-09-28"];
    expect(chooseAnchorPeriodEnd([...complete, "2025-09-27"])).toBe("2025-09-27");
  });

  it("is null when there are no candidates, and skips unparseable ones", () => {
    expect(chooseAnchorPeriodEnd([])).toBeNull();
    expect(chooseAnchorPeriodEnd(["", "not-a-date"])).toBeNull();
    expect(chooseAnchorPeriodEnd(["not-a-date", "2025-09-27"])).toBe("2025-09-27");
  });
});

describe("samePeriod — a bounded distance, NOT a shared calendar year", () => {
  it("accepts the real cross-provider skew for one fiscal year", () => {
    // The filings source and the market-data source date the SAME fiscal year
    // three days apart. String equality rejects this and would withhold on
    // nearly every correct pairing.
    expect(samePeriod("2025-09-27", "2025-09-30")).toBe(true);
  });

  it("accepts a 52/53-week year-end that crosses the January boundary", () => {
    // `getFullYear()` equality FAILS here: 2025 vs 2026, six days apart.
    expect(samePeriod("2025-12-28", "2026-01-03")).toBe(true);
  });

  it("rejects two ends far apart INSIDE one calendar year", () => {
    // `getFullYear()` equality PASSES here — eleven months apart, both 2025.
    // This is the same trap with the sign flipped.
    expect(samePeriod("2025-01-31", "2025-12-31")).toBe(false);
  });

  it("rejects two adjacent fiscal years", () => {
    expect(samePeriod("2024-09-28", "2025-09-27")).toBe(false);
  });

  it("treats a missing period as matching nothing — including another missing one", () => {
    // "Both unknown" is not evidence of agreement. If this returned true, two
    // statements that each failed to state a period would read as coherent.
    expect(samePeriod(null, null)).toBe(false);
    expect(samePeriod("2025-09-27", null)).toBe(false);
    expect(samePeriod("", "")).toBe(false);
  });
});

describe("areConsecutive — one reporting interval, NOT a calendar-year delta", () => {
  it("accepts a 52-week pair whose ends straddle December into January", () => {
    // Calendar arithmetic on the year labels reads 2024→2025 = 1 and passes by
    // coincidence; the ends are 364 days apart, which is the real test.
    expect(areConsecutive("2024-12-28", "2025-12-27")).toBe(true);
  });

  it("accepts an ordinary 365/366-day pair", () => {
    expect(areConsecutive("2024-09-28", "2025-09-27")).toBe(true);
    expect(areConsecutive("2023-12-31", "2024-12-31")).toBe(true);
  });

  it("REJECTS a two-interval gap however the labels read", () => {
    // The two-year-change-called-one-year defect. A tolerance loose enough to
    // pass this readmits exactly the bug the accessor exists to kill.
    expect(areConsecutive("2023-09-30", "2025-09-27")).toBe(false);
  });

  it("rejects a pair only months apart (a quarterly snapshot pretending to be a year)", () => {
    expect(areConsecutive("2025-06-30", "2025-09-27")).toBe(false);
  });
});

describe("consecutivePeriodPair", () => {
  it("returns the anchor and the period immediately before it", () => {
    expect(
      consecutivePeriodPair(["2023-09-30", "2025-09-27", "2024-09-28"]),
    ).toEqual({ anchor: "2025-09-27", prior: "2024-09-28" });
  });

  it("returns null on a GAP YEAR rather than pairing across it", () => {
    // 2025 and 2023 are the two most recent ends; they are two intervals apart.
    // Returning them would publish a two-year change as one year's growth.
    expect(consecutivePeriodPair(["2025-09-27", "2023-09-30"])).toBeNull();
  });

  it("returns null with fewer than two distinct periods", () => {
    expect(consecutivePeriodPair(["2025-09-27"])).toBeNull();
    expect(consecutivePeriodPair([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------

/** A statement that CARRIES FIGURES. Undated-with-figures is the legacy shape,
 *  so `figureless: false` is the default here and the unavailable path is the
 *  one that has to say so explicitly. */
const OBS = (returned: string | null, observedNewest: string | null = null) => ({
  observedNewest,
  returned,
  figureless: false,
});

/** The genuinely unavailable statement: no figures, hence no period. */
const NO_FIGURES = { observedNewest: null, returned: null, figureless: true };

describe("isCoherentStatementSet — detection, and it needs BOTH parts", () => {
  it("passes a set that agrees at one period", () => {
    const v = isCoherentStatementSet({
      income: OBS("2025-09-27", "2025-09-27"),
      balance: OBS("2025-09-27", "2025-09-27"),
      cashflow: OBS("2025-09-27", "2025-09-27"),
    });
    expect(v.coherent).toBe(true);
    expect(v.reason).toBeNull();
  });

  it("passes a set split across providers within one fiscal year", () => {
    // Income from the filings source, balance sheet from market data — the same
    // year dated three days apart. A string-equality check withholds here, on
    // a correct pairing.
    const v = isCoherentStatementSet({
      income: OBS("2025-09-27", "2025-09-27"),
      balance: OBS("2025-09-30", "2025-09-30"),
      cashflow: OBS("2025-09-27", "2025-09-27"),
    });
    expect(v.coherent).toBe(true);
  });

  it("(b) rejects a set whose periods disagree outright", () => {
    const v = isCoherentStatementSet({
      income: OBS("2025-09-27", "2025-09-27"),
      balance: OBS("2024-09-28", "2024-09-28"),
      cashflow: OBS("2025-09-27", "2025-09-27"),
    });
    expect(v.coherent).toBe(false);
    expect(v.reason).toBe("periods-disagree");
    expect(v.periods).toEqual({
      income: "2025-09-27",
      balance: "2024-09-28",
      cashflow: "2025-09-27",
    });
  });

  it("(a) rejects UNIFORM STALENESS — and THIS case is what a part-(b)-only build passes", () => {
    // All three fell back to the SAME older year, so they agree perfectly and
    // "do the periods match" says yes. Part (a) catches it: the balance sheet's
    // own resolution SAW 2025 before settling for 2024, which is the shape the
    // ladder produces when an older COMPLETE payload beats a newer PARTIAL one.
    const v = isCoherentStatementSet({
      income: OBS("2024-09-28", "2024-09-28"),
      balance: OBS("2024-09-28", "2025-09-27"),
      cashflow: OBS("2024-09-28", "2024-09-28"),
    });
    expect(v.coherent).toBe(false);
    expect(v.reason).toBe("settled-for-less-than-seen");

    // Proof that (b) alone would have passed it: the three RETURNED periods are
    // mutually compatible. Delete part (a) and this set reads coherent.
    expect(samePeriod("2024-09-28", "2024-09-28")).toBe(true);
  });

  it("(a) does NOT fire on a cross-provider skew within one year", () => {
    // Observed 2025-09-27 from the filings source, returned 2025-09-30 from
    // market data. Same fiscal year — settling here is not staleness. A part (a)
    // written as string equality would reject this correct set.
    const v = isCoherentStatementSet({
      income: OBS("2025-09-30", "2025-09-27"),
      balance: OBS("2025-09-30", "2025-09-27"),
      cashflow: OBS("2025-09-30", "2025-09-27"),
    });
    expect(v.coherent).toBe(true);
  });

  it("ACCEPTS the short-circuit case, and this is the contract's documented limit", () => {
    // Every statement returned a complete payload from the first provider, so
    // the next provider was never fetched and its newer annual period was never
    // observed. Part (a) has nothing to compare; part (b) is satisfied. The set
    // is coherent as far as the desk can know.
    //
    // Asserted as PASSING on purpose: a later reader must not "fix" this into an
    // extra provider fetch per statement per run without pricing it. Widen the
    // observation beyond what was fetched and this test flips.
    const v = isCoherentStatementSet({
      income: OBS("2024-09-28", null),
      balance: OBS("2024-09-28", null),
      cashflow: OBS("2024-09-28", null),
    });
    expect(v.coherent).toBe(true);
    expect(v.reason).toBeNull();
  });

  it("does not compare a FIGURELESS statement that declares no period at all", () => {
    // The unavailable path carries no figures and so no period. It has no claim
    // to disagree with; the other two still decide the set.
    const v = isCoherentStatementSet({
      income: OBS("2025-09-27", "2025-09-27"),
      balance: NO_FIGURES,
      cashflow: OBS("2025-09-27", "2025-09-27"),
    });
    expect(v.coherent).toBe(true);
  });

  it("the ladder trap this fix removes: a FIGURELESS statement with a stale sighting still misreports settled-for-less-than-seen", () => {
    // This is the mechanism Codex traced in `edgar-companyfacts.ts` /
    // `yahoo-timeseries.ts` (Codex review, FIX-1113): before the fix, a
    // provider mapper stamped EVERY statement with the response-wide anchor,
    // including one that carried no figures at all. The recovery ladder's
    // `observedNewest` bookkeeping (`statement-recovery.ts`'s
    // `declaredPeriod`) reads that stamped `periodEnd` directly — so a
    // FIRST provider attempt with the bug recorded `observedNewest` = the
    // anchor for a statement that had nothing there, and if a LATER attempt
    // (or the final `empty()` fallback) then correctly settled on nothing
    // (`returned: null`), `settledForLessThanSeen` reports `true`
    // UNCONDITIONALLY whenever `returned` is null and `observedNewest` is
    // not (its own doc: "a resolution that saw a real period and returned
    // nothing settled for less than it saw regardless of chronology").
    // `figureless` is not consulted by part (a) at all — this function is
    // unchanged and correctly so; the fix is that `declaredPeriod` can no
    // longer observe a phantom sighting from a statement that was never
    // populated, because the mapper no longer stamps one. This test pins
    // the trap itself as a permanent regression guard on the mechanism, not
    // only on the symptom the mapper fix already covers.
    const v = isCoherentStatementSet({
      income: OBS("2025-09-27", "2025-09-27"),
      balance: OBS("2025-09-27", "2025-09-27"),
      cashflow: { returned: null, observedNewest: "2025-09-27", figureless: true },
    });
    expect(v.coherent).toBe(false);
    expect(v.reason).toBe("settled-for-less-than-seen");
  });

  it("REJECTS a POPULATED statement that declares no period — the legacy shape", () => {
    // Same missing period as the case above, opposite verdict, and the pair is
    // what pins the contract. This statement has real figures, so it enters the
    // cross-statement valuations while its period is unknown — the set cannot be
    // declared to share one. Filtering on the period alone could not tell these
    // two apart, so it certified the legacy record as coherent.
    const v = isCoherentStatementSet({
      income: OBS("2025-09-27", "2025-09-27"),
      balance: OBS(null, null),
      cashflow: OBS("2025-09-27", "2025-09-27"),
    });
    expect(v.coherent).toBe(false);
    expect(v.reason).toBe("period-unstated");
  });

  it("REJECTS three populated statements that all declare no period", () => {
    // The worst shape and the one the old filter was most obviously blind to:
    // nothing to compare, so the loop never ran and the function returned
    // `coherent: true` — declaring a shared fiscal period it never established.
    const v = isCoherentStatementSet({
      income: OBS(null, null),
      balance: OBS(null, null),
      cashflow: OBS(null, null),
    });
    expect(v.coherent).toBe(false);
    expect(v.reason).toBe("period-unstated");
  });

  it("names outright DISAGREEMENT ahead of an unstated period", () => {
    // Two dated statements that clash, plus a legacy third. Both findings are
    // real; the disagreement is the more specific one and is what the reader
    // can act on, so it wins the `reason`.
    const v = isCoherentStatementSet({
      income: OBS("2025-09-27", "2025-09-27"),
      balance: OBS("2024-09-28", "2024-09-28"),
      cashflow: OBS(null, null),
    });
    expect(v.coherent).toBe(false);
    expect(v.reason).toBe("periods-disagree");
  });

  it("still reports UNIFORM STALENESS ahead of everything else", () => {
    // Part (a) runs first and is unchanged by the figureless distinction.
    const v = isCoherentStatementSet({
      income: OBS("2024-09-28", "2025-09-27"),
      balance: OBS(null, null),
      cashflow: OBS("2024-09-28", "2024-09-28"),
    });
    expect(v.reason).toBe("settled-for-less-than-seen");
  });
});


describe("periodsMutuallyAgree — pairwise across all three, not chained through one", () => {
  it("rejects an intransitive triple where ONLY the a–c pair fails (49 days apart)", () => {
    // a-b: 26 days (agree). b-c: 23 days (agree). a-c: 49 days — beyond the
    // 31-day tolerance, NOT agreeing. A check that only compared a-b and b-c
    // (chaining through b) would wrongly call this agreement.
    expect(periodsMutuallyAgree("2025-09-01", "2025-09-27", "2025-10-20")).toBe(false);
  });

  it("rejects an intransitive triple where ONLY the b–c pair fails", () => {
    // a-b: 14 days (agree). a-c: 25 days (agree). b-c: 39 days — NOT
    // agreeing. A check that only compared a-b and a-c (chaining through a)
    // would wrongly call this agreement.
    expect(periodsMutuallyAgree("2025-09-15", "2025-09-01", "2025-10-10")).toBe(false);
  });

  it("rejects null against null — two unknowns are not evidence of agreement", () => {
    expect(periodsMutuallyAgree(null, null, null)).toBe(false);
    expect(periodsMutuallyAgree(null, "2025-09-27", "2025-09-27")).toBe(false);
    expect(periodsMutuallyAgree("2025-09-27", null, "2025-09-27")).toBe(false);
  });

  it("accepts three genuinely agreeing periods, exact and cross-provider-skewed", () => {
    expect(periodsMutuallyAgree("2025-09-27", "2025-09-27", "2025-09-27")).toBe(true);
    expect(periodsMutuallyAgree("2025-09-27", "2025-09-30", "2025-09-27")).toBe(true);
  });
});

describe("isCoherentStatementSet — observedNewest is the FRONTIER, not the first match", () => {
  it("reports the max observedNewest across every offending statement, not the first one found in iteration order", () => {
    const v = isCoherentStatementSet({
      income: OBS("2020-01-01", "2024-09-28"), // triggers first; a smaller frontier
      balance: OBS("2020-01-01", null),
      cashflow: OBS("2020-01-01", "2025-09-27"), // triggers too; the TRUE max
    });
    expect(v.reason).toBe("settled-for-less-than-seen");
    expect(v.observedNewest).toBe("2025-09-27");
  });
});

describe("isCoherentStatementSet — the direction invariant (observedNewest must be NEWER)", () => {
  it("does NOT fire settled-for-less-than-seen when the observation is actually OLDER than what was returned", () => {
    // `samePeriod` is a direction-blind distance check — it cannot by itself
    // tell "saw something newer" from "saw something older", only that the
    // two are not the same period. If a future bug ever fed a genuinely
    // OLDER `observedNewest`, this must not render "the desk saw a more
    // recent one" over it — it must not fire this reason at all.
    const v = isCoherentStatementSet({
      income: OBS("2025-09-27", "2024-09-28"), // "observed" is OLDER than returned
      balance: OBS("2025-09-27", null),
      cashflow: OBS("2025-09-27", null),
    });
    expect(v.coherent).toBe(true);
    expect(v.reason).toBeNull();
  });
});
