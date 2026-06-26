/**
 * Unit tests for the OFX-family parser (FIX-775).
 *
 * Intent encoded — these pin the one-parser hypothesis and the canonical
 * normalization the cross-source dedup contract depends on:
 *   1. QFX (1.x SGML), QBO (Intuit headers), and OFX 2.x XML all parse to the
 *      SAME canonical event shapes — one parser covers the family.
 *   2. Signs are normalized by aggregate TYPE (buy = +qty/−amount,
 *      sell = −qty/+amount), so a trade fingerprints identically regardless of
 *      the file's own sign convention.
 *   3. `SECID` → `SECLIST` ticker join; a CUSIP with no ticker is surfaced
 *      unresolved and the event keys by the CUSIP (never dropped).
 *   4. REINVEST becomes two events (the income + the reinvested buy/new lot).
 *   5. A transfer-in with no price is `basisUnknown` (never zero).
 *   6. Corporate actions (SPLIT/RETOFCAP) are skipped-with-warning, not ingested.
 *   7. FITID becomes the `externalId` (the dedup key).
 */
import { describe, expect, it } from "vitest";
import { parseOfxTransactions } from "@/src/flows/portfolio/portfolio-ofx";

/** A QFX (Quicken) export: 1.x SGML (unclosed leaf tags) + Intuit header, a buy
 *  with a commission, a dividend, and a SECLIST that resolves the ticker. */
const QFX_SGML = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
INTU.BID:01234

<OFX>
<INVSTMTMSGSRSV1><INVSTMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<INVSTMTRS>
<DTASOF>20260131<CURDEF>USD
<INVACCTFROM><BROKERID>fidelity.com<ACCTID>X999</INVACCTFROM>
<INVTRANLIST><DTSTART>20260101<DTEND>20260131
<BUYSTOCK><INVBUY><INVTRAN><FITID>BUY-AAPL-1<DTTRADE>20260105<DTSETTLE>20260107<MEMO>YOU BOUGHT</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><UNITS>10<UNITPRICE>150.00<COMMISSION>4.95<TOTAL>-1504.95</INVBUY><BUYTYPE>BUY</BUYSTOCK>
<INCOME><INVTRAN><FITID>DIV-AAPL-1<DTTRADE>20260120<MEMO>DIVIDEND</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><INCOMETYPE>DIV<TOTAL>23.45</INCOME>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1><SECLIST>
<STOCKINFO><SECINFO><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><SECNAME>APPLE INC<TICKER>AAPL</SECINFO></STOCKINFO>
</SECLIST></SECLISTMSGSRSV1>
</OFX>`;

/** The same two transactions as OFX 2.x XML (closed tags, PI header). */
const OFX_XML = `<?xml version="1.0" encoding="US-ASCII"?>
<?OFX OFXHEADER="200" VERSION="200" SECURITY="NONE" OLDFILEUID="NONE" NEWFILEUID="NONE"?>
<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><TRNUID>1</TRNUID><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS>
<INVSTMTRS><DTASOF>20260131</DTASOF><CURDEF>USD</CURDEF>
<INVACCTFROM><BROKERID>fidelity.com</BROKERID><ACCTID>X999</ACCTID></INVACCTFROM>
<INVTRANLIST><DTSTART>20260101</DTSTART><DTEND>20260131</DTEND>
<BUYSTOCK><INVBUY><INVTRAN><FITID>BUY-AAPL-1</FITID><DTTRADE>20260105</DTTRADE><DTSETTLE>20260107</DTSETTLE><MEMO>YOU BOUGHT</MEMO></INVTRAN><SECID><UNIQUEID>037833100</UNIQUEID><UNIQUEIDTYPE>CUSIP</UNIQUEIDTYPE></SECID><UNITS>10</UNITS><UNITPRICE>150.00</UNITPRICE><COMMISSION>4.95</COMMISSION><TOTAL>-1504.95</TOTAL></INVBUY><BUYTYPE>BUY</BUYTYPE></BUYSTOCK>
<INCOME><INVTRAN><FITID>DIV-AAPL-1</FITID><DTTRADE>20260120</DTTRADE><MEMO>DIVIDEND</MEMO></INVTRAN><SECID><UNIQUEID>037833100</UNIQUEID><UNIQUEIDTYPE>CUSIP</UNIQUEIDTYPE></SECID><INCOMETYPE>DIV</INCOMETYPE><TOTAL>23.45</TOTAL></INCOME>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1><SECLIST>
<STOCKINFO><SECINFO><SECID><UNIQUEID>037833100</UNIQUEID><UNIQUEIDTYPE>CUSIP</UNIQUEIDTYPE></SECID><SECNAME>APPLE INC</SECNAME><TICKER>AAPL</TICKER></SECINFO></STOCKINFO>
</SECLIST></SECLISTMSGSRSV1>
</OFX>`;

describe("parseOfxTransactions — one parser for the OFX family", () => {
  it("parses 1.x SGML (QFX) and 2.x XML to identical canonical events", async () => {
    const sgml = await parseOfxTransactions(QFX_SGML);
    const xml = await parseOfxTransactions(OFX_XML);

    for (const result of [sgml, xml]) {
      const buy = result.events.find((e) => e.type === "buy");
      expect(buy).toMatchObject({
        type: "buy",
        ticker: "AAPL",
        tradeDate: "2026-01-05",
        settleDate: "2026-01-07",
        quantity: 10,
        unitPrice: 150,
        amount: -1504.95, // signed: cash out
        fee: 4.95,
        externalId: "BUY-AAPL-1",
      });
      const div = result.events.find((e) => e.type === "dividend");
      expect(div).toMatchObject({
        type: "dividend",
        ticker: "AAPL",
        tradeDate: "2026-01-20",
        quantity: null,
        amount: 23.45, // cash in
        externalId: "DIV-AAPL-1",
      });
    }
    // Same canonical output from both encodings — the one-parser guarantee.
    expect(sgml.events).toEqual(xml.events);
  });
});

describe("parseOfxTransactions — sign normalization (by type)", () => {
  it("normalizes a sell to negative quantity / positive amount regardless of file sign", async () => {
    // Two files: one reports SELL UNITS negative (spec-correct), one positive
    // (a sloppy broker). Both must produce the identical canonical sell.
    const mk = (units: string, total: string) => `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVTRANLIST>
