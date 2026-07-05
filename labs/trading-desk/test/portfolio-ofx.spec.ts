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
        // basis-per-share is ALL-IN (execution price + commission): |amount|/units
        // = 1504.95 / 10, NOT the raw UNITPRICE 150 — a commissioned buy's lot cost
        // must include the commission or `deriveLots` understates basis.
        unitPrice: 150.495,
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

  it("preserves a broker-supplied cost basis from UNITPRICE on a transfer-in (known lot)", async () => {
    const file = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVTRANLIST>
<TRANSFER><INVTRAN><FITID>T2<DTTRADE>20260301</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><UNITS>10<TFERACTION>IN<POSTYPE>LONG<AVGCOSTBASIS>1500<UNITPRICE>150</TRANSFER>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1><SECLIST><STOCKINFO><SECINFO><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><TICKER>AAPL</SECINFO></STOCKINFO></SECLIST></SECLISTMSGSRSV1></OFX>`;
    const result = await parseOfxTransactions(file);
    expect(result.events[0]).toMatchObject({ type: "transfer", quantity: 10, unitPrice: 150 });
    expect(result.events[0].basisUnknown).toBeNull(); // UNITPRICE supplied → known lot
  });

  it("leaves a transfer-in basis-unknown when only AVGCOSTBASIS is present (ambiguous unit convention, never guessed)", async () => {
    // AVGCOSTBASIS is total-dollars in some OFX versions and per-share in others;
    // deriving a per-share cost from it would be a silent order-of-magnitude error,
    // so with no unambiguous UNITPRICE the lot is basis-unknown, not a guess.
    const file = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVTRANLIST>
<TRANSFER><INVTRAN><FITID>T3<DTTRADE>20260301</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><UNITS>10<TFERACTION>IN<POSTYPE>LONG<AVGCOSTBASIS>1500</TRANSFER>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1><SECLIST><STOCKINFO><SECINFO><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><TICKER>AAPL</SECINFO></STOCKINFO></SECLIST></SECLISTMSGSRSV1></OFX>`;
    const result = await parseOfxTransactions(file);
    expect(result.events[0]).toMatchObject({ type: "transfer", quantity: 10, unitPrice: null });
    expect(result.events[0].basisUnknown).toMatch(/no acquisition cost/);
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
    expect(result.warnings.some((w) => /SELLSHORT/i.test(w))).toBe(true);
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

  it("parses a namespaced/attributed 2.x root (<OFX xmlns=...>) to real events", async () => {
    // A conformant 2.x export can namespace the root. `ofx-js` can't tokenize an
    // attributed root (it returns OFX as the string "undefined", zero events), so
    // the parser strips the root tag's attributes before handing it over. Without
    // that, this buy would silently vanish.
    const file = `<?xml version="1.0" encoding="US-ASCII"?>
<?OFX OFXHEADER="200" VERSION="200"?>
<OFX xmlns="http://ofx.net/types/2003/04" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD</CURDEF>
<INVACCTFROM><ACCTID>X999</ACCTID></INVACCTFROM><INVTRANLIST>
<BUYSTOCK><INVBUY><INVTRAN><FITID>NS1</FITID><DTTRADE>20260105</DTTRADE></INVTRAN><SECID><UNIQUEID>037833100</UNIQUEID><UNIQUEIDTYPE>CUSIP</UNIQUEIDTYPE></SECID><UNITS>10</UNITS><UNITPRICE>150</UNITPRICE><TOTAL>-1500</TOTAL></INVBUY><BUYTYPE>BUY</BUYTYPE></BUYSTOCK>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1><SECLIST><STOCKINFO><SECINFO><SECID><UNIQUEID>037833100</UNIQUEID><UNIQUEIDTYPE>CUSIP</UNIQUEIDTYPE></SECID><TICKER>AAPL</TICKER></SECINFO></STOCKINFO></SECLIST></SECLISTMSGSRSV1>
</OFX>`;
    const result = await parseOfxTransactions(file);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ type: "buy", ticker: "AAPL", externalId: "NS1" });
  });
});

