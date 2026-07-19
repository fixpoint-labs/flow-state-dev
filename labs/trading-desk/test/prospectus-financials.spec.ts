/**
 * Unit tests for prospectus extraction + candidate validation + promotion
 * (FIX-898) — the deterministic recovery tier and its hard gates.
 *
 * Intent encoded:
 *   1. A clean prospectus table yields the valuation-critical line items with
 *      the correct scale (thousands → raw USD → USD billions on promote).
 *   2. The validator is a HARD gate: wrong company, non-SEC source, non-USD,
 *      stale period, an insufficient set, and an unreconciled FCF triple are all
 *      rejected — no zero-fill, no magnitude guessing.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractProspectusFinancials } from "../lib/providers/prospectus-financials";
import {
  promoteCandidate,
  type FinancialCandidate,
} from "../flows/analysis/lib/financial-candidate";
import { validateFinancialCandidate } from "../flows/analysis/lib/validate-financial-candidate";

const html = readFileSync(
  path.join(__dirname, "__fixtures__", "spcx-prospectus.html"),
  "utf8",
);

const meta = {
  ticker: "SPCX",
  cik: 1750000,
  form: "424B4",
  filingDate: "2026-02-10",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/1750000/000000000026000004/424b4.htm",
  companyName: "SpaceCo Exploration Inc.",
};

const validateCtx = {
  ticker: "SPCX",
  expectedCik: 1750000,
  asOfDate: "2026-05-06",
  expectedName: "SpaceCo Exploration Inc.",
};

describe("extractProspectusFinancials — deterministic table extract", () => {
  const candidate = extractProspectusFinancials(html, meta);

  it("extracts the critical line items at the stated 'in thousands' scale (raw USD)", () => {
    expect(candidate).not.toBeNull();
    expect(candidate!.scale).toBe(1_000);
    expect(candidate!.currency).toBe("USD");
    expect(candidate!.periodEnd).toBe("2025-12-31");
    // 8,500,000 thousands = $8.5B raw.
    expect(candidate!.income.revenue).toBe(8_500_000_000);
    expect(candidate!.income.operatingIncome).toBe(1_200_000_000);
    expect(candidate!.cashflow.operating).toBe(2_000_000_000);
    // capex parsed from a parenthesized (negative-printed) outflow → magnitude.
    expect(candidate!.cashflow.capitalExpenditure).toBe(-3_500_000_000);
    expect(candidate!.balance.cashAndEquivalents).toBe(4_000_000_000);
    expect(candidate!.balance.totalDebt).toBe(1_000_000_000);
  });

  it("promotes a validated candidate into USD-billions statements tagged edgar-prospectus", () => {
    expect(validateFinancialCandidate(candidate!, validateCtx).ok).toBe(true);
    const { incomeStatement, balanceSheet, cashflow } = promoteCandidate(candidate!);
    expect(incomeStatement.source).toBe("edgar-prospectus");
    expect(incomeStatement.unit).toBe("USD billions");
    expect(incomeStatement.revenue).toBeCloseTo(8.5, 6);
    expect(incomeStatement.operatingIncome).toBeCloseTo(1.2, 6);
    // FCF = operating − |capex| = 2.0 − 3.5 = −1.5 (billions).
    expect(cashflow.operating).toBeCloseTo(2.0, 6);
    expect(cashflow.freeCashFlow).toBeCloseTo(-1.5, 6);
    expect(balanceSheet.cashAndEquivalents).toBeCloseTo(4.0, 6);
    expect(balanceSheet.totalDebt).toBeCloseTo(1.0, 6);
    // Not disclosed on this shape → null, never zero-filled.
    expect(incomeStatement.netIncome).toBeNull();
    expect(balanceSheet.totalAssets).toBeNull();
  });

  it("returns null when no scale is stated (never guesses magnitude)", () => {
    const noScale = html.replace(/in thousands of U\.S\. dollars/i, "in U.S. dollars");
    expect(extractProspectusFinancials(noScale, meta)).toBeNull();
  });
});

describe("extractProspectusFinancials — parsing robustness", () => {
  it("skips a footnote marker before the amount instead of reading it as the value", () => {
    const withNotes = `
<html><body>
<p>Amounts in thousands of U.S. dollars. Year ended December 31, 2025.</p>
<table>
<tr><td>Total revenue (1)</td><td>8,500,000</td></tr>
<tr><td>Income from operations (2)</td><td>1,200,000</td></tr>
<tr><td>Net cash provided by operating activities</td><td>2,000,000</td></tr>
<tr><td>Purchases of property and equipment</td><td>(3,500,000)</td></tr>
</table></body></html>`;
    const c = extractProspectusFinancials(withNotes, meta);
    expect(c).not.toBeNull();
    expect(c!.income.revenue).toBe(8_500_000_000); // not (1) → −1
    expect(c!.income.operatingIncome).toBe(1_200_000_000);
  });

  it("ignores a 'Revenue Recognition' index/policy row and reads the statement line", () => {
    // An index entry ("Revenue Recognition ... F-12") precedes the real income
    // statement. Its page-reference number must NOT be captured as revenue
    // (scaled to a tiny bogus figure) — the statement's Revenue line wins.
    const withPolicyIndex = `
<html><body>
<p>Amounts in thousands of U.S. dollars. Year ended December 31, 2025.</p>
<p>Revenue Recognition F-12</p>
<p>Revenue recognition ASC 606</p>
<table>
<tr><td>Total revenue</td><td>8,500,000</td></tr>
<tr><td>Income from operations</td><td>1,200,000</td></tr>
<tr><td>Net cash provided by operating activities</td><td>2,000,000</td></tr>
<tr><td>Purchases of property and equipment</td><td>(3,500,000)</td></tr>
</table></body></html>`;
    const c = extractProspectusFinancials(withPolicyIndex, meta);
    expect(c).not.toBeNull();
    expect(c!.income.revenue).toBe(8_500_000_000); // not 12 or 606 × scale
  });

  it("does not let a narrative 'in millions' set the table scale", () => {
    // A narrative sentence mentions millions (of users), but the statements are
    // stated in thousands — the accounting-units note must win.
    const narrative = html.replace(
      /Amounts are presented in thousands of U\.S\. dollars\./,
      "Our platform reached tens of millions of users. Amounts are presented in thousands of U.S. dollars.",
    );
    const c = extractProspectusFinancials(narrative, meta);
    expect(c!.scale).toBe(1_000);
    expect(c!.income.revenue).toBe(8_500_000_000);
  });

  it("returns null on conflicting scale notes (falls back rather than mis-scaling)", () => {
    // A capitalization table 'in millions' precedes the audited statements
    // 'in thousands' — an ambiguous scale must NOT be guessed.
    const conflicting = html.replace(
      /Amounts are presented in thousands of U\.S\. dollars\./,
      "Capitalization is presented in millions, except share data. Amounts are presented in thousands of U.S. dollars.",
    );
    expect(extractProspectusFinancials(conflicting, meta)).toBeNull();
  });

  it("defers to the LLM (returns null) when interim/unaudited columns are present", () => {
    const interim = html.replace(
      "Year Ended December 31, 2025",
      "Six Months Ended June 30, 2026 (unaudited)",
    );
    expect(extractProspectusFinancials(interim, meta)).toBeNull();
  });

  it("flags a qualified non-U.S.-dollar currency (rejected by the validator)", () => {
    // Scale still parses ('in thousands,'), but the currency is Canadian dollars.
    const cad = html.replace(
      "in thousands of U.S. dollars",
      "in thousands, expressed in Canadian dollars",
    );
    const c = extractProspectusFinancials(cad, meta);
    expect(c).not.toBeNull();
    expect(c!.currency).toBe("NON-USD");
    expect(validateFinancialCandidate(c!, validateCtx).ok).toBe(false);
  });

  it("preserves an accounting-negative whose parentheses are split across cells", () => {
    // "( 1,200,000 )" laid out across separate <td> cells (space-collapsed) must
    // read as an operating LOSS, not a positive value.
    const withLoss = html.replace(
      "<tr><td>Income from operations</td><td>1,200,000</td><td>640,000</td></tr>",
      "<tr><td>Loss from operations</td><td>(</td><td>1,200,000</td><td>)</td><td>(640,000)</td></tr>",
    );
    const c = extractProspectusFinancials(withLoss, meta);
    expect(c!.income.operatingIncome).toBe(-1_200_000_000);
  });

  it("flags a foreign reporting currency stated outside the units note", () => {
    const rmb = html.replace(
      "in thousands of U.S. dollars",
      "in thousands, expressed in Renminbi (RMB)",
    );
    const c = extractProspectusFinancials(rmb, meta);
    expect(c!.currency).toBe("NON-USD");
    expect(validateFinancialCandidate(c!, validateCtx).ok).toBe(false);
  });

  it("does not promote a bare long-term debt line as total debt", () => {
    const ltOnly = html.replace(
      "<tr><td>Total debt</td><td>1,000,000</td><td>1,200,000</td></tr>",
      "<tr><td>Current portion of long-term debt</td><td>200,000</td><td>150,000</td></tr>\n<tr><td>Long-term debt</td><td>1,000,000</td><td>1,200,000</td></tr>",
    );
    const c = extractProspectusFinancials(ltOnly, meta);
    expect(c).not.toBeNull();
    // No explicit "total debt" row → null (honest), never the understated
    // long-term-only figure.
    expect(c!.balance.totalDebt).toBeNull();
  });

  it("returns null when no fiscal period is parseable (does not fall back to the filing date)", () => {
    // Strip every 'Month DD, YYYY' date so no period can be parsed.
    const noDates = html.replace(
      /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/g,
      "the most recent fiscal year",
    );
    expect(extractProspectusFinancials(noDates, meta)).toBeNull();
  });

  it("takes the period end from a statement-header context, not a footnote date", () => {
    const withFootnoteDate = html.replace(
      "</body>",
      "<p>(1) A distribution agreement was signed on December 31, 2099.</p></body>",
    );
    const c = extractProspectusFinancials(withFootnoteDate, meta);
    // The header 'Year Ended December 31, 2025' wins over the 2099 footnote date.
    expect(c!.periodEnd).toBe("2025-12-31");
  });
});

/** A valid baseline candidate the reject cases each mutate one field of. */
function baseCandidate(): FinancialCandidate {
  return {
    ticker: "SPCX",
    cik: 1750000,
    companyName: "SpaceCo Exploration Inc.",
    form: "424B4",
    filingDate: "2026-02-10",
    periodEnd: "2025-12-31",
    scale: 1_000,
    currency: "USD",
    sourceUrl: meta.sourceUrl,
    income: { revenue: 8_500_000_000, operatingIncome: 1_200_000_000 },
    cashflow: { operating: 2_000_000_000, capitalExpenditure: -3_500_000_000, freeCashFlow: null },
    balance: { cashAndEquivalents: 4_000_000_000, totalDebt: 1_000_000_000 },
  };
}