<SELLSTOCK><INVSELL><INVTRAN><FITID>S1<DTTRADE>20260110</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><UNITS>${units}<UNITPRICE>160<TOTAL>${total}</INVSELL><SELLTYPE>SELL</SELLSTOCK>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1><SECLIST><STOCKINFO><SECINFO><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><TICKER>AAPL</SECINFO></STOCKINFO></SECLIST></SECLISTMSGSRSV1></OFX>`;

    const negative = await parseOfxTransactions(mk("-4", "640"));
    const positive = await parseOfxTransactions(mk("4", "-640"));
    const expected = {
      type: "sell",
      ticker: "AAPL",
      quantity: -4,
      amount: 640,
    };
    expect(negative.events[0]).toMatchObject(expected);
    expect(positive.events[0]).toMatchObject(expected);
  });
});

describe("parseOfxTransactions — security resolution", () => {
  it("surfaces a CUSIP-only security as unresolved and keys the event by CUSIP", async () => {
    // No SECLIST → no ticker. The event keys by the CUSIP, and the CUSIP is
    // reported for manual mapping rather than silently dropped.
    const file = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVTRANLIST>
<BUYSTOCK><INVBUY><INVTRAN><FITID>B1<DTTRADE>20260105</INVTRAN><SECID><UNIQUEID>922908769<UNIQUEIDTYPE>CUSIP</SECID><UNITS>3<UNITPRICE>400<TOTAL>-1200</INVBUY><BUYTYPE>BUY</BUYSTOCK>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1></OFX>`;
    const result = await parseOfxTransactions(file);
    expect(result.events[0].ticker).toBe("922908769");
    expect(result.unresolvedSecurities).toEqual([{ cusip: "922908769", name: null }]);
  });
});

