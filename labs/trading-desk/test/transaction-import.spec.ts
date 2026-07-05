/**
 * Integration tests for the OFX transaction-file import (FIX-775) — the
 * `importTransactionFile` domain function (FIX-736 follow-up: portfolio writes
 * are plain functions behind REST routes, not flow actions), tested directly
 * against a PGlite repository.
 *
 * Intent encoded — the file-import feed writes through the FIX-774 ingestion
 * contract and reconstructs basis:
 *   1. An OFX file's buys land as ledger events and recompute the holding's
 *      derived cost basis + acquired date.
 *   2. Re-importing the same file is idempotent (FITID dedup) — no double-count.
 *   3. A missing/foreign account is reported, not thrown (the import edge guard).
 *   4. CUSIP-only securities and skipped corporate actions surface in the report.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { makeTestRepository, seedAccount } from "./_helpers/portfolio-repo";
import type { PortfolioRepository } from "@/src/db/repository";
import type { FileImportReport } from "@/src/flows/portfolio/transaction-import-schema";
import { importTransactionFile } from "@/src/flows/portfolio/portfolio-writes";

let repo: PortfolioRepository;

const USER_ID = "devuser";
const ACCT = "acct-1";

/** A QFX file: a buy that resolves to a ticker, a CUSIP-only buy, and a SPLIT. */
const OFX_FILE = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVTRANLIST>
<BUYSTOCK><INVBUY><INVTRAN><FITID>F-AAPL<DTTRADE>20260105</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><UNITS>10<UNITPRICE>150<TOTAL>-1500</INVBUY><BUYTYPE>BUY</BUYSTOCK>
<BUYSTOCK><INVBUY><INVTRAN><FITID>F-FIDO<DTTRADE>20260106</INVTRAN><SECID><UNIQUEID>316175207<UNIQUEIDTYPE>CUSIP</SECID><UNITS>3<UNITPRICE>50<TOTAL>-150</INVBUY><BUYTYPE>BUY</BUYSTOCK>
<SPLIT><INVTRAN><FITID>F-SPLIT<DTTRADE>20260110</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><NUMERATOR>4<DENOMINATOR>1</SPLIT>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1><SECLIST><STOCKINFO><SECINFO><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><SECNAME>APPLE INC<TICKER>AAPL</SECINFO></STOCKINFO></SECLIST></SECLISTMSGSRSV1>
</OFX>`;

async function importFile(
  accountId: string,
  content: string,
  filename = "export.qfx",
): Promise<{ output: FileImportReport }> {
  const output = await importTransactionFile({ accountId, content, filename }, USER_ID, repo);
  return { output };
}

beforeEach(async () => {
  repo = await makeTestRepository();
});

describe("importTransactionFile", () => {
  it("ingests an OFX file's buys and reconstructs the holding's basis", async () => {
    await seedAccount(repo, {
      accountId: ACCT,
      userId: USER_ID,
      holdings: [{ ticker: "AAPL", quantity: 10, costBasis: null, acquiredDate: null }],
    });

    const { output } = await importFile(ACCT, OFX_FILE);
    expect(output.detectedFormat).toBe("qfx");
    // Two buys ingested (the SPLIT is skipped, not an event).
    expect(output.inserted).toBe(2);
    expect(output.skipped).toEqual([
      { kind: "SPLIT", reason: expect.stringContaining("not imported") },
    ]);
    // The CUSIP-only security (no ticker in SECLIST) is surfaced for mapping.
    expect(output.unresolvedSecurities).toEqual([{ cusip: "316175207", name: null }]);

    // Basis derived from the imported buy (10 @ 150), written onto the holding.
    const { holdings } = await repo.getPortfolio(USER_ID);
    const aapl = holdings.find((h) => h.ticker === "AAPL");
    expect(aapl?.costBasis).toBe(150);
    expect(aapl?.acquiredDate).toBe("2026-01-05");
  });

  it("is idempotent — re-importing the same file inserts nothing new", async () => {
    await seedAccount(repo, { accountId: ACCT, userId: USER_ID });

    const first = await importFile(ACCT, OFX_FILE);
    expect(first.output.inserted).toBe(2);

    const second = await importFile(ACCT, OFX_FILE);
    expect(second.output.inserted).toBe(0);
    expect(second.output.deduplicated).toBe(2);

    expect(await repo.getLedger(USER_ID)).toHaveLength(2); // not 4
  });

  it("creates the positions when importing into an empty account (no snapshot needed)", async () => {
    await seedAccount(repo, { accountId: ACCT, userId: USER_ID }); // no holdings
    const { output } = await importFile(ACCT, OFX_FILE);
    expect(output.inserted).toBeGreaterThan(0);
    // The ingest materializes the derived positions — the import alone yields a
    // visible portfolio, so there is no "import a snapshot first" warning.
    expect(output.warnings.some((w) => /no holdings yet/i.test(w))).toBe(false);
    const { holdings } = await repo.getPortfolio(USER_ID);
    expect(holdings.length).toBeGreaterThan(0);
  });

  it("reports (does not throw) when the target account does not exist", async () => {
    const { output } = await importFile("no-such-account", OFX_FILE);
    expect(output.inserted).toBe(0);
    expect(output.warnings.join(" ")).toMatch(/not found/i);
    expect(await repo.getLedger(USER_ID)).toHaveLength(0);
  });

  it("reports a clear parse error for a non-OFX file", async () => {
    await seedAccount(repo, { accountId: ACCT, userId: USER_ID });
    const { output } = await importFile(ACCT, "ticker,quantity\nAAPL,10", "trades.csv");
    expect(output.inserted).toBe(0);
    expect(output.parseErrors.length).toBeGreaterThan(0);
    expect(output.parseErrors[0].reason).toMatch(/only OFX-family/i);
  });
});
