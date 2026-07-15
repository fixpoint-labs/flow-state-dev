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
 *   4. CUSIP-only securities surface in the report; a SPLIT is now INGESTED as a
 *      `split` event that rebases the holding's lots (FIX-876), not skipped.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { makeTestRepository, seedAccount } from "./_helpers/portfolio-repo";
import type { PortfolioRepository } from "@/db/repository";
import type { FileImportReport } from "@/domain/portfolio/schema/transaction-import-schema";
import { importTransactionFile } from "@/domain/portfolio/services/portfolio-writes";

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
  mode: "append" | "replace" = "append",
): Promise<{ output: FileImportReport }> {
  const output = await importTransactionFile(
    { accountId, content, filename, mode },
    USER_ID,
    repo,
  );
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
      holdings: [
        {
          ticker: "AAPL",
          quantity: 10,
          costBasis: null,
          acquiredDate: null,
          assetClass: "equity",
          assetType: "equity",
          attributes: { kind: "none" },
        },
      ],
    });

    const { output } = await importFile(ACCT, OFX_FILE);
    expect(output.detectedFormat).toBe("qfx");
    // Two buys + one SPLIT ingested (FIX-876: the split is now a first-class event).
    expect(output.inserted).toBe(3);
    expect(output.skipped).toEqual([]);
    // The CUSIP-only security (no ticker in SECLIST) is surfaced for mapping.
    expect(output.unresolvedSecurities).toEqual([{ cusip: "316175207", name: null }]);

    // Basis derived from the imported buy (10 @ 150) THEN rebased by the 4:1 split
    // (2026-01-10): 40 shares at 150 ÷ 4 = 37.5, acquired date preserved.
    const { holdings } = await repo.getPortfolio(USER_ID);
    const aapl = holdings.find((h) => h.ticker === "AAPL");
    expect(aapl?.quantity).toBe(40);
    expect(aapl?.costBasis).toBe(37.5);
    expect(aapl?.acquiredDate).toBe("2026-01-05");
  });

  it("is idempotent — re-importing the same file inserts nothing new", async () => {
    await seedAccount(repo, { accountId: ACCT, userId: USER_ID });

    const first = await importFile(ACCT, OFX_FILE);
    expect(first.output.inserted).toBe(3); // 2 buys + 1 split

    const second = await importFile(ACCT, OFX_FILE);
    expect(second.output.inserted).toBe(0);
    expect(second.output.deduplicated).toBe(3);

    expect(await repo.getLedger(USER_ID)).toHaveLength(3); // not 6
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

  // FIX-876: the reset-account import mode.
  it("reset mode wipes the account's ledger (manual entries included) then repopulates", async () => {
    await seedAccount(repo, { accountId: ACCT, userId: USER_ID });
    await importFile(ACCT, OFX_FILE); // 3 file events
    // A manual entry the reset must destroy (the documented, accepted loss).
    await repo.ingestLedgerEvents(
      [
        {
          accountId: ACCT,
          type: "dividend",
          tradeDate: "2026-02-01",
          settleDate: null,
          ticker: "AAPL",
          quantity: null,
          unitPrice: null,
          amount: 12.5,
          fee: null,
          currency: "USD",
          source: "manual",
          externalId: null,
          description: null,
          basisUnknown: null,
          proceedsUnknown: null,
          attributes: null,
        },
      ],
      USER_ID,
    );
    expect(await repo.getLedger(USER_ID)).toHaveLength(4);

    const { output } = await importFile(ACCT, OFX_FILE, "export.qfx", "replace");
    expect(output.inserted).toBe(3);
    // The ledger is EXACTLY the file's 3 events — the manual dividend is gone.
    const ledger = await repo.getLedger(USER_ID);
    expect(ledger).toHaveLength(3);
    expect(ledger.some((e) => e.type === "dividend")).toBe(false);
  });

  it("replaceLedgerFromFile leaves the ledger untouched when the account isn't the caller's", async () => {
    await seedAccount(repo, { accountId: ACCT, userId: USER_ID });
    await importFile(ACCT, OFX_FILE);
    const before = await repo.getLedger(USER_ID);
    // A foreign caller: the ownership guard throws BEFORE the wipe, so the whole
    // transaction rolls back — no partial-wipe window.
    await expect(
      repo.replaceLedgerFromFile(ACCT, "intruder", [
        {
          accountId: ACCT,
          type: "buy",
          tradeDate: "2026-03-01",
          settleDate: null,
          ticker: "AAPL",
          quantity: 1,
          unitPrice: 100,
          amount: -100,
          fee: null,
          currency: "USD",
          source: "file",
          externalId: null,
          description: null,
          basisUnknown: null,
          proceedsUnknown: null,
          attributes: null,
        },
      ]),
    ).rejects.toThrow();
    expect(await repo.getLedger(USER_ID)).toHaveLength(before.length);
  });
});
