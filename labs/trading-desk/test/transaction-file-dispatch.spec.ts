/**
 * Unit tests for the transaction-file dispatcher (`detectAndParseTransactionFile`,
 * FIX-775 / FIX-895).
 *
 * Intent encoded — the dispatcher sniffs content (not extension) and routes to the
 * right parser, and every refusal is RENDERED (0 events + a diagnostic), never
 * thrown:
 *   1. OFX-family routing is unchanged by the FIX-895 CSV branch (regression).
 *   2. A tax-lot CSV routes to `parseTaxLotCsv` — unrealized and realized both map
 *      into the dispatcher's format label + events + diagnostics.
 *   3. A non-tax-lot, non-OFX file keeps the unrecognized-format error, now naming
 *      OFX or tax-lot CSV.
 *   4. A tax-lot-shaped file with invalid headers surfaces its reject reason as a
 *      document-level parse error.
 *   5. A holdings snapshot (caught only with row data) is a rendered refusal —
 *      0 events + a Holdings-CSV warning, not a crash.
 */
import { describe, expect, it } from "vitest";
import { detectAndParseTransactionFile } from "@/domain/portfolio/parsers/transaction-file";

/** A minimal QFX (1.x SGML) export: one buy that resolves to AAPL via SECLIST. */
const QFX_FILE = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD
<INVTRANLIST>
<BUYSTOCK><INVBUY><INVTRAN><FITID>BUY-AAPL-1<DTTRADE>20260105</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><UNITS>10<UNITPRICE>150.00<TOTAL>-1500.00</INVBUY><BUYTYPE>BUY</BUYSTOCK>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1><SECLIST><STOCKINFO><SECINFO><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><SECNAME>APPLE INC<TICKER>AAPL</SECINFO></STOCKINFO></SECLIST></SECLISTMSGSRSV1>
</OFX>`;

const UNREALIZED_HEADER = "symbol,quantity,costBasis,unitCost,openDate";
const REALIZED_HEADER =
  "symbol,quantity,costBasis,unitCost,openDate,closeDate,proceeds";

describe("detectAndParseTransactionFile — OFX routing (regression, unchanged)", () => {
  it("routes an OFX-family file to the OFX parser with its format label", async () => {
    const parsed = await detectAndParseTransactionFile(QFX_FILE, "export.qfx");
    expect(parsed.format).toBe("qfx");
    expect(parsed.diagnostics.parseErrors).toEqual([]);
    const buy = parsed.events.find((e) => e.type === "buy");
    expect(buy).toMatchObject({ ticker: "AAPL", quantity: 10, amount: -1500 });
  });
});

describe("detectAndParseTransactionFile — tax-lot CSV branch (FIX-895)", () => {
  it("routes an unrealized tax-lot CSV to its parser + format label", async () => {
    const csv = [UNREALIZED_HEADER, "AAPL,10,1500,150,2024-03-15"].join("\n");
    const parsed = await detectAndParseTransactionFile(csv, "lots.csv");

    expect(parsed.format).toBe("tax-lot-unrealized");
    expect(parsed.diagnostics.parseErrors).toEqual([]);
    // Empty unresolvedSecurities/skipped, like the OFX branch fills them.
    expect(parsed.diagnostics.unresolvedSecurities).toEqual([]);
    expect(parsed.diagnostics.skipped).toEqual([]);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({
      type: "buy",
      ticker: "AAPL",
      amount: -1500,
      lotKey: "taxlot:u:AAPL:2024-03-15:1",
    });
  });

  it("routes a realized tax-lot CSV to a linked buy+sell pair", async () => {
    const csv = [
      REALIZED_HEADER,
      "NVDA,4,400.00,100.00,2023-06-01,2024-07-01,900.00",
    ].join("\n");
    const parsed = await detectAndParseTransactionFile(csv, "realized.csv");

    expect(parsed.format).toBe("tax-lot-realized");
    expect(parsed.diagnostics.parseErrors).toEqual([]);
    const buy = parsed.events.find((e) => e.type === "buy");
    const sell = parsed.events.find((e) => e.type === "sell");
    expect(sell?.closesLotKey).toBe(buy?.lotKey);
  });

  it("keeps the unrecognized-format error (naming tax-lot CSV) for a non-tax-lot file", async () => {
    const parsed = await detectAndParseTransactionFile(
      "ticker,quantity\nAAPL,10",
      "trades.csv",
    );
    expect(parsed.format).toBe("unknown");
    expect(parsed.events).toEqual([]);
    expect(parsed.diagnostics.parseErrors).toHaveLength(1);
    expect(parsed.diagnostics.parseErrors[0]).toEqual({
      line: null,
      reason: expect.stringMatching(/OFX-family.*tax-lot CSV/i),
    });
  });

  it("surfaces a tax-lot header reject as a document-level parse error", async () => {
    // closeDate without proceeds → an intended realized export missing a column.
    const csv = "symbol,quantity,costBasis,unitCost,openDate,closeDate\nAAPL,4,400,100,2023-06-01,2024-07-01";
    const parsed = await detectAndParseTransactionFile(csv, "broken.csv");

    expect(parsed.format).toBe("unknown");
    expect(parsed.events).toEqual([]);
    expect(parsed.diagnostics.parseErrors).toHaveLength(1);
    expect(parsed.diagnostics.parseErrors[0].line).toBeNull();
    expect(parsed.diagnostics.parseErrors[0].reason).toMatch(/realized/i);
  });

  it("renders a holdings-snapshot refusal (0 events + warning), never a crash", async () => {
    // costBasis ≈ unitCost (per-share) on multi-share rows → holdings snapshot;
    // caught only with row data, so it comes back format:null + a warning.
    const csv = [
      UNREALIZED_HEADER,
      "AAPL,10,150,150,2024-03-15",
      "MSFT,20,300,300,2023-01-10",
    ].join("\n");
    const parsed = await detectAndParseTransactionFile(csv, "snapshot.csv");

    expect(parsed.format).toBe("unknown");
    expect(parsed.events).toEqual([]);
    expect(parsed.diagnostics.warnings[0]).toMatch(/holdings csv/i);
  });
});