describe("validateFinancialCandidate — hard reject gates", () => {
  it("accepts the baseline candidate", () => {
    expect(validateFinancialCandidate(baseCandidate(), validateCtx).ok).toBe(true);
  });

  it("rejects a wrong-company CIK", () => {
    const r = validateFinancialCandidate({ ...baseCandidate(), cik: 999 }, validateCtx);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/wrong-company/);
  });

  it("rejects a non-SEC (open-web) source URL", () => {
    const r = validateFinancialCandidate(
      { ...baseCandidate(), sourceUrl: "https://spaceco.example.com/ir/prospectus" },
      validateCtx,
    );
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/non-sec-source/);
  });

  it("rejects a non-USD candidate", () => {
    const r = validateFinancialCandidate({ ...baseCandidate(), currency: "EUR" }, validateCtx);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/non-usd/);
  });

  it("rejects a decades-stale period end", () => {
    const r = validateFinancialCandidate({ ...baseCandidate(), periodEnd: "2015-12-31" }, validateCtx);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/stale/);
  });

  it("rejects an insufficient set (missing operating income)", () => {
    const c = baseCandidate();
    c.income.operatingIncome = null;
    const r = validateFinancialCandidate(c, validateCtx);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/missing-operating-income/);
  });

  it("rejects an unreconciled operating/capex/FCF triple", () => {
    const c = baseCandidate();
    // stated FCF wildly off from operating − |capex| (= −1.5B).
    c.cashflow.freeCashFlow = 5_000_000_000;
    const r = validateFinancialCandidate(c, validateCtx);
    expect(r.ok).toBe(false);
    expect(r.reasons.join(" ")).toMatch(/unreconciled-fcf/);
  });

  it("accepts a reconciled operating/capex/FCF triple within tolerance", () => {
    const c = baseCandidate();
    c.cashflow.freeCashFlow = -1_500_000_000; // exactly operating − |capex|
    expect(validateFinancialCandidate(c, validateCtx).ok).toBe(true);
  });

  it("accepts common US-dollar currency spellings, rejects NON-USD", () => {
    for (const cur of ["USD", "$", "US dollars", "U.S. dollars", "United States dollars"]) {
      expect(validateFinancialCandidate({ ...baseCandidate(), currency: cur }, validateCtx).ok).toBe(true);
    }
    expect(validateFinancialCandidate({ ...baseCandidate(), currency: "NON-USD" }, validateCtx).ok).toBe(false);
  });
});
