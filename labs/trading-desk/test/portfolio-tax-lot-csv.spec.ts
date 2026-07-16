/**
 * Unit tests for the tax-lot CSV parser (FIX-895).
 *
 * These pin the real-money intent, not just behavior:
 *   1. An unrealized row becomes one buy whose amount is the lot TOTAL (not
 *      per-share) and whose unitPrice is derived from that total — misreading the
 *      basis convention is the exact corruption the format guards against.
 *   2. A realized row becomes a LINKED buy+sell pair — the sell's `closesLotKey`
 *      equals its buy's `lotKey`, so `deriveLots` consumes the specific broker-
 *      matched lot instead of a FIFO guess.
 *   3. `seq`/`lotKey` are a function of the row SET, not the file order — a
 *      reordered re-export dedups instead of doubling the position.
 *   4. Honest gaps: blank basis / proceeds are kept with markers, never dropped;
 *      only a missing symbol/qty/own-date makes a row unrepresentable.
 *   5. Ticker is canonicalized (upper-case) before BOTH the event ticker and the
 *      lotKey; options are refused; foreign currency is rejected against the
 *      account, never silently defaulted to USD.
 */
import { describe, expect, it } from "vitest";
import {
  detectTaxLotCsv,
  parseTaxLotCsv,
} from "@/domain/portfolio/parsers/portfolio-tax-lot-csv";

const UNREALIZED_HEADER = "symbol,quantity,costBasis,unitCost,openDate";
const REALIZED_HEADER =
  "symbol,quantity,costBasis,unitCost,openDate,closeDate,proceeds";

describe("parseTaxLotCsv — unrealized", () => {
  it("synthesizes one buy per row with the lot TOTAL as the amount", () => {
    const csv = [UNREALIZED_HEADER, "AAPL,10,1500.00,150.00,2024-03-15"].join("\n");
    const result = parseTaxLotCsv(csv);

    expect(result.format).toBe("tax-lot-unrealized");
    expect(result.parseErrors).toEqual([]);
    expect(result.events).toHaveLength(1);
    const buy = result.events[0];
    expect(buy).toMatchObject({
      type: "buy",
      ticker: "AAPL",
      tradeDate: "2024-03-15",
      quantity: 10,
      // unitPrice is derived from the authoritative lot total, NOT the broker
      // unitCost — |costBasis|/qty.
      unitPrice: 150,
      amount: -1500,
      basisUnknown: null,
      closesLotKey: null,
    });
    // lotKey is assigned + used as the externalId (same-file re-import dedup).
    expect(buy.lotKey).toBe("taxlot:u:AAPL:2024-03-15:1");
    expect(buy.externalId).toBe("taxlot:u:AAPL:2024-03-15:1");
  });

  it("derives unitPrice from the lot total, not a rounded broker unitCost", () => {
    // costBasis / qty = 1000.05 / 3 = 333.35, whereas the broker unitCost is a
    // rounded 333.00 — the buy must use the total-derived figure.
    const csv = [UNREALIZED_HEADER, "MSFT,3,1000.05,333.00,2023-01-10"].join("\n");
    const buy = parseTaxLotCsv(csv).events[0];
    expect(buy.amount).toBe(-1000.05);
    expect(buy.unitPrice).toBeCloseTo(333.35, 8);
  });

  it("canonicalizes a mixed-case symbol before BOTH the ticker and the lotKey", () => {
    const csv = [UNREALIZED_HEADER, "aapl,5,500,100,2024-01-02"].join("\n");
    const buy = parseTaxLotCsv(csv).events[0];
    expect(buy.ticker).toBe("AAPL");
    expect(buy.lotKey).toBe("taxlot:u:AAPL:2024-01-02:1");
  });
});

describe("parseTaxLotCsv — realized", () => {
  it("synthesizes a linked buy+sell pair; the sell closes its own lot", () => {
    const csv = [
      REALIZED_HEADER,
      "NVDA,4,400.00,100.00,2023-06-01,2024-07-01,900.00",
    ].join("\n");
    const result = parseTaxLotCsv(csv);

    expect(result.format).toBe("tax-lot-realized");
    expect(result.events).toHaveLength(2);
    const buy = result.events.find((e) => e.type === "buy");
    const sell = result.events.find((e) => e.type === "sell");

    const lotKey = "taxlot:r:NVDA:2023-06-01:2024-07-01:1";
    expect(buy).toMatchObject({
      type: "buy",
      tradeDate: "2023-06-01",
      quantity: 4,
      amount: -400,
      lotKey,
      externalId: lotKey,
      closesLotKey: null,
    });
    expect(sell).toMatchObject({
      type: "sell",
      tradeDate: "2024-07-01",
      quantity: -4,
      amount: 900,
      lotKey: null,
      closesLotKey: lotKey,
      externalId: `${lotKey}#d`,
    });
  });

  it("rejects a close-before-open row but allows same-day acquire+sell", () => {
    const csv = [
      REALIZED_HEADER,
      "TSLA,1,100,100,2024-05-10,2024-05-09,120", // close < open → rejected
      "TSLA,1,100,100,2024-05-10,2024-05-10,120", // same-day → allowed
    ].join("\n");
    const result = parseTaxLotCsv(csv);
    expect(result.parseErrors).toHaveLength(1);
    expect(result.parseErrors[0].line).toBe(2);
    // only the same-day row survives → one buy + one sell
    expect(result.events).toHaveLength(2);
  });
});