describe("parseOfxTransactions — REINVEST, transfers, corporate actions", () => {
  it("splits a REINVEST into a dividend and a reinvested buy with distinct external ids", async () => {
    const file = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVTRANLIST>
<REINVEST><INVTRAN><FITID>RI-1<DTTRADE>20260215</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><INCOMETYPE>DIV<UNITS>0.5<UNITPRICE>200<TOTAL>-100</REINVEST>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1><SECLIST><STOCKINFO><SECINFO><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><TICKER>AAPL</SECINFO></STOCKINFO></SECLIST></SECLISTMSGSRSV1></OFX>`;
    const result = await parseOfxTransactions(file);
    const div = result.events.find((e) => e.type === "dividend");
    const buy = result.events.find((e) => e.type === "buy");
    expect(div).toMatchObject({ ticker: "AAPL", amount: 100, externalId: "RI-1:div" });
    expect(buy).toMatchObject({ ticker: "AAPL", quantity: 0.5, amount: -100, externalId: "RI-1" });
  });

  it("flags a transfer-in as basis-unknown (never zero cost)", async () => {
    const file = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVTRANLIST>
<TRANSFER><INVTRAN><FITID>T1<DTTRADE>20260301</INVTRAN><SECID><UNIQUEID>88160R101<UNIQUEIDTYPE>CUSIP</SECID><SUBACCTSEC>CASH<UNITS>12<TFERACTION>IN<POSTYPE>LONG</TRANSFER>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1><SECLIST><STOCKINFO><SECINFO><SECID><UNIQUEID>88160R101<UNIQUEIDTYPE>CUSIP</SECID><TICKER>TSLA</SECINFO></STOCKINFO></SECLIST></SECLISTMSGSRSV1></OFX>`;
    const result = await parseOfxTransactions(file);
    expect(result.events[0]).toMatchObject({
      type: "transfer",
      ticker: "TSLA",
      quantity: 12,
      unitPrice: null,
    });
    expect(result.events[0].basisUnknown).toMatch(/no acquisition cost/);
  });

  it("preserves a broker-supplied cost basis on a transfer-in (known lot, not basis-unknown)", async () => {
    const file = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVTRANLIST>
<TRANSFER><INVTRAN><FITID>T2<DTTRADE>20260301</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><UNITS>10<TFERACTION>IN<POSTYPE>LONG<AVGCOSTBASIS>1500<UNITPRICE>150</TRANSFER>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1><SECLIST><STOCKINFO><SECINFO><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><TICKER>AAPL</SECINFO></STOCKINFO></SECLIST></SECLISTMSGSRSV1></OFX>`;
    const result = await parseOfxTransactions(file);
    expect(result.events[0]).toMatchObject({ type: "transfer", quantity: 10, unitPrice: 150 });
    expect(result.events[0].basisUnknown).toBeNull(); // basis supplied → known lot
  });

  it("skips a short sale (SELLSHORT) rather than emitting a phantom long-sell", async () => {
    const file = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVTRANLIST>
<SELLSTOCK><INVSELL><INVTRAN><FITID>SS1<DTTRADE>20260110</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><UNITS>-5<UNITPRICE>150<TOTAL>750</INVSELL><SELLTYPE>SELLSHORT</SELLSTOCK>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1></OFX>`;
    const result = await parseOfxTransactions(file);
    expect(result.events).toHaveLength(0);
    expect(result.warnings.some((w) => /short sale/i.test(w))).toBe(true);
  });

  it("skips a JRNLSEC (subaccount journal) instead of booking a phantom transfer-in", async () => {
    const file = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVTRANLIST>
<JRNLSEC><INVTRAN><FITID>J1<DTTRADE>20260301</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><SUBACCTFROM>MARGIN<SUBACCTTO>CASH<UNITS>10</JRNLSEC>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1></OFX>`;
    const result = await parseOfxTransactions(file);
    expect(result.events).toHaveLength(0); // no phantom transfer-in
    expect(result.skipped.some((s) => s.kind === "JRNLSEC")).toBe(true);
  });

  it("skips a SPLIT with a warning instead of corrupting basis", async () => {
    const file = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVTRANLIST>
<SPLIT><INVTRAN><FITID>SP1<DTTRADE>20260401</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><OLDUNITS>10<NEWUNITS>40<NUMERATOR>4<DENOMINATOR>1</SPLIT>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1></OFX>`;
    const result = await parseOfxTransactions(file);
    expect(result.events).toHaveLength(0);
    expect(result.skipped).toEqual([
      { kind: "SPLIT", reason: expect.stringContaining("not imported") },
    ]);
  });
});