describe("parseOfxTransactions — malformed-leg guards", () => {
  const wrap = (body: string) => `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVTRANLIST>
${body}
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1><SECLIST><STOCKINFO><SECINFO><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><TICKER>AAPL</SECINFO></STOCKINFO></SECLIST></SECLISTMSGSRSV1></OFX>`;

  it("skips a buy missing its security or unit count", async () => {
    // No SECID, no UNITS.
    const result = await parseOfxTransactions(
      wrap(
        "<BUYSTOCK><INVBUY><INVTRAN><FITID>B<DTTRADE>20260105</INVTRAN><TOTAL>-100</INVBUY><BUYTYPE>BUY</BUYSTOCK>",
      ),
    );
    expect(result.events).toHaveLength(0);
    expect(result.warnings.some((w) => /missing its security or unit count/i.test(w))).toBe(true);
  });

  it("records a sell with no proceeds data but warns (the disposal still happened)", async () => {
    const result = await parseOfxTransactions(
      wrap(
        "<SELLSTOCK><INVSELL><INVTRAN><FITID>S<DTTRADE>20260110</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><UNITS>-5</INVSELL><SELLTYPE>SELL</SELLSTOCK>",
      ),
    );
    expect(result.events[0]).toMatchObject({ type: "sell", quantity: -5 });
    expect(result.warnings.some((w) => /proceeds are unknown/i.test(w))).toBe(true);
  });

  it("derives a REINVEST amount from units × price when TOTAL is absent", async () => {
    const result = await parseOfxTransactions(
      wrap(
        "<REINVEST><INVTRAN><FITID>RI<DTTRADE>20260215</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><INCOMETYPE>DIV<UNITS>0.5<UNITPRICE>200</REINVEST>",
      ),
    );
    expect(result.events.find((e) => e.type === "dividend")?.amount).toBe(100); // 0.5 * 200
    expect(result.events.find((e) => e.type === "buy")?.amount).toBe(-100);
  });

  it("skips a transfer whose direction (TFERACTION) is missing/unknown", async () => {
    const result = await parseOfxTransactions(
      wrap(
        "<TRANSFER><INVTRAN><FITID>T<DTTRADE>20260301</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><UNITS>10</TRANSFER>",
      ),
    );
    expect(result.events).toHaveLength(0);
    expect(result.warnings.some((w) => /unknown direction/i.test(w))).toBe(true);
  });

  it("normalizes a blank FITID to a null externalId (so blank-id rows dedup by fingerprint)", async () => {
    // Two distinct buys, both with an empty <FITID></FITID> (ofx-js parses an
    // empty XML leaf to ""). A blank id must NOT become externalId "" — that
    // would collide on (account, source, externalId) and drop the second buy.
    // Null lets each dedup by its own fingerprint. (Written as 2.x XML because
    // SGML can't tokenize a zero-length leaf tag.)
    const file = `<?xml version="1.0"?>
<?OFX OFXHEADER="200" VERSION="200"?>
<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD</CURDEF>
<INVACCTFROM><ACCTID>X</ACCTID></INVACCTFROM><INVTRANLIST>
<BUYSTOCK><INVBUY><INVTRAN><FITID></FITID><DTTRADE>20260105</DTTRADE></INVTRAN><SECID><UNIQUEID>037833100</UNIQUEID><UNIQUEIDTYPE>CUSIP</UNIQUEIDTYPE></SECID><UNITS>10</UNITS><UNITPRICE>150</UNITPRICE><TOTAL>-1500</TOTAL></INVBUY><BUYTYPE>BUY</BUYTYPE></BUYSTOCK>
<BUYSTOCK><INVBUY><INVTRAN><FITID></FITID><DTTRADE>20260106</DTTRADE></INVTRAN><SECID><UNIQUEID>037833100</UNIQUEID><UNIQUEIDTYPE>CUSIP</UNIQUEIDTYPE></SECID><UNITS>5</UNITS><UNITPRICE>160</UNITPRICE><TOTAL>-800</TOTAL></INVBUY><BUYTYPE>BUY</BUYTYPE></BUYSTOCK>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1></OFX>`;
    const result = await parseOfxTransactions(file);
    expect(result.events).toHaveLength(2);
    expect(result.events.every((e) => e.externalId === null)).toBe(true);
  });

  it("skips an INCOME row with no amount (TOTAL) instead of recording a phantom $0 dividend", async () => {
    // A $0 dividend understates history AND, with a FITID, would dedup away a
    // later corrected re-import on the external-id index.
    const result = await parseOfxTransactions(
      wrap(
        "<INCOME><INVTRAN><FITID>DIV-NOAMT<DTTRADE>20260120</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><INCOMETYPE>DIV</INCOME>",
      ),
    );
    expect(result.events).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("DIV-NOAMT") && /no amount/i.test(w))).toBe(true);
  });

  it("skips an INVBANKTRAN with no amount (TRNAMT) instead of materializing a $0 cash event", async () => {
    const result = await parseOfxTransactions(
      wrap(
        "<INVBANKTRAN><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260103<FITID>CASH-NOAMT<NAME>ACH</STMTTRN><SUBACCTFUND>CASH</INVBANKTRAN>",
      ),
    );
    expect(result.events).toHaveLength(0);
    expect(result.warnings.some((w) => w.includes("CASH-NOAMT") && /no amount/i.test(w))).toBe(
      true,
    );
  });

  it("skips an option sell (SELLOPT) wholesale — the contract multiplier + short legs aren't modeled in v1", async () => {
    const result = await parseOfxTransactions(
      wrap(
        "<SELLOPT><INVSELL><INVTRAN><FITID>SO1<DTTRADE>20260110</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><UNITS>-1<UNITPRICE>2.5<TOTAL>250</INVSELL><OPTSELLTYPE>SELLTOOPEN<SHPERCTRCT>100</SELLOPT>",
      ),
    );
    // Options never reach the equity path (which would store the per-share premium
    // as basis and ignore SHPERCTRCT, a ~100× error) — surfaced in `skipped`.
    expect(result.events).toHaveLength(0);
    expect(result.skipped.some((s) => s.kind === "SELLOPT")).toBe(true);
  });

  it("floors a no-proceeds sell with a fee at 0 (never a negative sell amount)", async () => {
    // No TOTAL, no UNITPRICE, but a COMMISSION: units*0 − fee = −fee. A negative
    // sell proceeds is impossible canonically and breaks cross-source dedup —
    // it must floor at 0.
    const result = await parseOfxTransactions(
      wrap(
        "<SELLSTOCK><INVSELL><INVTRAN><FITID>SF1<DTTRADE>20260110</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><UNITS>-5<COMMISSION>5</INVSELL><SELLTYPE>SELL</SELLSTOCK>",
      ),
    );
    expect(result.events[0]).toMatchObject({ type: "sell", quantity: -5, amount: 0 });
    expect(result.warnings.some((w) => /proceeds are unknown/i.test(w))).toBe(true);
  });

  it("skips a REINVEST with neither cash (TOTAL) nor price (UNITPRICE) — no $0 phantom DRIP", async () => {
    const result = await parseOfxTransactions(
      wrap(
        "<REINVEST><INVTRAN><FITID>RI-NOAMT<DTTRADE>20260215</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><INCOMETYPE>DIV<UNITS>0.5</REINVEST>",
      ),
    );
    expect(result.events).toHaveLength(0);
    expect(
      result.warnings.some((w) => w.includes("RI-NOAMT") && /no amount or price/i.test(w)),
    ).toBe(true);
  });

  it("skips an option buy (BUYOPT) wholesale — the contract multiplier + short legs aren't modeled in v1", async () => {
    const result = await parseOfxTransactions(
      wrap(
        "<BUYOPT><INVBUY><INVTRAN><FITID>BC1<DTTRADE>20260110</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><UNITS>1<UNITPRICE>2.5<TOTAL>-250</INVBUY><OPTBUYTYPE>BUYTOCLOSE<SHPERCTRCT>100</BUYOPT>",
      ),
    );
    expect(result.events).toHaveLength(0);
    expect(result.skipped.some((s) => s.kind === "BUYOPT")).toBe(true);
  });

  it("skips a REINVEST reversal (negative UNITS) instead of abs()-ing it into a phantom DRIP", async () => {
    // A DRIP correction/reversal exports as REINVEST with negative units. abs()
    // would grow shares + income instead of undoing them; v1 doesn't model
    // reversals, so it's skipped with a warning (not a phantom dividend + buy).
    const result = await parseOfxTransactions(
      wrap(
        "<REINVEST><INVTRAN><FITID>RI-REV<DTTRADE>20260215</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><INCOMETYPE>DIV<UNITS>-0.5<UNITPRICE>200<TOTAL>100</REINVEST>",
      ),
    );
    expect(result.events).toHaveLength(0);
    expect(
      result.warnings.some((w) => w.includes("RI-REV") && /reversal/i.test(w)),
    ).toBe(true);
  });

  it("records reinvested interest (REINVEST INCOMETYPE=INTEREST) as interest, not dividend", async () => {
    const result = await parseOfxTransactions(
      wrap(
        "<REINVEST><INVTRAN><FITID>RI-INT<DTTRADE>20260215</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><INCOMETYPE>INTEREST<UNITS>1<UNITPRICE>100<TOTAL>-100</REINVEST>",
      ),
    );
    // The income leg is interest; the paired reinvested buy still lands.
    expect(result.events.find((e) => e.externalId === "RI-INT:div")?.type).toBe("interest");
    expect(result.events.find((e) => e.type === "buy")?.quantity).toBe(1);
  });

  it("skips a short-position transfer (POSTYPE=SHORT) — long-only FIFO can't model it", async () => {
    const result = await parseOfxTransactions(
      wrap(
        "<TRANSFER><INVTRAN><FITID>TS1<DTTRADE>20260301</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><UNITS>10<TFERACTION>IN<POSTYPE>SHORT</TRANSFER>",
      ),
    );
    expect(result.events).toHaveLength(0);
    expect(result.warnings.some((w) => /short position/i.test(w))).toBe(true);
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
    // amount is the all-in cash, and unitPrice is the all-in basis-per-share
    // (1505/10 = 150.5), matching the TOTAL-present path so the two fingerprint
    // identically.
    expect(result.events[0]).toMatchObject({ amount: -1505, fee: 5, unitPrice: 150.5 });
  });

  it("folds the commission into unitPrice (basis-per-share) on a buy that DOES report TOTAL", async () => {
    // OFX TOTAL is net of commission; the lot's cost basis `deriveLots` reads is
    // `unitPrice`, so a commissioned buy must carry the all-in |TOTAL|/units, not
    // the raw execution UNITPRICE — else basis understates by the commission.
    const file = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1><INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVTRANLIST>
<BUYSTOCK><INVBUY><INVTRAN><FITID>B1<DTTRADE>20260105</INVTRAN><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><UNITS>10<UNITPRICE>150<COMMISSION>4.95<TOTAL>-1504.95</INVBUY><BUYTYPE>BUY</BUYSTOCK>
</INVTRANLIST></INVSTMTRS></INVSTMTTRNRS></INVSTMTMSGSRSV1>
<SECLISTMSGSRSV1><SECLIST><STOCKINFO><SECINFO><SECID><UNIQUEID>037833100<UNIQUEIDTYPE>CUSIP</SECID><TICKER>AAPL</SECINFO></STOCKINFO></SECLIST></SECLISTMSGSRSV1></OFX>`;
    const result = await parseOfxTransactions(file);
    // 1504.95 / 10 = 150.495 (execution 150 + 0.495/share commission), NOT 150.
    expect(result.events[0]).toMatchObject({ amount: -1504.95, fee: 4.95, unitPrice: 150.495 });
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

  it("refuses a multi-account file (nothing imported, with a warning)", async () => {
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

  it("imports split-statement blocks that repeat the SAME account id (not a multi-account refusal)", async () => {
    // Two INVSTMTRS blocks, ONE account (ACCT-A) — a split statement response.
    // No cross-account attribution risk, so both buys import (distinct-account
    // count is 1, not 2).
    const file = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX><INVSTMTMSGSRSV1>
<INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVACCTFROM><ACCTID>ACCT-A</INVACCTFROM><INVTRANLIST><BUYSTOCK><INVBUY><INVTRAN><FITID>A1<DTTRADE>20260105</INVTRAN><SECID><UNIQUEID>1<UNIQUEIDTYPE>CUSIP</SECID><UNITS>1<UNITPRICE>1<TOTAL>-1</INVBUY><BUYTYPE>BUY</BUYSTOCK></INVTRANLIST></INVSTMTRS></INVSTMTTRNRS>
<INVSTMTTRNRS><INVSTMTRS><CURDEF>USD<INVACCTFROM><ACCTID>ACCT-A</INVACCTFROM><INVTRANLIST><BUYSTOCK><INVBUY><INVTRAN><FITID>A2<DTTRADE>20260106</INVTRAN><SECID><UNIQUEID>2<UNIQUEIDTYPE>CUSIP</SECID><UNITS>2<UNITPRICE>2<TOTAL>-4</INVBUY><BUYTYPE>BUY</BUYSTOCK></INVTRANLIST></INVSTMTRS></INVSTMTTRNRS>
</INVSTMTMSGSRSV1></OFX>`;
    const result = await parseOfxTransactions(file);
    expect(result.events).toHaveLength(2);
    expect(result.events.map((e) => e.externalId).sort()).toEqual(["A1", "A2"]);
    expect(result.warnings.some((w) => /Nothing was imported/i.test(w))).toBe(false);
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