describe("parseTaxLotCsv — seq / lotKey are content-ordered", () => {
  it("gives two genuinely-identical lots distinct seq and lands both", () => {
    const csv = [
      UNREALIZED_HEADER,
      "AAPL,10,1500,150,2024-03-15",
      "AAPL,10,1500,150,2024-03-15",
    ].join("\n");
    const events = parseTaxLotCsv(csv).events;
    expect(events).toHaveLength(2);
    const keys = events.map((e) => e.lotKey).sort();
    expect(keys).toEqual([
      "taxlot:u:AAPL:2024-03-15:1",
      "taxlot:u:AAPL:2024-03-15:2",
    ]);
  });

  it("yields identical keys for a reordered re-export (content-sorted seq)", () => {
    const rowA = "AAPL,10,1500,150,2024-03-15";
    const rowB = "AAPL,5,600,120,2024-03-15"; // same symbol+openDate, different qty/basis
    const forward = parseTaxLotCsv([UNREALIZED_HEADER, rowA, rowB].join("\n"));
    const reversed = parseTaxLotCsv([UNREALIZED_HEADER, rowB, rowA].join("\n"));

    const keysOf = (r: typeof forward) =>
      Object.fromEntries(r.events.map((e) => [e.quantity, e.lotKey]));
    // Keyed by the (distinct) quantity so we compare the SAME lot across the two
    // orderings; seq is a function of the row set, so the keys match.
    expect(keysOf(forward)).toEqual(keysOf(reversed));
    // The smaller-qty lot sorts first → seq 1, regardless of file order.
    expect(keysOf(forward)[5]).toBe("taxlot:u:AAPL:2024-03-15:1");
    expect(keysOf(forward)[10]).toBe("taxlot:u:AAPL:2024-03-15:2");
  });
});

describe("parseTaxLotCsv — honest gaps (represent, don't drop)", () => {
  it("keeps a blank-costBasis buy with amount 0 and a basisUnknown marker", () => {
    const csv = [UNREALIZED_HEADER, "GOOG,2,,140,2024-02-01"].join("\n");
    const buy = parseTaxLotCsv(csv).events[0];
    expect(buy).toMatchObject({
      type: "buy",
      quantity: 2,
      amount: 0,
      unitPrice: null,
      basisUnknown: "import-missing-basis",
    });
  });

  it("records a blank-proceeds sell with a proceedsUnknown marker", () => {
    const csv = [
      REALIZED_HEADER,
      "GOOG,2,280,140,2023-02-01,2024-02-01,",
    ].join("\n");
    const sell = parseTaxLotCsv(csv).events.find((e) => e.type === "sell");
    expect(sell).toMatchObject({ amount: 0, proceedsUnknown: expect.stringContaining("proceeds") });
  });
});

describe("parseTaxLotCsv — skips + warnings", () => {
  it("skips a non-positive quantity with a parse error", () => {
    const csv = [UNREALIZED_HEADER, "AAPL,-5,750,150,2024-03-15"].join("\n");
    const result = parseTaxLotCsv(csv);
    expect(result.events).toEqual([]);
    expect(result.parseErrors[0].reason).toMatch(/non-positive quantity/i);
  });

  it("skips an OCC option symbol (Non-Goal) with a parse error", () => {
    const csv = [UNREALIZED_HEADER, "AAPL240621C00190000,1,500,500,2024-01-02"].join("\n");
    const result = parseTaxLotCsv(csv);
    expect(result.events).toEqual([]);
    expect(result.parseErrors[0].reason).toMatch(/option/i);
  });

  it("strips a trailing -BOND suffix to recover the CUSIP", () => {
    const csv = [UNREALIZED_HEADER, "71654QBR2-BOND,1,980,980,2024-01-02"].join("\n");
    const buy = parseTaxLotCsv(csv).events[0];
    expect(buy.ticker).toBe("71654QBR2");
    expect(buy.lotKey).toBe("taxlot:u:71654QBR2:2024-01-02:1");
  });

  it("ingests a wash-sale row and emits a warning (no basis math)", () => {
    const csv = [
      `${REALIZED_HEADER},washSale`,
      "AAPL,3,450,150,2023-01-02,2024-01-02,300,true",
    ].join("\n");
    const result = parseTaxLotCsv(csv);
    expect(result.events).toHaveLength(2); // still ingested
    expect(result.warnings.some((w) => /wash sale/i.test(w))).toBe(true);
  });

  it("skips a missing-symbol or missing-openDate row but not its siblings", () => {
    const csv = [
      UNREALIZED_HEADER,
      ",10,1500,150,2024-03-15", // missing symbol
      "AAPL,10,1500,150,", // missing openDate
      "MSFT,5,500,100,2024-01-02", // good
    ].join("\n");
    const result = parseTaxLotCsv(csv);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].ticker).toBe("MSFT");
    expect(result.parseErrors).toHaveLength(2);
  });
});

