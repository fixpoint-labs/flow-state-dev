/**
 * Unit tests for the Alpha Vantage provider module — the load-bearing request
 * helper (apikey injection, HTTP-200 body-error detection, the race-free daily
 * budget guard) and the three fetchers (insider transactions, earnings
 * transcript, analyst enrichment). AV signals failures with an HTTP-200 body,
 * so the helper's throw-on-body behavior is the single most important
 * correctness property covered here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AlphaVantageBudgetError,
  AlphaVantageError,
  AlphaVantageRateLimitError,
  AlphaVantageRequestError,
  alphaVantageRequest,
  fetchAlphaVantageAnalystEnrichment,
  fetchAlphaVantageEarningsTranscript,
  fetchAlphaVantageInsiderTransactions,
  hasAlphaVantageKey,
  _resetBudget,
} from "../lib/providers/alpha-vantage";

// A fresh Response per call — a single shared Response's body can only be read
// once ("Body is unusable"), and these specs fetch many times.
function mockFetchOnce(payload: unknown, status = 200) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(payload), { status })),
    );
}

/** Mock fetch that dispatches by the `function` query param → payload. Unknown
 *  functions return an empty HTTP-200 body (no Note/Error → parsed as data). */
function mockFetchByFunction(byFn: Record<string, unknown>, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input: unknown) => {
    const url = new URL((input as URL).toString());
    const fn = url.searchParams.get("function") ?? "";
    const payload = byFn[fn] ?? {};
    return Promise.resolve(
      new Response(JSON.stringify(payload), { status }),
    );
  });
}

beforeEach(() => {
  process.env.ALPHAVANTAGE_API_KEY = "test-key";
  delete process.env.ALPHAVANTAGE_DAILY_LIMIT;
  _resetBudget();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ALPHAVANTAGE_API_KEY;
  delete process.env.ALPHAVANTAGE_DAILY_LIMIT;
});

describe("hasAlphaVantageKey", () => {
  it("is true with a key set and false when unset/blank", () => {
    expect(hasAlphaVantageKey()).toBe(true);
    process.env.ALPHAVANTAGE_API_KEY = "   ";
    expect(hasAlphaVantageKey()).toBe(false);
    delete process.env.ALPHAVANTAGE_API_KEY;
    expect(hasAlphaVantageKey()).toBe(false);
  });
});

