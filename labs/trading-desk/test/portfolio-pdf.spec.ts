/**
 * Unit tests for the pure PDF-import core: the DETERMINISTIC reconciliation and
 * the extracted-rows -> CanonicalRow mapping.
 *
 * These encode the real-money intent, not just behavior:
 *  - the per-row `shares * price ~= value` check flags a transcription error
 *    (a dropped digit) but tolerates fractional-share rounding;
 *  - the total `sum vs stated` check flags a portfolio that doesn't add up;
 *  - junk rows (contra-CUSIP, money-market, cash, blank, zero-qty) are SKIPPED
 *    and reported, never imported;
 *  - a holdings snapshot imports with `costBasis: null` — never invented from
 *    the current price.
 *
 * The extraction generator itself is NOT tested here (it is an LLM call, mocked
 * in the e2e suite). Live extraction ACCURACY needs a real PDF via the dev
 * server — see openConcerns.
 */
import { describe, expect, it } from "vitest";
import {
  canonicalRowsToCsv,
  reconcile,
  toCanonicalRows,
  type PdfExtraction,
} from "../src/flows/portfolio/portfolio-pdf";
import { parsePortfolioCsv } from "../src/flows/portfolio/portfolio-csv";

/** A small synthetic extraction modeled on a Wealthfront-style holdings table:
 *  two real fractional holdings, one money-market fund, one contra-CUSIP, plus a
 *  stated total. Numbers chosen so shares*price exactly equals value. */
function syntheticExtraction(): PdfExtraction {
  return {
    rows: [
      { ticker: "AAPL", quantity: 5.44149, costBasis: null, price: 298.97, value: 1626.84 },
      { ticker: "MSFT", quantity: 2.0, costBasis: null, price: 400.0, value: 800.0 },
      // Money-market fund — should be skipped (cash-like instrument).
      { ticker: "TIMXX", quantity: 1500, costBasis: null, price: 1.0, value: 1500.0 },
      // Contra-CUSIP — no real ticker; should be skipped.
      { ticker: "436CVR021", quantity: 0, costBasis: null, price: 0, value: 0.0 },
    ],
    // 1626.84 + 800 + 1500 + 0 = 3926.84
    statedTotal: 3926.84,
  };
}

describe("reconcile — per-row shares*price ~= value", () => {
  it("passes a row whose computed value matches the stated value", () => {
    const recon = reconcile(syntheticExtraction());
    const aapl = recon.rows.find((r) => r.ticker === "AAPL");
    // 5.44149 * 298.97 = 1626.84 (to the cent)
    expect(aapl?.status).toBe("ok");
    expect(aapl?.computedValue).toBeCloseTo(1626.84, 2);
  });

  it("flags a row where the stated value is wrong (a dropped-digit transcription)", () => {
    const ext = syntheticExtraction();
    // Corrupt MSFT's value: 2 * 400 = 800, but the statement says 80 (digit dropped).
    ext.rows[1].value = 80;
    const recon = reconcile(ext);
    const msft = recon.rows.find((r) => r.ticker === "MSFT");
    expect(msft?.status).toBe("mismatch");
    expect(recon.mismatchCount).toBe(1);
  });

  it("tolerates sub-cent fractional-share rounding (does NOT flag)", () => {
    const ext: PdfExtraction = {
      rows: [
        // 0.333333 * 300 = 99.9999 → statement prints 100.00; within tolerance.
        { ticker: "VTI", quantity: 0.333333, costBasis: null, price: 300, value: 100.0 },
      ],
      statedTotal: 100.0,
    };
    const recon = reconcile(ext);
    expect(recon.rows[0].status).toBe("ok");
  });

  it("respects the per-row tolerance boundary exactly", () => {
    const ext: PdfExtraction = {
      rows: [{ ticker: "X", quantity: 1, costBasis: null, price: 100, value: 100 }],
      statedTotal: null,
    };
    // computed = 100. With abs tol 0.5 and rel tol 0, a stated 100.5 is exactly
    // on the boundary (within), 100.51 is just over (mismatch).
    ext.rows[0].value = 100.5;
    expect(
      reconcile(ext, { rowAbs: 0.5, rowRel: 0 }).rows[0].status,
    ).toBe("ok");
    ext.rows[0].value = 100.51;
    expect(
      reconcile(ext, { rowAbs: 0.5, rowRel: 0 }).rows[0].status,
    ).toBe("mismatch");
  });

  it("marks a row 'unchecked' when price or quantity is missing (not a failure)", () => {
    const ext: PdfExtraction = {
      rows: [{ ticker: "Y", quantity: 10, costBasis: null, price: null, value: 1000 }],
      statedTotal: null,
    };
    expect(reconcile(ext).rows[0].status).toBe("unchecked");
  });
});

