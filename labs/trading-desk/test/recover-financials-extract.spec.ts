/**
 * Tests for the bounded LLM prospectus extractor (FIX-898).
 *
 * Intent: the model transcribes at the table's stated units and this leaf
 * applies the scale; a table with NO explicit units is rejected (`unspecified`)
 * rather than guessed as whole-dollars — the same explicit-scale bar the
 * deterministic tier enforces (so a "in thousands" table with a dropped unit
 * note can't be normalized 1000x too low and promoted).
 */
import { describe, expect, it, vi } from "vitest";
import {
  recoverFinancialsExtract,
  type ExtractModel,
} from "../flows/analysis/tools/runtime/recover-financials-extract";

const meta = {
  ticker: "SPCX",
  cik: 1750000,
  form: "424B4",
  filingDate: "2026-02-10",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/1750000/000000000026000004/424b4.htm",
  companyName: "SpaceCo Exploration Inc.",
};
const docs = [{ url: meta.sourceUrl, text: "<financials>" }];

function modelReturning(structuredOutput: unknown): ExtractModel {
  return { generate: vi.fn(async () => ({ structuredOutput })) };
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
    // Heading split across tags — the anchor must still match after HTML flatten.
    const statements = "Consolidated <span>Statements</span> of Operations. Total revenue 8,500,000 (in thousands).";
    let capturedUser = "";
    const model: ExtractModel = {
      generate: vi.fn(async (opts: { messages: Array<{ role: string; content: string }> }) => {
        capturedUser = opts.messages.map((m) => m.content).join("\n");
        return {
          structuredOutput: {
            currency: "USD", scale: "thousands", periodEnd: "2025-12-31",
            revenue: 8_500_000, operatingIncome: 1_200_000, operatingCashFlow: null,
            capitalExpenditure: null, freeCashFlow: null, cashAndEquivalents: null, totalDebt: null,
          },
        };
      }),
    };
    await recoverFinancialsExtract(model, [{ url: meta.sourceUrl, text: filler + statements }], meta);
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