describe("parseTaxLotCsv — currency (§0 D3)", () => {
  it("rejects a row whose file currency differs from the account currency", () => {
    const csv = [
      `${UNREALIZED_HEADER},currency`,
      "AAPL,10,1500,150,2024-03-15,EUR",
      "MSFT,5,500,100,2024-01-02,USD",
    ].join("\n");
    const result = parseTaxLotCsv(csv, { expectedCurrency: "USD" });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].ticker).toBe("MSFT");
    expect(result.events[0].currency).toBe("USD");
    expect(result.parseErrors[0].reason).toMatch(/EUR.*USD/);
  });

  it("carries the file currency through on a preview parse (no expectedCurrency)", () => {
    const csv = [
      `${UNREALIZED_HEADER},currency`,
      "AAPL,10,1500,150,2024-03-15,EUR",
    ].join("\n");
    const buy = parseTaxLotCsv(csv).events[0];
    expect(buy.currency).toBe("EUR");
  });

  it("leaves currency unset when the file has no currency column", () => {
    const csv = [UNREALIZED_HEADER, "AAPL,10,1500,150,2024-03-15"].join("\n");
    const buy = parseTaxLotCsv(csv).events[0];
    expect(buy.currency).toBeUndefined();
  });
});

describe("detectTaxLotCsv + file-level refusals", () => {
  it("detects unrealized vs realized by headers", () => {
    expect(detectTaxLotCsv(`${UNREALIZED_HEADER}\n`).kind).toBe("tax-lot-unrealized");
    expect(detectTaxLotCsv(`${REALIZED_HEADER}\n`).kind).toBe("tax-lot-realized");
  });

  it("returns not-tax-lot for a non-tax-lot CSV (dispatcher keeps its error)", () => {
    expect(detectTaxLotCsv("ticker,quantity,costBasis\nAAPL,10,150\n").kind).toBe(
      "not-tax-lot",
    );
  });

  it("rejects incomplete realized headers (closeDate without proceeds)", () => {
    const header = "symbol,quantity,costBasis,unitCost,openDate,closeDate";
    const det = detectTaxLotCsv(`${header}\n`);
    expect(det.kind).toBe("reject");
    const result = parseTaxLotCsv(`${header}\nAAPL,4,400,100,2023-06-01,2024-07-01`);
    expect(result.format).toBeNull();
    expect(result.parseErrors[0].reason).toMatch(/realized/i);
  });

  it("refuses a per-share-basis holdings snapshot, pointing at Holdings CSV", () => {
    // costBasis ≈ unitCost (per-share) on multi-share rows → holdings snapshot.
    const csv = [
      UNREALIZED_HEADER,
      "AAPL,10,150,150,2024-03-15",
      "MSFT,20,300,300,2023-01-10",
    ].join("\n");
    const result = parseTaxLotCsv(csv);
    expect(result.format).toBeNull();
    expect(result.events).toEqual([]);
    expect(result.warnings[0]).toMatch(/holdings csv/i);
  });

  it("passes a genuine lot-total file through the discrimination cross-check", () => {
    const csv = [
      UNREALIZED_HEADER,
      "AAPL,10,1500,150,2024-03-15",
      "MSFT,20,6000,300,2023-01-10",
    ].join("\n");
    const result = parseTaxLotCsv(csv);
    expect(result.format).toBe("tax-lot-unrealized");
    expect(result.events).toHaveLength(2);
  });

  it("returns an empty result for a header-only file", () => {
    const result = parseTaxLotCsv(`${UNREALIZED_HEADER}\n`);
    expect(result.events).toEqual([]);
    expect(result.parseErrors).toEqual([]);
  });
});