describe("parseOfxTransactions — cash + robustness", () => {
  it("maps an INVBANKTRAN to a cash event by its TRNTYPE, preserving sign", async () => {
    const file = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVTRANLIST>
<INVBANKTRAN><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260103<TRNAMT>5000<FITID>CASH-1<NAME>ACH DEPOSIT</STMTTRN><SUBACCTFUND>CASH</INVBANKTRAN>
<INVBANKTRAN><STMTTRN><TRNTYPE>INT<DTPOSTED>20260131<TRNAMT>1.23<FITID>CASH-2<NAME>INTEREST</STMTTRN><SUBACCTFUND>CASH</INVBANKTRAN>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1></OFX>`;
    const result = await parseOfxTransactions(file);
    expect(result.events.find((e) => e.externalId === "CASH-1")).toMatchObject({
      type: "deposit",
      amount: 5000,
      ticker: null,
      tradeDate: "2026-01-03",
    });
    expect(result.events.find((e) => e.externalId === "CASH-2")).toMatchObject({
      type: "interest",
      amount: 1.23,
    });
  });

  it("warns on an unhandled aggregate rather than dropping it silently", async () => {
    const file = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVTRANLIST>
<CLOSUREOPT><INVTRAN><FITID>X1<DTTRADE>20260101</INVTRAN><SECID><UNIQUEID>1<UNIQUEIDTYPE>CUSIP</SECID><OPTACTION>EXERCISE<UNITS>1<SHPERCTRCT>100</CLOSUREOPT>
<FUTURESOMETHING><INVTRAN><FITID>F1</INVTRAN></FUTURESOMETHING>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1></OFX>`;
    const result = await parseOfxTransactions(file);
    // CLOSUREOPT is a known skip; the made-up tag is an unhandled warning.
    expect(result.skipped.some((s) => s.kind === "CLOSUREOPT")).toBe(true);
    expect(result.warnings.some((w) => w.includes("FUTURESOMETHING"))).toBe(true);
  });

  it("throws on a non-OFX document", async () => {
    await expect(parseOfxTransactions("ticker,quantity\nAAPL,10")).rejects.toThrow(/OFX/);
  });
});