describe("alphaVantageRequest — key gate + apikey + body errors", () => {
  it("throws locally before any reserve or fetch when the key is unset", async () => {
    delete process.env.ALPHAVANTAGE_API_KEY;
    const spy = mockFetchOnce({ ok: true });
    await expect(
      alphaVantageRequest({ function: "OVERVIEW", symbol: "NVDA" }),
    ).rejects.toBeInstanceOf(AlphaVantageError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("injects apikey (from env, not the caller) into the request URL", async () => {
    const spy = mockFetchOnce({ Symbol: "NVDA" });
    await alphaVantageRequest({ function: "OVERVIEW", symbol: "NVDA" });
    expect(spy).toHaveBeenCalledOnce();
    const url = new URL((spy.mock.calls[0]![0] as URL).toString());
    expect(url.searchParams.get("apikey")).toBe("test-key");
    expect(url.searchParams.get("function")).toBe("OVERVIEW");
    expect(url.searchParams.get("symbol")).toBe("NVDA");
  });

  it("throws AlphaVantageRateLimitError on a Note body (HTTP 200)", async () => {
    mockFetchOnce({ Note: "Thank you... our standard API call frequency is 25/day" });
    await expect(
      alphaVantageRequest({ function: "OVERVIEW", symbol: "NVDA" }),
    ).rejects.toBeInstanceOf(AlphaVantageRateLimitError);
  });

  it("throws AlphaVantageRateLimitError on an Information body (HTTP 200)", async () => {
    mockFetchOnce({ Information: "premium endpoint" });
    await expect(
      alphaVantageRequest({ function: "OVERVIEW", symbol: "NVDA" }),
    ).rejects.toBeInstanceOf(AlphaVantageRateLimitError);
  });

  it("throws the distinct AlphaVantageRequestError on an Error Message body", async () => {
    mockFetchOnce({ "Error Message": "Invalid quarter parameter" });
    await expect(
      alphaVantageRequest({ function: "EARNINGS_CALL_TRANSCRIPT", symbol: "NVDA" }),
    ).rejects.toBeInstanceOf(AlphaVantageRequestError);
  });

  it("throws on a non-2xx status", async () => {
    mockFetchOnce("upstream down", 503);
    await expect(
      alphaVantageRequest({ function: "OVERVIEW", symbol: "NVDA" }),
    ).rejects.toThrow();
  });
});

describe("alphaVantageRequest — daily budget guard", () => {
  it("throws AlphaVantageBudgetError at the limit without calling fetch", async () => {
    process.env.ALPHAVANTAGE_DAILY_LIMIT = "2";
    const spy = mockFetchOnce({ ok: 1 });
    await alphaVantageRequest({ function: "A", symbol: "X" });
    await alphaVantageRequest({ function: "B", symbol: "X" });
    expect(spy).toHaveBeenCalledTimes(2);
    await expect(
      alphaVantageRequest({ function: "C", symbol: "X" }),
    ).rejects.toBeInstanceOf(AlphaVantageBudgetError);
    expect(spy).toHaveBeenCalledTimes(2); // 3rd call never fetched
  });

  it("is race-free under parallel calls — never exceeds the limit", async () => {
    process.env.ALPHAVANTAGE_DAILY_LIMIT = "2";
    // Slow fetch so all five enter alphaVantageRequest before any resolves; if
    // the reserve happened AFTER the await, all five would pass count < limit.
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve(new Response(JSON.stringify({ ok: 1 }), { status: 200 })),
            10,
          ),
        ),
    );
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        alphaVantageRequest({ function: `F${i}`, symbol: "X" }),
      ),
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const budgetRejections = results.filter(
      (r) => r.status === "rejected" && r.reason instanceof AlphaVantageBudgetError,
    );
    expect(fulfilled).toHaveLength(2);
    expect(budgetRejections).toHaveLength(3);
  });

  it("disables the guard only when the limit is exactly '0'", async () => {
    process.env.ALPHAVANTAGE_DAILY_LIMIT = "0";
    mockFetchOnce({ ok: 1 });
    // Many calls, guard off.
    for (let i = 0; i < 30; i++) {
      await alphaVantageRequest({ function: "A", symbol: "X" });
    }
    // No throw = guard disabled.
    expect(true).toBe(true);
  });

  it.each(["", "  ", "-5", "25.5", "twenty", "0.0", "00", "-0"])(
    "keeps the guard ON (default 25) for the malformed limit %j",
    async (bad) => {
      process.env.ALPHAVANTAGE_DAILY_LIMIT = bad;
      mockFetchOnce({ ok: 1 });
      // 25 succeed, the 26th is budget-blocked (guard did NOT silently disable).
      for (let i = 0; i < 25; i++) {
        await alphaVantageRequest({ function: "A", symbol: "X" });
      }
      await expect(
        alphaVantageRequest({ function: "A", symbol: "X" }),
      ).rejects.toBeInstanceOf(AlphaVantageBudgetError);
    },
  );

  it("resets the counter on a UTC-day roll", async () => {
    process.env.ALPHAVANTAGE_DAILY_LIMIT = "1";
    mockFetchOnce({ ok: 1 });
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-05-06T12:00:00Z"));
      await alphaVantageRequest({ function: "A", symbol: "X" });
      await expect(
        alphaVantageRequest({ function: "A", symbol: "X" }),
      ).rejects.toBeInstanceOf(AlphaVantageBudgetError);
      // Advance to the next UTC day → counter reset → the call proceeds again.
      vi.setSystemTime(new Date("2026-05-07T09:00:00Z"));
      await expect(
        alphaVantageRequest({ function: "A", symbol: "X" }),
      ).resolves.toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("fetchAlphaVantageInsiderTransactions", () => {
  const AV_ROWS = {
    data: [
      {
        transaction_date: "2026-04-24",
        ticker: "NVDA",
        executive: "Huang Jen-Hsun",
        executive_title: "CEO",
        security_type: "Common Stock",
        acquisition_or_disposal: "D",
        shares: "120000",
        share_price: "128.45",
      },
      {
        transaction_date: "2026-04-10",
        ticker: "NVDA",
        executive: "Some Director",
        executive_title: "Director",
        security_type: "Derivative",
        acquisition_or_disposal: "A",
        shares: "5000",
        share_price: "0",
      },
    ],
  };

  it("sends the server-side from= 90-day filter and tags alphavantage", async () => {
    const spy = mockFetchOnce(AV_ROWS);
    const out = await fetchAlphaVantageInsiderTransactions({
      ticker: "NVDA",
      date: "2026-05-06",
    });
    const url = new URL((spy.mock.calls[0]![0] as URL).toString());
    expect(url.searchParams.get("function")).toBe("INSIDER_TRANSACTIONS");
    expect(url.searchParams.get("from")).toBe("2026-02-05"); // date − 90 days
    expect(out.source).toBe("alphavantage");
    expect(out.windowDays).toBe(90);
  });

  it("maps A/D to signed shares, leaves transactionCode empty, and sets isDerivative", async () => {
    mockFetchOnce(AV_ROWS);
    const out = await fetchAlphaVantageInsiderTransactions({
      ticker: "NVDA",
      date: "2026-05-06",
    });
    expect(out.transactions).toHaveLength(2);
    expect(out.transactions[0]).toMatchObject({
      transactionDate: "2026-04-24",
      insiderName: "Huang Jen-Hsun",
      transactionCode: "", // never fabricated to P/S
      shares: -120000, // D → negative
      pricePerShare: 128.45,
      isDerivative: false,
    });
    expect(out.transactions[1]).toMatchObject({
      shares: 5000, // A → positive
      isDerivative: true, // security_type "Derivative"
    });
  });

  it("drops rows outside the 90-day window (client-side upper/lower bound)", async () => {
    mockFetchOnce({
      data: [
        { ...AV_ROWS.data[0], transaction_date: "2025-01-01" }, // way older
        AV_ROWS.data[1], // in-window
      ],
    });
    const out = await fetchAlphaVantageInsiderTransactions({
      ticker: "NVDA",
      date: "2026-05-06",
    });
    expect(out.transactions).toHaveLength(1);
    expect(out.transactions[0]!.transactionDate).toBe("2026-04-10");
  });

  it("caps at 50 in-window rows (matching the Finnhub primary)", async () => {
    const data = Array.from({ length: 60 }, () => ({
      transaction_date: "2026-04-15",
      ticker: "X",
      executive: "Insider",
      executive_title: "Officer",
      security_type: "Common Stock",
      acquisition_or_disposal: "A",
      shares: "100",
      share_price: "10",
    }));
    mockFetchOnce({ data });
    const out = await fetchAlphaVantageInsiderTransactions({
      ticker: "X",
      date: "2026-05-06",
    });
    expect(out.transactions).toHaveLength(50);
  });
});

describe("fetchAlphaVantageEarningsTranscript", () => {
  // Apple-like non-calendar issuer: FY ends September; the latest reported
  // quarter ends Dec 2023, whose FISCAL label is 2024Q1 (not calendar 2023Q4).
  const NONCAL_EARNINGS = {
    symbol: "AAPL",
    annualEarnings: [{ fiscalDateEnding: "2023-09-30", reportedEPS: "6.13" }],
    quarterlyEarnings: [
      { fiscalDateEnding: "2023-12-31", reportedDate: "2024-02-01", reportedEPS: "2.18" },
      { fiscalDateEnding: "2023-09-30", reportedDate: "2023-11-02", reportedEPS: "1.46" },
    ],
  };
  const TRANSCRIPT = {
    symbol: "AAPL",
    quarter: "2024Q1",
    transcript: [
      { speaker: "Tim Cook", title: "CEO", content: "Strong quarter.", sentiment: "0.4" },
      { speaker: "Analyst", title: "Morgan Stanley", content: "On services…", sentiment: "0.1" },
    ],
  };

  it("resolves the derived FISCAL label on the FIRST request and returns available in 2 units (no retry)", async () => {
    const spy = mockFetchByFunction({
      EARNINGS: NONCAL_EARNINGS,
      EARNINGS_CALL_TRANSCRIPT: TRANSCRIPT,
    });
    const out = await fetchAlphaVantageEarningsTranscript({
      ticker: "AAPL",
      date: "2026-05-06",
    });
    // Probe + one transcript call = exactly 2 fetches (no alternate-label retry).
    expect(spy).toHaveBeenCalledTimes(2);
    const transcriptCall = spy.mock.calls.find((c) =>
      new URL((c[0] as URL).toString()).searchParams.get("function") ===
      "EARNINGS_CALL_TRANSCRIPT",
    )!;
    const url = new URL((transcriptCall[0] as URL).toString());
    expect(url.searchParams.get("quarter")).toBe("2024Q1"); // fiscal, not 2023Q4
    expect(out.available).toBe(true);
    expect(out.quarter).toBe("2024Q1");
    expect(out.callDate).toBe("2024-02-01");
    expect(out.source).toBe("alphavantage");
    expect(out.content).toContain("Tim Cook (CEO): Strong quarter.");
  });

  it("returns available: false on an empty transcript after the alternate-label retry", async () => {
    // Both labels return empty transcript[] → retry fires, then available:false.
    const spy = mockFetchByFunction({
      EARNINGS: NONCAL_EARNINGS,
      EARNINGS_CALL_TRANSCRIPT: { symbol: "AAPL", quarter: "2024Q1", transcript: [] },
    });
    const out = await fetchAlphaVantageEarningsTranscript({
      ticker: "AAPL",
      date: "2026-05-06",
    });
    expect(out.available).toBe(false);
    expect(out.content).toBeNull();
    // probe + first-label + alternate-label = 3 fetches.
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("falls back to a calendar-quarter transcript on a NON-budget probe failure", async () => {
    // EARNINGS probe fails with a network/parse-class error (500), NOT budget →
    // best-effort calendar-quarter transcript request.
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((input: unknown) => {
      const fn = new URL((input as URL).toString()).searchParams.get("function");
      if (fn === "EARNINGS") {
        return Promise.resolve(new Response("upstream 500", { status: 500 }));
      }
      return Promise.resolve(
        new Response(
          JSON.stringify({ transcript: [{ speaker: "CEO", title: "CEO", content: "Hi." }] }),
          { status: 200 },
        ),
      );
    });
    const out = await fetchAlphaVantageEarningsTranscript({
      ticker: "AAPL",
      date: "2026-05-06",
    });
    expect(out.available).toBe(true);
    // Second call is the calendar-quarter transcript request.
    const transcriptCall = spy.mock.calls.find(
      (c) =>
        new URL((c[0] as URL).toString()).searchParams.get("function") ===
        "EARNINGS_CALL_TRANSCRIPT",
    )!;
    expect(transcriptCall).toBeDefined();
    // date − 90d = 2026-02-05 → the completed quarter is 2026Q1.
    expect(
      new URL((transcriptCall[0] as URL).toString()).searchParams.get("quarter"),
    ).toBe("2026Q1");
  });

  it("degrades immediately without a transcript call when the probe is budget-blocked", async () => {
    process.env.ALPHAVANTAGE_DAILY_LIMIT = "1";
    // First unit consumed by an unrelated call; the EARNINGS probe then throws budget.
    const spy = mockFetchByFunction({
      PRIME: { ok: 1 },
      EARNINGS: NONCAL_EARNINGS,
      EARNINGS_CALL_TRANSCRIPT: TRANSCRIPT,
    });
    await alphaVantageRequest({ function: "PRIME", symbol: "X" }); // spend the 1 unit
    await expect(
      fetchAlphaVantageEarningsTranscript({ ticker: "AAPL", date: "2026-05-06" }),
    ).rejects.toBeInstanceOf(AlphaVantageBudgetError);
    // Only the PRIME call fetched; no probe, no transcript.
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("fetchAlphaVantageAnalystEnrichment", () => {
  it("fills priceTargets from OVERVIEW and consensusEstimates from EARNINGS_ESTIMATES", async () => {
    mockFetchByFunction({
      OVERVIEW: { Symbol: "NVDA", AnalystTargetPrice: "175.50" },
      EARNINGS_ESTIMATES: {
        symbol: "NVDA",
        estimates: [
          {
            horizon: "current fiscal year",
            eps_estimate_average: "4.20",
            revenue_estimate_average: "130000000000",
            eps_estimate_number_of_analysts: "40",
          },
        ],
      },
    });
    const out = await fetchAlphaVantageAnalystEnrichment("NVDA");
    expect(out.priceTargets).toMatchObject({ consensus: 175.5, high: null, low: null, median: null });
    expect(out.consensusEstimates).toMatchObject({
      fyEpsAvg: 4.2,
      fyRevenueAvg: 130000000000,
      numAnalysts: 40,
    });
  });

  it("is per-field independent — OVERVIEW fills while EARNINGS_ESTIMATES rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input: unknown) => {
      const fn = new URL((input as URL).toString()).searchParams.get("function");
      if (fn === "OVERVIEW") {
        return Promise.resolve(
          new Response(JSON.stringify({ AnalystTargetPrice: "175.50" }), { status: 200 }),
        );
      }
      // EARNINGS_ESTIMATES → rate-limit body → throws, must not reject OVERVIEW.
      return Promise.resolve(
        new Response(JSON.stringify({ Note: "frequency" }), { status: 200 }),
      );
    });
    const out = await fetchAlphaVantageAnalystEnrichment("NVDA");
    expect(out.priceTargets?.consensus).toBe(175.5);
    expect(out.consensusEstimates).toBeNull();
  });

  it("returns null priceTargets (not an all-null object) for an AV 'None' target price", async () => {
    // Degrade-honestly: a success-but-empty OVERVIEW must not present as a real
    // answer, so the whole priceTargets object is null, not { consensus: null }.
    mockFetchByFunction({
      OVERVIEW: { AnalystTargetPrice: "None" },
      EARNINGS_ESTIMATES: { estimates: [] },
    });
    const out = await fetchAlphaVantageAnalystEnrichment("NVDA");
    expect(out.priceTargets).toBeNull();
    expect(out.consensusEstimates).toBeNull();
  });
});