describe("reconcile — total sum vs stated total", () => {
  it("passes when the sum of stated values matches the stated total", () => {
    const recon = reconcile(syntheticExtraction());
    expect(recon.total.status).toBe("ok");
    expect(recon.total.sumOfValues).toBeCloseTo(3926.84, 2);
  });

  it("flags when the sum does not match the stated total", () => {
    const ext = syntheticExtraction();
    ext.statedTotal = 9999.99; // wrong total
    const recon = reconcile(ext);
    expect(recon.total.status).toBe("mismatch");
  });

  it("reports 'unchecked' when the statement has no stated total", () => {
    const ext = syntheticExtraction();
    ext.statedTotal = null;
    expect(reconcile(ext).total.status).toBe("unchecked");
  });

  it("respects the total tolerance boundary exactly", () => {
    const ext: PdfExtraction = {
      rows: [{ ticker: "A", quantity: 1, costBasis: null, price: 50, value: 50 }],
      statedTotal: 51,
    };
    // sum = 50, stated = 51. abs tol 1, rel 0 → boundary (within).
    expect(reconcile(ext, { totalAbs: 1, totalRel: 0 }).total.status).toBe("ok");
    ext.statedTotal = 51.01;
    expect(
      reconcile(ext, { totalAbs: 1, totalRel: 0 }).total.status,
    ).toBe("mismatch");
  });
});

describe("toCanonicalRows — mapping + skip rules", () => {
  it("imports real holdings with costBasis null (snapshots carry no cost)", () => {
    const { rows } = toCanonicalRows(syntheticExtraction());
    const aapl = rows.find((r) => r.ticker === "AAPL");
    expect(aapl).toEqual({
      ticker: "AAPL",
      quantity: 5.44149,
      costBasis: null,
      acquiredDate: null,
      // FIX-773 Slice B: an equity ticker classifies as equity.
      assetClass: "equity",
      assetType: "equity",
      attributes: { kind: "none" },
    });
  });

  it("PRESERVES bond/MMF/cash rows as typed holdings (classifier, not filter)", () => {
    // An equity, a bond CUSIP, an MMF (XX + $1.00), and a cash line — FOUR typed
    // rows, none dropped. This is the real-money intent of Slice B: a statement
    // row is never silently lost; a non-equity becomes a visible typed holding.
    const ext: PdfExtraction = {
      rows: [
        { ticker: "AAPL", quantity: 10, costBasis: null, price: 200, value: 2000 },
        { ticker: "912828YK0", quantity: 5, costBasis: null, price: 98.5, value: 492.5 },
        { ticker: "SPAXX", quantity: 1500, costBasis: null, price: 1.0, value: 1500 },
        { ticker: "CASH", quantity: 250, costBasis: null, price: 1.0, value: 250 },
      ],
      statedTotal: 4242.5,
    };
    const { rows, skipped } = toCanonicalRows(ext);
    expect(skipped).toEqual([]);
    expect(rows).toHaveLength(4);

    const byTicker = new Map(rows.map((r) => [r.ticker, r]));
    expect(byTicker.get("AAPL")).toMatchObject({ assetType: "equity", assetClass: "equity" });
    expect(byTicker.get("912828YK0")).toMatchObject({
      assetType: "bond",
      assetClass: "fixed_income",
      attributes: { kind: "bond", cusip: "912828YK0" },
    });
    expect(byTicker.get("SPAXX")).toMatchObject({
      assetType: "money_market",
      assetClass: "cash",
      attributes: { kind: "cash_equivalent" },
    });
    expect(byTicker.get("CASH")).toMatchObject({
      assetType: "money_market",
      assetClass: "cash",
    });
  });

  it("still skips a no-symbol row and a zero-quantity row, reporting both", () => {
    const ext: PdfExtraction = {
      rows: [
        { ticker: null, quantity: 100, costBasis: null, price: 1, value: 100 },
        { ticker: "ZEROQTY", quantity: 0, costBasis: null, price: 50, value: 0 },
        { ticker: "GOOG", quantity: 1, costBasis: null, price: 150, value: 150 },
      ],
      statedTotal: null,
    };
    const { rows, skipped } = toCanonicalRows(ext);
    expect(rows.map((r) => r.ticker)).toEqual(["GOOG"]);
    expect(skipped.map((s) => s.rowNumber).sort()).toEqual([1, 2]);
    expect(skipped.every((s) => s.reason.length > 0)).toBe(true);
  });

  it("preserves the MMF as money_market and skips only the zero-qty contra row", () => {
    // The synthetic extraction's TIMXX (XX + $1.00) is now PRESERVED as a
    // money-market holding; the contra-CUSIP row is skipped only because its
    // quantity is 0 (a no-position row), not because of its symbol shape.
    const { rows, skipped } = toCanonicalRows(syntheticExtraction());
    expect(rows.map((r) => r.ticker)).toEqual(["AAPL", "MSFT", "TIMXX"]);
    expect(rows.find((r) => r.ticker === "TIMXX")).toMatchObject({
      assetType: "money_market",
      assetClass: "cash",
    });
    expect(skipped.map((s) => s.ticker)).toEqual(["436CVR021"]);
    expect(skipped.every((s) => s.reason.length > 0)).toBe(true);
  });

  it("skips a blank-ticker row", () => {
    const ext: PdfExtraction = {
      rows: [
        { ticker: null, quantity: 100, costBasis: null, price: 1, value: 100 },
        { ticker: "GOOG", quantity: 1, costBasis: null, price: 150, value: 150 },
      ],
      statedTotal: null,
    };
    const { rows, skipped } = toCanonicalRows(ext);
    expect(rows.map((r) => r.ticker)).toEqual(["GOOG"]);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].rowNumber).toBe(1);
  });

  it("never derives cost basis from the current price", () => {
    const ext: PdfExtraction = {
      rows: [{ ticker: "NVDA", quantity: 3, costBasis: null, price: 131.4, value: 394.2 }],
      statedTotal: null,
    };
    expect(toCanonicalRows(ext).rows[0].costBasis).toBeNull();
  });
});