describe("parseOfxTransactions — canonical-amount + sign edge cases", () => {
  it("folds the fee into amount when a buy reports no TOTAL (dedup consistency)", async () => {
    // No TOTAL: amount must be the all-in cash (units*price + commission), the
    // same as a broker that DID populate TOTAL — else the fingerprint diverges.
    const file = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVTRANLIST>
<BUYSTOCK><INVBUY><INVTRAN><FITID>B1<DTTRADE>20260105</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><UNITS>10<UNITPRICE>150<COMMISSION>5</INVBUY><BUYTYPE>BUY</BUYSTOCK>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1><SECLIST><STOCKINFO><SECINFO><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><TICKER>AAPL</SECINFO></STOCKINFO></SECLIST></SECLISTMSGSRSV1></OFX>`;
    const result = await parseOfxTransactions(file);
    expect(result.events[0]).toMatchObject({ amount: -1505, fee: 5 }); // 10*150 + 5
  });

  it("preserves a negative INCOME (a dividend reversal), never abs() into a phantom credit", async () => {
    const file = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVTRANLIST>
<INCOME><INVTRAN><FITID>D1<DTTRADE>20260120<MEMO>DIVIDEND REVERSAL</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><INCOMETYPE>DIV<TOTAL>-23.45</INCOME>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1><SECLIST><STOCKINFO><SECINFO><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><TICKER>AAPL</SECINFO></STOCKINFO></SECLIST></SECLISTMSGSRSV1></OFX>`;
    const result = await parseOfxTransactions(file);
    expect(result.events[0]).toMatchObject({ type: "dividend", amount: -23.45 });
  });

  it("skips a transaction with no usable date (never dates it to the epoch)", async () => {
    // No DTTRADE and no DTPOSTED: the event must be skipped + warned, not
    // ingested under 1970 where it would corrupt FIFO order and acquired-date.
    const file = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVTRANLIST>
<BUYSTOCK><INVBUY><INVTRAN><FITID>NODATE</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><UNITS>10<UNITPRICE>150<TOTAL>-1500</INVBUY><BUYTYPE>BUY</BUYSTOCK>
<BUYSTOCK><INVBUY><INVTRAN><FITID>OK<DTTRADE>20260105</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><UNITS>5<UNITPRICE>160<TOTAL>-800</INVBUY><BUYTYPE>BUY</BUYSTOCK>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1><SECLIST><STOCKINFO><SECINFO><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><TICKER>AAPL</SECINFO></STOCKINFO></SECLIST></SECLISTMSGSRSV1></OFX>`;
    const result = await parseOfxTransactions(file);
    // Only the dated buy survives; none carries the epoch date.
    expect(result.events).toHaveLength(1);
    expect(result.events[0].externalId).toBe("OK");
    expect(result.events.some((e) => e.tradeDate === "1970-01-01")).toBe(false);
    expect(result.warnings.some((w) => w.includes("NODATE") && /trade date/i.test(w))).toBe(true);
  });

  it("warns when a file spans multiple accounts (all land in the one selected account)", async () => {
    const file = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1>
<INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVACCTFROM><ACCTID>ACCT-A</INVACCTFROM><INVTRANLIST><BUYSTOCK><INVBUY><INVTRAN><FITID>A<DTTRADE>20260105</INVTRAN><SECID><UNIQUEID>1<UNIQUEIDTYPE>CUSIP</SECID><UNITS>1<UNITPRICE>1<TOTAL>-1</INVBUY><BUYTYPE>BUY</BUYSTOCK></INVTRANLIST></INVSTMTRS></INVSTMTTRNRS>
<INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVACCTFROM><ACCTID>ACCT-B</INVACCTFROM><INVTRANLIST><BUYSTOCK><INVBUY><INVTRAN><FITID>B<DTTRADE>20260106</INVTRAN><SECID><UNIQUEID>2<UNIQUEIDTYPE>CUSIP</SECID><UNITS>2<UNITPRICE>2<TOTAL>-4</INVBUY><BUYTYPE>BUY</BUYSTOCK></INVTRANLIST></INVSTMTRS></INVSTMTTRNRS>
</INVSTMTMSGSRSV1></OFX>`;
    const result = await parseOfxTransactions(file);
    // Refused, not merged: a consolidated multi-account file imports nothing
    // (mis-attribution + account-scoped FITID dedup would lose data).
    expect(result.events).toHaveLength(0);
    expect(
      result.warnings.some(
        (w) => w.includes("ACCT-A") && w.includes("ACCT-B") && /Nothing was imported/i.test(w),
      ),
    ).toBe(true);
  });

  it("skips a calendar-invalid date (e.g. month 13) rather than passing 2026-13-40 to the DB", async () => {
    const file = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVTRANLIST>
<BUYSTOCK><INVBUY><INVTRAN><FITID>BAD<DTTRADE>20261340</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><UNITS>1<UNITPRICE>1<TOTAL>-1</INVBUY><BUYTYPE>BUY</BUYSTOCK>
<BUYSTOCK><INVBUY><INVTRAN><FITID>OK<DTTRADE>20260105</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><UNITS>5<UNITPRICE>160<TOTAL>-800</INVBUY><BUYTYPE>BUY</BUYSTOCK>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1><SECLIST><STOCKINFO><SECINFO><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><TICKER>AAPL</SECINFO></STOCKINFO></SECLIST></SECLISTMSGSRSV1></OFX>`;
    const result = await parseOfxTransactions(file);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].externalId).toBe("OK");
    expect(result.warnings.some((w) => w.includes("BAD"))).toBe(true);
  });

  it("flags a buy with no price and no total as basis-unknown (no phantom fee-derived cost)", async () => {
    const file = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVTRANLIST>
<BUYSTOCK><INVBUY><INVTRAN><FITID>NP1<DTTRADE>20260105</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><UNITS>10<COMMISSION>5</INVBUY><BUYTYPE>BUY</BUYSTOCK>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1><SECLIST><STOCKINFO><SECINFO><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><TICKER>AAPL</SECINFO></STOCKINFO></SECLIST></SECLISTMSGSRSV1></OFX>`;
    const result = await parseOfxTransactions(file);
    expect(result.events[0]).toMatchObject({ type: "buy", quantity: 10, unitPrice: null });
    expect(result.events[0].basisUnknown).toMatch(/no price or total/);
  });
});
