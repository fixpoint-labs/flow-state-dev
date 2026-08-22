/**
 * The `valuationSpine` capability's context slots against a WITHHELD spine
 * (FIX-1113).
 *
 * REACHED THROUGH THE REAL PRESET OBJECT (`__presetDefs`), ON PURPOSE. A test
 * that re-implemented the slot's two lines would pass against the build that
 * throws — it would be asserting on a copy, not on the thing that runs. That is
 * precisely the failure being pinned here: the header of `lib/valuation-spine.ts`
 * already NAMES this trap in prose ("`if (spine?.envelope)`") and the call site
 * one directory over fell into a variant of it anyway. A comment is not a
 * mechanism; a test that runs the shipped slot is.
 *
 * WHY IT MATTERS THAT THIS THROWS RATHER THAN DEGRADES. The withholding path
 * exists so the portfolio manager can still publish a rating, marked unanchored.
 * A TypeError in the context slot fails every generator that opted into the
 * capability BEFORE the PM is reached — so the crash destroys the exact output
 * the withholding was designed to preserve. The withholding path defeats itself.
 */
import { describe, expect, it } from "vitest";
import { tradingDesk } from "@/flows/analysis/capability";
import {
  buildValuationSpine,
  type PeriodDisclosure,
} from "@/flows/analysis/lib/valuation-spine";
import { computeValuation } from "@/flows/analysis/lib/valuation";

const ANCHOR = "2025-09-27";

const incomeStatement = {
  source: "edgar" as const,
  ticker: "TEST",
  asOf: ANCHOR,
  periodEnd: ANCHOR,
  revenue: 416.161,
  grossProfit: 195.201,
  operatingIncome: 133.05,
  netIncome: 112.01,
  yoyRevenueGrowth: 0.064,
  unit: "USD billions",
};

const balanceSheet = {
  source: "edgar" as const,
  ticker: "TEST",
  asOf: ANCHOR,
  periodEnd: ANCHOR,
  totalAssets: 359.241,
  totalLiabilities: 285.508,
  totalEquity: 73.733,
  cashAndEquivalents: 35.934,
  totalDebt: 90.678,
  unit: "USD billions",
};

const cashflow = {
  source: "edgar" as const,
  ticker: "TEST",
  asOf: ANCHOR,
  periodEnd: ANCHOR,
  operating: 111.482,
  investing: 15.195,
  financing: -120.686,
  freeCashFlow: 98.767,
  unit: "USD billions",
};

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

function spineFor(periodDisclosure: PeriodDisclosure | null) {
  return buildValuationSpine({
    ticker: "TEST",
    asOf: "2026-05-06",
    fundamentals,
    balanceSheet,
    incomeStatement,
    cashflow,
    sector: "Technology",
    quantComposites: { piotroskiF: 7, altmanZone: "safe" },
    factorRanks: { compositeFactorPercentile: 70 },
    technicals: { trend: "up", sma50: 200, sma200: 180 },
    valuation: computeValuation({
      fundamentals,
      balanceSheet,
      incomeStatement,
      cashflow,
      periodsCoherent: periodDisclosure == null,
    }),
    periodDisclosure,
  });
}

/** The shipped preset's context slots — not a reconstruction of them. */
const slots = (tradingDesk as unknown as {
  __presetDefs: {
    valuationSpine: {
      context: {
        valuationSpine: (input: unknown, ctx: unknown) => string | null;
        ratingEnvelope: (input: unknown, ctx: unknown) => string | null;
      };
    };
  };
}).__presetDefs.valuationSpine.context;

/** Only `ctx.resources.valuationSpine?.state` is read by these two slots. */
const ctxFor = (state: unknown) => ({
  session: { state: {}, identity: { id: "test" } },
  resources: { valuationSpine: { state } },
});

const WITHHELD: PeriodDisclosure = {
  reason: "periods-disagree",
  income: ANCHOR,
  balance: "2024-09-28",
  cashflow: ANCHOR,
};

describe("valuationSpine capability — a WITHHELD envelope must degrade, not throw", () => {
  const withheld = spineFor(WITHHELD);

  it("the spine under test really did withhold the envelope", () => {
    // Guard the premise: if the spine ever stops nulling the envelope, the
    // assertions below would pass vacuously against a build that still throws.
    expect(withheld.envelope).toBeNull();
    expect(withheld.periodDisclosure).not.toBeNull();
  });

  it("SUPPRESSES the <ratingEnvelope> tag instead of formatting a null envelope", () => {
    expect(() => slots.ratingEnvelope(null, ctxFor(withheld))).not.toThrow();
    expect(slots.ratingEnvelope(null, ctxFor(withheld))).toBeNull();
  });

  it("STILL emits <valuationSpine>, which is what carries the honesty", () => {
    // Suppressing the envelope must not silence the disclosure too. The spine
    // tag is the surface that tells the model the figures were withheld and
    // why — without it, absence would read as a data outage.
    const text = slots.valuationSpine(null, ctxFor(withheld));
    expect(text).toContain("WITHHELD");
    expect(text).toContain("could not establish a single fiscal period");
    expect(text).toContain("2024-09-28");
  });
});

describe("valuationSpine capability — the coherent case still publishes the envelope", () => {
  // Without this arm, a slot hard-wired to `return null` would pass everything
  // above while silently removing the rating bound on every ordinary run.
  const coherent = spineFor(null);

  it("the spine under test really did produce an envelope", () => {
    expect(coherent.envelope).not.toBeNull();
  });

  it("emits the <ratingEnvelope> tag with its band", () => {
    const text = slots.ratingEnvelope(null, ctxFor(coherent));
    expect(text).toContain("<ratingEnvelope>");
    expect(text).toContain("Absolute rating");
    expect(text).toContain("Permitted band:");
  });
});

describe("valuationSpine capability — no spine computed yet", () => {
  it("suppresses both tags rather than throwing", () => {
    expect(slots.ratingEnvelope(null, ctxFor(null))).toBeNull();
    expect(slots.valuationSpine(null, ctxFor(null))).toBeNull();
  });
});
