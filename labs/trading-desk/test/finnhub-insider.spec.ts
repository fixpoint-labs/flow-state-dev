/**
 * Unit tests for `fetchFinnhubInsiderTransactions` — covers URL shape (token,
 * symbol, from/to window), Finnhub row → canonical row mapping, the
 * change → share fallback, the 50-row cap, and the HTTP-error path that lets
 * the tool handler fall through to `emptyPayload`.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFinnhubInsiderTransactions } from "../src/flows/trading-desk/tools/providers/finnhub";

function mockFetch(payload: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(payload), { status }),
  );
}

beforeAll(() => {
  process.env.FINNHUB_API_KEY = "test-key";
});

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchFinnhubInsiderTransactions", () => {
  it("calls /stock/insider-transactions with a 90-day window and the token", async () => {
    const spy = mockFetch({ data: [] });
    await fetchFinnhubInsiderTransactions({ ticker: "NVDA", date: "2026-05-06" });
    expect(spy).toHaveBeenCalledOnce();
    const url = new URL((spy.mock.calls[0]![0] as URL).toString());
    expect(url.pathname).toBe("/api/v1/stock/insider-transactions");
    expect(url.searchParams.get("symbol")).toBe("NVDA");
    expect(url.searchParams.get("to")).toBe("2026-05-06");
    expect(url.searchParams.get("from")).toBe("2026-02-05");
    expect(url.searchParams.get("token")).toBe("test-key");
  });

  it("maps Finnhub rows to the canonical shape", async () => {
    mockFetch({
      data: [
        {
          name: "Huang Jen-Hsun",
          position: "CEO",
          filingDate: "2026-04-28",
          transactionDate: "2026-04-24",
          transactionCode: "S",
          change: -120000,
          transactionPrice: 128.45,
          isDerivative: false,
        },
      ],
    });
    const out = await fetchFinnhubInsiderTransactions({ ticker: "NVDA", date: "2026-05-06" });
    expect(out.source).toBe("finnhub");
    expect(out.ticker).toBe("NVDA");
    expect(out.windowDays).toBe(90);
    expect(out.transactions).toHaveLength(1);
    expect(out.transactions[0]).toEqual({
      filingDate: "2026-04-28",
      transactionDate: "2026-04-24",
      insiderName: "Huang Jen-Hsun",
      insiderTitle: "CEO",
      transactionCode: "S",
      shares: -120000,
      pricePerShare: 128.45,
      isDerivative: false,
    });
  });

  it("falls back to `share` when `change` is missing", async () => {
    mockFetch({
      data: [
        {
          name: "Some Officer",
          position: "Director",
          filingDate: "2026-04-01",
          transactionDate: "2026-04-01",
          transactionCode: "P",
          share: 1000,
          transactionPrice: 50,
        },
      ],
    });
    const out = await fetchFinnhubInsiderTransactions({ ticker: "X", date: "2026-05-06" });
    expect(out.transactions[0]!.shares).toBe(1000);
  });

  it("caps results at 50 rows", async () => {
    const data = Array.from({ length: 75 }, (_, i) => ({
      name: `Insider ${i}`,
      position: "Officer",
      filingDate: "2026-04-01",
      transactionDate: "2026-04-01",
      transactionCode: "S",
      change: -100,
      transactionPrice: 10,
    }));
    mockFetch({ data });
    const out = await fetchFinnhubInsiderTransactions({ ticker: "X", date: "2026-05-06" });
    expect(out.transactions).toHaveLength(50);
  });

  it("throws on HTTP error so the tool falls through to emptyPayload", async () => {
    mockFetch({ error: "rate limited" }, 429);
    await expect(
      fetchFinnhubInsiderTransactions({ ticker: "NVDA", date: "2026-05-06" }),
    ).rejects.toThrow(/HTTP 429/);
  });
});
