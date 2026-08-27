/**
 * Tests for the FIX-1113 report-surface disclosure (`components/summary/
 * rating-unanchored-notice.tsx`).
 *
 * `ratingUnanchoredReason` is the fourth reader of `disclosurePrintShape`
 * (alongside `withheldReasonLine` and `formatPeriodMismatch`), so it is held to
 * the same standard: every branch must be true of the periods actually
 * PRINTED for every reachable state of the shape, not just true of what the
 * bare `reason` enum name suggests. These cases mirror
 * `test/statement-set-period.spec.ts`'s classifier coverage rather than
 * re-deriving it.
 */
import { describe, expect, it } from "vitest";
import { ratingUnanchoredReason } from "../components/summary/rating-unanchored-notice";
import type { PeriodDisclosure } from "../flows/analysis/lib/valuation-spine";

const ANCHOR = "2025-09-27";
const OLDER = "2024-09-28";

describe("ratingUnanchoredReason", () => {
  it("period-unstated: says a statement states no period, names all three", () => {
    const disclosure: PeriodDisclosure = {
      reason: "period-unstated",
      income: ANCHOR,
      balance: null,
      cashflow: ANCHOR,
    };
    const text = ratingUnanchoredReason(disclosure);
    expect(text).toContain("states no period");
    expect(text).toContain(ANCHOR);
    expect(text).toContain("balance sheet none");
  });

  it("periods-disagree: says a single period could not be established, never 'stale'", () => {
    const disclosure: PeriodDisclosure = {
      reason: "periods-disagree",
      income: ANCHOR,
      balance: OLDER,
      cashflow: ANCHOR,
    };
    const text = ratingUnanchoredReason(disclosure);
    expect(text).toContain("could not establish a single fiscal period");
    expect(text).toContain(ANCHOR);
    expect(text).toContain(OLDER);
    expect(text).not.toContain("stale");
  });

  it("settled-for-less-than-seen with agreeing printed periods -> uniform-stale wording (never 'disagree')", () => {
    const disclosure: PeriodDisclosure = {
      reason: "settled-for-less-than-seen",
      income: OLDER,
      balance: OLDER,
      cashflow: OLDER,
      observedNewest: ANCHOR,
    };
    const text = ratingUnanchoredReason(disclosure);
    expect(text).toContain("stale, not in disagreement");
    expect(text).toContain(ANCHOR); // names the newer period the desk saw
    expect(text).not.toContain("could not establish a single fiscal period");
  });

  it("settled-for-less-than-seen with NON-agreeing printed periods -> divergent-stale wording", () => {
    const disclosure: PeriodDisclosure = {
      reason: "settled-for-less-than-seen",
      income: OLDER,
      balance: ANCHOR, // diverges from income/cashflow despite the same `reason`
      cashflow: OLDER,
      observedNewest: ANCHOR,
    };
    const text = ratingUnanchoredReason(disclosure);
    expect(text).toContain("is stale");
    expect(text).not.toContain("stale, not in disagreement"); // that's the uniform-stale sentence only
  });

  it("divergent-stale with an unknown printed period -> the MISSING wording, not the STALE one", () => {
    const disclosure: PeriodDisclosure = {
      reason: "settled-for-less-than-seen",
      income: null, // unknown, not merely old
      balance: OLDER,
      cashflow: OLDER,
      observedNewest: ANCHOR,
    };
    const text = ratingUnanchoredReason(disclosure);
    expect(text).toContain("did not return a period at all");
    expect(text).toContain("income none");
  });

  it("THE BUG (Codex review, FIX-1113): does not attribute the frontier sighting to the statement that returned no period", () => {
    // `observedNewest` is the SET-WIDE FRONTIER (round 4 — the max across
    // every offending statement), not one statement's own sighting. income
    // returned no period; nothing here says income itself observed
    // anything — the frontier could belong to a DIFFERENT statement
    // entirely. The old wording ("did not return a period at all, even
    // though the desk's own resolution observed one (seen) while resolving
    // it") claimed income itself made that observation, which the type
    // cannot support and which need not be true.
    const disclosure: PeriodDisclosure = {
      reason: "settled-for-less-than-seen",
      income: null,
      balance: OLDER,
      cashflow: OLDER,
      observedNewest: ANCHOR,
    };
    const text = ratingUnanchoredReason(disclosure);
    expect(text).toContain("did not return a period at all");
    // The old coupling phrase implied identity between the null-returning
    // statement and the one that made the observation — removed.
    expect(text).not.toContain("while resolving it");
    expect(text).toContain(ANCHOR);
    expect(text).toContain("separately");
  });

  it("every sentence names the three printed periods, so a reader can see which years", () => {
    const disclosure: PeriodDisclosure = {
      reason: "periods-disagree",
      income: ANCHOR,
      balance: OLDER,
      cashflow: ANCHOR,
    };
    const text = ratingUnanchoredReason(disclosure);
    expect(text).toContain(`income ${ANCHOR}`);
    expect(text).toContain(`balance sheet ${OLDER}`);
    expect(text).toContain(`cash flow ${ANCHOR}`);
  });
});