describe("canonicalRowsToCsv — feeds the EXISTING CSV parser cleanly", () => {
  it("round-trips through parsePortfolioCsv with no errors and a blank cost basis", () => {
    const { rows } = toCanonicalRows(syntheticExtraction());
    const csv = canonicalRowsToCsv(rows);
    const parsed = parsePortfolioCsv(csv);
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows.map((r) => r.ticker).sort()).toEqual(["AAPL", "MSFT", "TIMXX"]);
    // Cost basis must remain null — the snapshot never carried one, and the CSV
    // we emit deliberately has no price column for the parser to misread as cost.
    expect(parsed.rows.every((r) => r.costBasis === null)).toBe(true);
  });

  it("survives the classification through the CSV seam (assetType round-trips)", () => {
    // The PDF classifies; the CSV is the transport between the PDF path and the
    // server-side parse. The bond must STILL be a bond and the MMF STILL a
    // money_market after the round-trip — proving the type survives the seam.
    const ext: PdfExtraction = {
      rows: [
        { ticker: "AAPL", quantity: 10, costBasis: null, price: 200, value: 2000 },
        { ticker: "912828YK0", quantity: 5, costBasis: null, price: 98.5, value: 492.5 },
        { ticker: "SPAXX", quantity: 1500, costBasis: null, price: 1.0, value: 1500 },
      ],
      statedTotal: null,
    };
    const csv = canonicalRowsToCsv(toCanonicalRows(ext).rows);
    const parsed = parsePortfolioCsv(csv);
    expect(parsed.errors).toEqual([]);
    const byTicker = new Map(parsed.rows.map((r) => [r.ticker, r]));
    expect(byTicker.get("AAPL")).toMatchObject({ assetType: "equity" });
    expect(byTicker.get("912828YK0")).toMatchObject({
      assetType: "bond",
      assetClass: "fixed_income",
    });
    expect(byTicker.get("SPAXX")).toMatchObject({
      assetType: "money_market",
      assetClass: "cash",
    });
  });

  it("emits a ticker,quantity,costBasis,assetType,markPrice header (no bare price column)", () => {
    const { rows } = toCanonicalRows(syntheticExtraction());
    const csv = canonicalRowsToCsv(rows);
    expect(csv.split("\n")[0]).toBe("ticker,quantity,costBasis,assetType,markPrice");
    // No warning about a bare-price→cost mapping: `markPrice` is NOT a costBasis
    // synonym, so the parser never misreads it as cost.
    const parsed = parsePortfolioCsv(csv);
    expect(parsed.warnings.some((w) => w.toLowerCase().includes("cost"))).toBe(
      false,
    );
    expect(parsed.rows.every((r) => r.costBasis === null)).toBe(true);
  });

  it("carries a bond's markPrice through the PDF → CSV round-trip (FIX-773 Slice C)", () => {
    // A bond is valued at the carried statement mark — it must survive the CSV
    // seam, or the bond would value at "—" after import.
    const ext: PdfExtraction = {
      rows: [
        { ticker: "912828YK0", quantity: 5, costBasis: null, price: 98.5, value: 492.5 },
      ],
      statedTotal: null,
    };
    const csv = canonicalRowsToCsv(toCanonicalRows(ext).rows);
    const parsed = parsePortfolioCsv(csv);
    expect(parsed.errors).toEqual([]);
    const bond = parsed.rows.find((r) => r.ticker === "912828YK0");
    expect(bond?.assetType).toBe("bond");
    expect(bond?.attributes).toMatchObject({ kind: "bond", markPrice: 98.5 });
  });
});
