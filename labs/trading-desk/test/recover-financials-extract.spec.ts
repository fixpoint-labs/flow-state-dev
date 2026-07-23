/**
 * Tests for the bounded LLM prospectus extractor (FIX-898).
 *
 * Intent: the model transcribes at the table's stated units and this leaf
 * applies the scale; a table with NO explicit units is rejected (`unspecified`)
 * rather than guessed as whole-dollars — the same explicit-scale bar the
 * deterministic tier enforces (so a "in thousands" table with a dropped unit
 * note can't be normalized 1000x too low and promoted). The extractor also
 * stamps provenance from the document the model reports it read
 * (`sourceDocumentIndex`), not always the lead.
 */
import { describe, expect, it, vi } from "vitest";
import {
  recoverFinancialsExtract,
  type ExtractModel,
} from "../flows/analysis/tools/runtime/recover-financials-extract";

const SOURCE_URL =
  "https://www.sec.gov/Archives/edgar/data/1750000/000000000026000004/424b4.htm";
const meta = { ticker: "SPCX", cik: 1750000, companyName: "SpaceCo Exploration Inc." };
const docs = [{ url: SOURCE_URL, text: "<financials>", form: "424B4", filingDate: "2026-02-10" }];

function modelReturning(structuredOutput: Record<string, unknown>): ExtractModel {
  return { generate: vi.fn(async () => ({ structuredOutput: { sourceDocumentIndex: 0, ...structuredOutput } })) };
}

describe("recoverFinancialsExtract", () => {
  it("applies the stated scale to reach raw USD", async () => {
    const model = modelReturning({
      currency: "USD",
      scale: "thousands",
      periodEnd: "2025-12-31",
      revenue: 8_500_000,
      operatingIncome: 1_200_000,
      operatingCashFlow: 2_000_000,
      capitalExpenditure: 3_500_000,
      freeCashFlow: null,
      cashAndEquivalents: 4_000_000,
      totalDebt: 1_000_000,
    });
    const candidate = await recoverFinancialsExtract(model, docs, meta);
    expect(candidate).not.toBeNull();
    expect(candidate!.income.revenue).toBe(8_500_000_000);
    expect(candidate!.cashflow.operating).toBe(2_000_000_000);
    expect(candidate!.sourceUrl).toBe(SOURCE_URL);
    expect(candidate!.form).toBe("424B4");
  });

  it("stamps provenance from the document the model actually transcribed", async () => {
    // Two candidates fetched (the deterministic tier missed both); the model
    // reports it read the SECOND doc — the promoted candidate must cite THAT
    // primary, not the lead.
    const twoDocs = [
      { url: "https://www.sec.gov/Archives/edgar/data/1750000/a/424b4.htm", text: "<lead>", form: "424B4", filingDate: "2026-02-10" },
      { url: "https://www.sec.gov/Archives/edgar/data/1750000/b/s1.htm", text: "<later>", form: "S-1", filingDate: "2026-01-05" },
    ];
    const model = modelReturning({
      sourceDocumentIndex: 1,
      currency: "USD",
      scale: "thousands",
      periodEnd: "2025-12-31",
      revenue: 8_500_000,
      operatingIncome: 1_200_000,
      operatingCashFlow: null,
      capitalExpenditure: null,
      freeCashFlow: null,
      cashAndEquivalents: null,
      totalDebt: null,
    });
    const candidate = await recoverFinancialsExtract(model, twoDocs, meta);
    expect(candidate).not.toBeNull();
    expect(candidate!.sourceUrl).toBe(twoDocs[1].url);
    expect(candidate!.form).toBe("S-1");
    expect(candidate!.filingDate).toBe("2026-01-05");
  });

  it("clamps an out-of-range sourceDocumentIndex to the lead document", async () => {
    const model = modelReturning({
      sourceDocumentIndex: 9, // out of range → fall back to doc 0
      currency: "USD",
      scale: "thousands",
      periodEnd: "2025-12-31",
      revenue: 8_500_000,
      operatingIncome: 1_200_000,
      operatingCashFlow: null,
      capitalExpenditure: null,
      freeCashFlow: null,
      cashAndEquivalents: null,
      totalDebt: null,
    });
    const candidate = await recoverFinancialsExtract(model, docs, meta);
    expect(candidate!.sourceUrl).toBe(SOURCE_URL);
  });

  it("rejects an unspecified scale instead of guessing whole-dollars", async () => {
    const model = modelReturning({
      currency: "USD",
      scale: "unspecified",
      periodEnd: "2025-12-31",
      revenue: 8_500_000,
      operatingIncome: 1_200_000,
      operatingCashFlow: null,
      capitalExpenditure: null,
      freeCashFlow: null,
      cashAndEquivalents: null,
      totalDebt: null,
    });
    expect(await recoverFinancialsExtract(model, docs, meta)).toBeNull();
  });

  it("windows the prompt around the statement section for a large filing", async () => {
    const filler = "cover page and table of contents. ".repeat(1000); // > 24k chars
    // Heading split across tags AND padded with numeric non-breaking spaces
    // (&#160;, as EDGAR emits) — the anchor must still match after HTML flatten.
    const statements = "Consolidated&#160;<span>Statements</span>&#160;of&#160;Operations. Total revenue 8,500,000 (in thousands).";
    let capturedUser = "";
    const model: ExtractModel = {
      generate: vi.fn(async (opts: { messages: Array<{ role: string; content: string }> }) => {
        capturedUser = opts.messages.map((m) => m.content).join("\n");
        return {
          structuredOutput: {
            sourceDocumentIndex: 0,
            currency: "USD", scale: "thousands", periodEnd: "2025-12-31",
            revenue: 8_500_000, operatingIncome: 1_200_000, operatingCashFlow: null,
            capitalExpenditure: null, freeCashFlow: null, cashAndEquivalents: null, totalDebt: null,
          },
        };
      }),
    };
    await recoverFinancialsExtract(
      model,
      [{ url: SOURCE_URL, text: filler + statements, form: "424B4", filingDate: "2026-02-10" }],
      meta,
    );
    // The statement section (past the 24k head) reached the model, not just the cover.
    expect(capturedUser).toContain("Consolidated Statements of Operations");
  });

  it("returns null when the model surfaces neither revenue nor operating income", async () => {
    const model = modelReturning({
      currency: "USD",
      scale: "thousands",
      periodEnd: "2025-12-31",
      revenue: null,
      operatingIncome: null,
      operatingCashFlow: 2_000_000,
      capitalExpenditure: null,
      freeCashFlow: null,
      cashAndEquivalents: null,
      totalDebt: null,
    });
    expect(await recoverFinancialsExtract(model, docs, meta)).toBeNull();
  });
});
