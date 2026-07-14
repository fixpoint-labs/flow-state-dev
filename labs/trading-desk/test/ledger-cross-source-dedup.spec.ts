/**
 * Cross-SOURCE dedup test (FIX-775) — the case FIX-774's ledger spec explicitly
 * deferred to "the PR that introduces the second source":
 *
 *   "Cross-SOURCE fingerprint collision (the same trade from two different
 *    feeds) is exercised in FIX-775."
 *
 * The file-import feed is that second source. Its normalizer (the OFX parser)
 * maps a file's representation onto the SAME canonical
 * (account, tradeDate, type, ticker, quantity, amount) a Plaid sync would
 * produce, so the content fingerprint collides and a file backfill overlapping a
 * Plaid sync does not double-count. The one structural limitation: the
 * fingerprint keys on `ticker`, so a CUSIP-only file event (no ticker resolved)
 * canNOT collide with a Plaid ticker event — asserted here so the boundary is
 * explicit, not a silent surprise.
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createMigratedPgliteDb } from "@/src/db/client";
import {
  createPortfolioRepository,
  type PortfolioRepository,
} from "@/src/db/repository";
import { parseOfxTransactions } from "@/src/domain/portfolio/parsers/portfolio-ofx";
import type { LedgerEventInput } from "@/src/domain/portfolio/schema/ledger-schema";

const MIGRATIONS_DIR = fileURLToPath(new URL("../src/db/migrations", import.meta.url));

let repo: PortfolioRepository;
beforeEach(async () => {
  repo = createPortfolioRepository(await createMigratedPgliteDb(new PGlite(), MIGRATIONS_DIR));
  await repo.upsertAccount({ id: "acc-1", userId: "devuser", name: "Taxable", type: "taxable" });
});

/** An OFX file with one resolvable buy: AAPL, 10 @ 150, 2026-01-05. */
const OFX_BUY = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVTRANLIST>
<BUYSTOCK><INVBUY><INVTRAN><FITID>FITID-1<DTTRADE>20260105</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><UNITS>10<UNITPRICE>150<TOTAL>-1500</INVBUY><BUYTYPE>BUY</BUYSTOCK>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1><SECLIST><STOCKINFO><SECINFO><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><TICKER>AAPL</SECINFO></STOCKINFO></SECLIST></SECLISTMSGSRSV1>
</OFX>`;

/** The same trade as a Plaid sync would present it (already canonical). */
function plaidBuy(ticker: string): LedgerEventInput {
  return {
    accountId: "acc-1",
    type: "buy",
    tradeDate: "2026-01-05",
    settleDate: "2026-01-07", // a non-fingerprinted field may legitimately differ
    ticker,
    quantity: 10,
    unitPrice: 150,
    amount: -1500,
    fee: null,
    currency: "USD",
    source: "plaid",
    externalId: "plaid-tx-1",
    description: "Plaid: bought AAPL",
    basisUnknown: null,
    proceedsUnknown: null,
  };
}

describe("cross-source dedup", () => {
  it("dedups the same trade arriving from a file and from Plaid (fingerprint collision)", async () => {
    // 1) The file backfill lands first.
    const parsed = await parseOfxTransactions(OFX_BUY);
    const fileEvents = parsed.events.map((e) => ({
      ...e,
      accountId: "acc-1",
      source: "file" as const,
    }));
    const fileReport = await repo.ingestLedgerEvents(fileEvents, "devuser");
    expect(fileReport.inserted).toBe(1);

    // 2) A Plaid sync over the overlapping window reports the same trade. Its
    //    (source, external_id) differs, so the partial unique index does NOT
    //    catch it — the CONTENT fingerprint must, because the file normalizer
    //    produced the identical canonical (date, type, ticker, qty, amount).
    const plaidReport = await repo.ingestLedgerEvents([plaidBuy("AAPL")], "devuser");
    expect(plaidReport.inserted).toBe(0);
    expect(plaidReport.deduplicated).toBe(1);

    expect(await repo.getLedger("devuser")).toHaveLength(1); // not double-counted
  });

  it("does NOT dedup when the file security is CUSIP-only (documented limitation)", async () => {
    // A file whose security has no ticker keys the event by its CUSIP; a Plaid
    // event keyed by the ticker has a different fingerprint, so both land. This
    // is the cost of best-effort ticker resolution — visible, not silent.
    const cusipOnlyFile = OFX_BUY.replace(/<SECLISTMSGSRSV1>[\s\S]*<\/SECLISTMSGSRSV1>/, "");
    const parsed = await parseOfxTransactions(cusipOnlyFile);
    expect(parsed.events[0].ticker).toBe("037833100"); // CUSIP fallback
    await repo.ingestLedgerEvents(
      parsed.events.map((e) => ({ ...e, accountId: "acc-1", source: "file" as const })),
      "devuser",
    );
    const plaidReport = await repo.ingestLedgerEvents([plaidBuy("AAPL")], "devuser");
    expect(plaidReport.inserted).toBe(1); // different ticker → different fingerprint
    expect(await repo.getLedger("devuser")).toHaveLength(2);
  });
});
