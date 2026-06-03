/**
 * End-to-end integration spec for the PDF holdings import path, with the
 * extraction generator MOCKED (the suite is offline — no real LLM, no real PDF).
 *
 * Asserts the two seams the slice rests on:
 *  1. `extractHoldingsFromPdf` runs the (mocked) generator and writes the
 *     transcribed rows + stated total to the session-scoped `pdfImport` resource
 *     — the channel the dialog reads (sendAction returns only a status
 *     envelope). The action imports NOTHING.
 *  2. The confirmed rows, mapped to canonical CSV by the pure
 *     `toCanonicalRows` / `canonicalRowsToCsv`, flow through the EXISTING
 *     `importHoldings` action: real holdings land in the `holdings` collection
 *     with `costBasis: null`, and the skipped junk rows (MMF, contra-CUSIP)
 *     never reach storage.
 *
 * The reconciliation arithmetic itself is unit-tested in `portfolio-pdf.spec.ts`;
 * this spec verifies the wiring around it.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/server";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import tradingDeskFlow from "../src/flows/trading-desk/flow";
import {
  canonicalRowsToCsv,
  toCanonicalRows,
  type PdfExtraction,
} from "../src/flows/trading-desk/portfolio/portfolio-pdf";

const USER_ID = "devuser";
const ISOLATED_KEY = `${USER_ID}:trading-desk`;
const ACCOUNT = "acct-pdf";

/** What the (mocked) extraction generator "transcribes" from the statement. */
function extractionOutput(): PdfExtraction {
  return {
    rows: [
      { ticker: "AAPL", quantity: 5.44149, costBasis: null, price: 298.97, value: 1626.84 },
      { ticker: "MSFT", quantity: 2, costBasis: null, price: 400, value: 800 },
      { ticker: "TIMXX", quantity: 1500, costBasis: null, price: 1, value: 1500 },
      { ticker: "436CVR021", quantity: 0, costBasis: null, price: 0, value: 0 },
    ],
    statedTotal: 3926.84,
  };
}

describe("extractHoldingsFromPdf action", () => {
  it("writes the transcribed rows to the pdfImport resource and imports nothing", async () => {
    const stores = createInMemoryStores();
    const sessionId = "pdf-extract-session";

    const result = await testFlow({
      flow: tradingDeskFlow,
      action: "extractHoldingsFromPdf",
      userId: USER_ID,
      sessionId,
      stores,
      input: { statementText: "AAPL ... MSFT ... Total Holdings $3,926.84" },
      generators: {
        "extract-holdings-generator": mockGenerator({
          name: "extract-holdings-generator",
          script: [{ structuredOutput: extractionOutput() }],
        }),
      },
      unmockedGeneratorPolicy: "error",
    });
    expect(result.status).toBe("completed");

    // The extraction landed on the session-scoped resource for the dialog.
    const sessionResources = (await stores.resourceState.getAll(
      "session",
      sessionId,
    )) as Record<string, { extraction?: PdfExtraction }>;
    const extraction = sessionResources.pdfImport?.extraction;
    expect(extraction?.rows).toHaveLength(4);
    expect(extraction?.statedTotal).toBe(3926.84);

    // The action imported NOTHING — no holdings written.
    const userResources = (await stores.resourceState.getAll(
      "user",
      ISOLATED_KEY,
    )) as Record<string, unknown>;
    expect(
      Object.keys(userResources).some((k) => k.startsWith("holdings/")),
    ).toBe(false);
  });
});

describe("confirmed PDF rows flow into the EXISTING importHoldings", () => {
  it("imports the real holdings (costBasis null) and skips MMF + contra-CUSIP", async () => {
    const stores = createInMemoryStores();

    // The dialog's confirm step: map the (reviewed) extraction to canonical CSV.
    const { rows, skipped } = toCanonicalRows(extractionOutput());
    const csvText = canonicalRowsToCsv(rows);
    // Sanity: the pure mapping already dropped the junk before import.
    expect(rows.map((r) => r.ticker)).toEqual(["AAPL", "MSFT"]);
    expect(skipped.map((s) => s.ticker)).toContain("TIMXX");
    expect(skipped.map((s) => s.ticker)).toContain("436CVR021");

    const result = await testFlow({
      flow: tradingDeskFlow,
      action: "importHoldings",
      userId: USER_ID,
      stores,
      input: { accountId: ACCOUNT, mode: "upsert", csvText },
    });
    expect(result.status).toBe("completed");

    const userResources = (await stores.resourceState.getAll(
      "user",
      ISOLATED_KEY,
    )) as Record<string, { ticker?: string; quantity?: number; costBasis?: number | null }>;

    // Real holdings landed with costBasis null (a snapshot carries no cost).
    expect(userResources[`holdings/${ACCOUNT}__AAPL`]).toMatchObject({
      ticker: "AAPL",
      quantity: 5.44149,
      costBasis: null,
    });
    expect(userResources[`holdings/${ACCOUNT}__MSFT`]).toMatchObject({
      ticker: "MSFT",
      quantity: 2,
      costBasis: null,
    });
    // The skipped junk rows never reached storage.
    expect(userResources[`holdings/${ACCOUNT}__TIMXX`]).toBeUndefined();
    expect(userResources[`holdings/${ACCOUNT}__436CVR021`]).toBeUndefined();
  });
});

describe("importHoldings clears the consumed pdfImport scratch", () => {
  it("resets pdfImport to null after a confirmed import, so a 2nd import can't read it", async () => {
    const stores = createInMemoryStores();
    const sessionId = "pdf-clear-session";

    // 1. Extraction populates the session-scoped scratch resource.
    const extractResult = await testFlow({
      flow: tradingDeskFlow,
      action: "extractHoldingsFromPdf",
      userId: USER_ID,
      sessionId,
      stores,
      input: { statementText: "AAPL ... MSFT ... Total Holdings $3,926.84" },
      generators: {
        "extract-holdings-generator": mockGenerator({
          name: "extract-holdings-generator",
          script: [{ structuredOutput: extractionOutput() }],
        }),
      },
      unmockedGeneratorPolicy: "error",
    });
    expect(extractResult.status).toBe("completed");

    // Precondition: the scratch holds the extraction.
    const afterExtract = (await stores.resourceState.getAll(
      "session",
      sessionId,
    )) as Record<string, { extraction?: PdfExtraction } | null>;
    expect(afterExtract.pdfImport?.extraction?.rows).toHaveLength(4);

    // 2. The confirmed import (same session) consumes the reviewed rows.
    const { rows } = toCanonicalRows(extractionOutput());
    const importResult = await testFlow({
      flow: tradingDeskFlow,
      action: "importHoldings",
      userId: USER_ID,
      sessionId,
      stores,
      input: {
        accountId: ACCOUNT,
        mode: "upsert",
        csvText: canonicalRowsToCsv(rows),
      },
    });
    expect(importResult.status).toBe("completed");

    // The scratch is cleared — the next PDF import opens against no extraction,
    // never the prior one. "Cleared" is asserted the way the dialog reads it
    // (`pdfData?.extraction ?? null`): the store may represent a nulled state as
    // `null` OR `{}` (a framework representation quirk), so the intent is that
    // `.extraction` is gone, not that the raw value is literally null. This is
    // the bug fix — a stale extraction is no longer read as the current one.
    const afterImport = (await stores.resourceState.getAll(
      "session",
      sessionId,
    )) as Record<string, { extraction?: unknown } | null>;
    expect(afterImport.pdfImport?.extraction ?? null).toBeNull();
  });
});
