/**
 * End-to-end integration spec for the PDF holdings import path, with BOTH the
 * server-side text extraction AND the extraction generator MOCKED (the suite is
 * offline — no real LLM, no real PDF parsing).
 *
 * The action now takes `{ pdfBase64 }` and runs: decode base64 -> server
 * `extractPdfText` (MOCKED here to return canned statement text) -> the
 * extraction generator (MOCKED) -> commit. Mocking the extractor module keeps
 * the test deterministic without bundling a real PDF; the extractor's own
 * linearization logic is unit-tested in `extract-pdf-text.server.spec.ts`.
 *
 * Asserts the two seams the slice rests on:
 *  1. `extractHoldingsFromPdf` (still a flow action — a streaming LLM generator)
 *     runs the decode + (mocked) generator and writes the transcribed rows +
 *     stated total to the session-scoped `pdfImport` resource — the channel the
 *     dialog reads. The extract step imports NOTHING.
 *  2. The confirmed rows, mapped to canonical CSV by the pure
 *     `toCanonicalRows` / `canonicalRowsToCsv`, flow through the SAME
 *     `importHoldingsCsv` the direct CSV path uses (a plain domain function
 *     behind the `holdings/import` route now, FIX-736 follow-up): real holdings
 *     land with `costBasis: null`, and the skipped junk rows (MMF, contra-CUSIP)
 *     never reach storage.
 *
 * The reconciliation arithmetic itself is unit-tested in `portfolio-pdf.spec.ts`;
 * this spec verifies the wiring around it. (The `pdfImport` scratch is no longer
 * cleared server-side on import — it's a per-session resource overwritten by the
 * next extraction, and the dialog gates its review render on a fresh-extraction
 * phase, so a stale value is never read as current.)
 */
import { describe, expect, it, vi } from "vitest";

// Mock the server-side PDF text extractor so the decode step runs without a real
// PDF. The action passes the decoded bytes to this fn; we ignore them and return
// canned statement text. Hoisted by vitest above the flow import.
vi.mock(
  "../src/flows/portfolio/extract-pdf-text.server",
  () => ({
    extractPdfText: vi.fn(
      async () => "AAPL ... MSFT ... TIMXX ... Total Holdings $3,926.84",
    ),
  }),
);

import { beforeEach } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import { makeTestRepository } from "./_helpers/portfolio-repo";
import { toAccountStates, type PortfolioRepository } from "@/src/db/repository";

// Accounts + holdings moved to the app-owned repository (FIX-772). Mock the
// repo to a fresh in-memory PGlite instance per test; the dispatched actions
// (saveAccount, importHoldings) and the holdings assertions below share it.
const repoState = vi.hoisted(() => ({ repo: null as PortfolioRepository | null }));
vi.mock("@/lib/portfolio-db", () => ({
  getRepository: async () => {
    if (!repoState.repo) throw new Error("test repository not initialized");
    return repoState.repo;
  },
}));

// `extractHoldingsFromPdf` stays a flow action (streaming generator); the CSV
// import is a plain domain function now (FIX-736 follow-up).
import portfolioFlow from "../src/flows/portfolio/flow";
import {
  importHoldingsCsv,
  importHoldingsSchema,
  saveAccount,
  saveAccountSchema,
} from "@/src/flows/portfolio/portfolio-writes";
import {
  canonicalRowsToCsv,
  toCanonicalRows,
  type PdfExtraction,
} from "../src/flows/portfolio/portfolio-pdf";

beforeEach(async () => {
  repoState.repo = await makeTestRepository();
});

/** A base64 string standing in for an uploaded PDF. Its bytes are irrelevant —
 *  `extractPdfText` is mocked — but the decode step requires non-empty bytes. */
const PDF_BASE64 = Buffer.from("%PDF-1.4 fake bytes").toString("base64");

const USER_ID = "devuser";
const ACCOUNT = "acct-pdf";

/** Read one account record's inline holdings from the (mocked) repository. */
async function holdingsOf(accountId: string) {
  const portfolio = await repoState.repo!.getPortfolio(USER_ID);
  return toAccountStates(portfolio).find((a) => a.accountId === accountId)?.holdings ?? [];
}

/** Create the target account — the import requires an existing account. */
async function createAccount(): Promise<void> {
  await saveAccount(
    saveAccountSchema.parse({ accountId: ACCOUNT, name: "PDF Account", type: "taxable" }),
    USER_ID,
    repoState.repo!,
  );
}

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
      flow: portfolioFlow,
      action: "extractHoldingsFromPdf",
      userId: USER_ID,
      sessionId,
      stores,
      input: { pdfBase64: PDF_BASE64 },
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

    // The action imported NOTHING — no account (and thus no holdings) was
    // written by the extract step.
    const accounts = await repoState.repo!.getAccountsForUser(USER_ID);
    expect(accounts).toHaveLength(0);
  });
});

describe("confirmed PDF rows flow into importHoldingsCsv", () => {
  it("imports real + MMF holdings TYPED (costBasis null) and skips only the zero-qty contra row", async () => {
    await createAccount();

    // The dialog's confirm step: map the (reviewed) extraction to canonical CSV.
    const { rows, skipped } = toCanonicalRows(extractionOutput());
    const csvText = canonicalRowsToCsv(rows);
    // FIX-773 Slice B: the MMF is PRESERVED (typed money_market), not dropped.
    // Only the zero-quantity contra-CUSIP row is skipped.
    expect(rows.map((r) => r.ticker)).toEqual(["AAPL", "MSFT", "TIMXX"]);
    expect(skipped.map((s) => s.ticker)).toEqual(["436CVR021"]);

    // The confirm path POSTs this CSV to the holdings/import route, which calls
    // the same function directly here.
    const report = await importHoldingsCsv(
      importHoldingsSchema.parse({ accountId: ACCOUNT, mode: "upsert", csvText }),
      USER_ID,
      repoState.repo!,
    );
    // AAPL + MSFT + the preserved MMF (TIMXX) all import; only the zero-qty
    // contra-CUSIP is skipped (FIX-773: the MMF is no longer dropped).
    expect(report.imported).toBe(3);

    const holdings = await holdingsOf(ACCOUNT);

    // Real holdings landed with costBasis null (a snapshot carries no cost).
    expect(holdings).toContainEqual(
      expect.objectContaining({
        ticker: "AAPL",
        quantity: 5.44149,
        costBasis: null,
        assetType: "equity",
      }),
    );
    expect(holdings).toContainEqual(
      expect.objectContaining({ ticker: "MSFT", quantity: 2, costBasis: null }),
    );
    // The MMF survives the round-trip TYPED — preserved, not dropped.
    expect(holdings).toContainEqual(
      expect.objectContaining({
        ticker: "TIMXX",
        assetType: "money_market",
        assetClass: "cash",
      }),
    );
    // The zero-quantity contra-CUSIP row never reached storage.
    expect(holdings.map((h) => h.ticker)).not.toContain("436CVR021");
  });
});
