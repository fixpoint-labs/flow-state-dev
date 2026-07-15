/**
 * Regression: Yahoo responses whose usable data is intact but whose strict-schema
 * metadata is incomplete must NOT be discarded.
 *
 * yahoo-finance2 v3 validates each result against a strict bundled schema and
 * THROWS `FailedYahooValidationError` on any miss. Two real cases from the
 * FIX-762 report: a `quoteSummary` with a null `summaryDetail.currency` /
 * incomplete `quoteType` (the sector lookup), and a `chart` with a null
 * `meta.currency` / absent `meta.regularMarketPrice` (the price/quote lookup).
 * Both throws used to discard data we don't even read — the `assetProfile.sector`
 * Yahoo returned, or the OHLCV bars behind unused `meta` — and, because the
 * classifications route only persists successes, re-hit Yahoo on every request.
 *
 * Both fetches fix this by passing `{ validateResult: false }` as the third arg
 * (identity/sector + chart only — the fundamentals + short-interest calls keep
 * strict validation + provider-chain fallback, the correct honest-over-wrong
 * behavior for numeric data feeding analysis).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { quoteSummaryMock, chartMock } = vi.hoisted(() => ({
  quoteSummaryMock: vi.fn(),
  chartMock: vi.fn(),
}));

vi.mock("yahoo-finance2", () => ({
  default: class {
    quoteSummary = quoteSummaryMock;
    chart = chartMock;
  },
}));

import {
  fetchYahooChart,
  fetchYahooCompanyProfile,
  fetchYahooQuoteKind,
  toYahooSymbol,
} from "../lib/providers/yahoo";

/**
 * Faithfully reproduce yahoo-finance2 v3's `moduleExec` contract for both
 * modules: the client THROWS a schema-validation error unless the caller passes
 * `{ validateResult: false }` as the third arg, in which case it returns the raw
 * (un-validated) result untouched. This is exactly the library behavior the fix
 * relies on, so each test fails without the flag and passes with it.
 */
function passesOnlyWithValidateResultFalse(response: unknown, schemaKey: string) {
  return (
    _tickerOrSymbol: string,
    _opts: unknown,
    moduleOpts?: { validateResult?: boolean },
  ) => {
    if (moduleOpts?.validateResult === false) return Promise.resolve(response);
    return Promise.reject(
      new Error(`The following result did not validate with schema: ${schemaKey}`),
    );
  };
}

afterEach(() => {
  quoteSummaryMock.mockReset();
  chartMock.mockReset();
});

describe("fetchYahooCompanyProfile — strict-schema resilience (FIX-762)", () => {
  it("resolves the sector when Yahoo omits currency/timezone metadata that fails strict validation", async () => {
    // assetProfile complete; summaryDetail.currency null; quoteType missing the
    // exchange/timezone fields the strict schema requires — the reported shape.
    quoteSummaryMock.mockImplementation(
      passesOnlyWithValidateResultFalse({
        assetProfile: {
          sector: "Technology",
          industry: "Semiconductors",
          country: "United States",
          website: "https://example.com",
          longBusinessSummary: "Example Corp designs chips.",
          fullTimeEmployees: 1234,
        },
        summaryDetail: { currency: null, marketCap: 3_000_000_000 },
        quoteType: { longName: "Example Corp", shortName: "EXPL" },
      }, "#/definitions/QuoteSummaryResult"),
    );

    const out = await fetchYahooCompanyProfile({ ticker: "EXPL", date: "2026-05-06" });

    expect(out.sector).toBe("Technology");
    expect(out.industry).toBe("Semiconductors");
    expect(out.name).toBe("Example Corp");
    expect(out.marketCapUsd).toBe(3_000_000_000);
    // The field that failed strict validation is simply absent — never fabricated.
    expect(out.currency).toBeNull();
  });

  it("still throws its own 'no profile' signal when the name is genuinely absent", async () => {
    // Skipping validation must not swallow the honest "Yahoo had nothing" signal:
    // an empty profile still throws so the caller falls through the provider chain.
    quoteSummaryMock.mockImplementation(
      passesOnlyWithValidateResultFalse(
        { assetProfile: {}, summaryDetail: {}, quoteType: {} },
        "#/definitions/QuoteSummaryResult",
      ),
    );

    await expect(
      fetchYahooCompanyProfile({ ticker: "NADA", date: "2026-05-06" }),
    ).rejects.toThrow(/no profile/i);
  });

  it("normalizes a dotted class-share ticker (BRK.B) to Yahoo's hyphen spelling before the lookup", async () => {
    // Yahoo has no symbol "BRK.B" — only "BRK-B" — so an unnormalized dotted
    // ticker 404s server-side, which resolveSector's catch{} turns into a
    // silent, permanent "unclassified" (it never persists a Yahoo miss). This
    // fetch is Yahoo-only (no Finnhub fallback like price refresh has), so the
    // gap is otherwise invisible.
    quoteSummaryMock.mockImplementation((symbol: string) =>
      symbol === "BRK-B"
        ? Promise.resolve({
            assetProfile: { sector: "Financial Services" },
            summaryDetail: {},
            quoteType: { longName: "Berkshire Hathaway Inc." },
          })
        : Promise.reject(new Error(`no data found for symbol ${symbol}`)),
    );

    const out = await fetchYahooCompanyProfile({ ticker: "BRK.B", date: "2026-05-06" });

    expect(quoteSummaryMock).toHaveBeenCalledWith(
      "BRK-B",
      expect.anything(),
      expect.anything(),
    );
    expect(out.sector).toBe("Financial Services");
    // The RETURNED ticker still echoes our canonical (dotted) storage key.
    expect(out.ticker).toBe("BRK.B");
  });

  it("preserves a Yahoo exchange-suffix ticker (ASML.AS) instead of hyphenating it", async () => {
    quoteSummaryMock.mockImplementation((symbol: string) =>
      symbol === "ASML.AS"
        ? Promise.resolve({
            assetProfile: { sector: "Technology" },
            summaryDetail: {},
            quoteType: { longName: "ASML Holding N.V." },
          })
        : Promise.reject(new Error(`no data found for symbol ${symbol}`)),
    );

    const out = await fetchYahooCompanyProfile({ ticker: "ASML.AS", date: "2026-05-06" });

    expect(quoteSummaryMock).toHaveBeenCalledWith(
      "ASML.AS",
      expect.anything(),
      expect.anything(),
    );
    expect(out.sector).toBe("Technology");
    expect(out.ticker).toBe("ASML.AS");
  });
});

describe("toYahooSymbol — class-share vs exchange-suffix", () => {
  it("hyphenates US class-share spellings only", () => {
    expect(toYahooSymbol("BRK.B")).toBe("BRK-B");
    expect(toYahooSymbol("BRK/B")).toBe("BRK-B");
    expect(toYahooSymbol("BF.A")).toBe("BF-A");
  });

  it("leaves exchange-suffixed internationals and bare tickers alone", () => {
    expect(toYahooSymbol("ASML.AS")).toBe("ASML.AS");
    expect(toYahooSymbol("7203.T")).toBe("7203.T");
    expect(toYahooSymbol("AAPL")).toBe("AAPL");
    expect(toYahooSymbol("BRK-B")).toBe("BRK-B");
  });
});

describe("fetchYahooChart — strict-schema resilience (FIX-762)", () => {
  it("keeps the OHLCV bars when Yahoo returns incomplete chart meta that fails strict validation", async () => {
    // Real bars present; meta.currency null + regularMarketPrice absent — the
    // exact ChartResultObject failure from the report. The bars live outside
    // `meta`, which fetchYahooChart never reads, so the throw was pure loss.
    chartMock.mockImplementation(
      passesOnlyWithValidateResultFalse(
        {
          meta: { currency: null }, // no regularMarketPrice
          quotes: [
            { date: new Date("2026-05-05"), open: 10, high: 11, low: 9, close: 10.5, volume: 1000 },
            { date: new Date("2026-05-06"), open: 10.5, high: 12, low: 10, close: 11.8, volume: 1500 },
          ],
        },
        "#/definitions/ChartResultObject",
      ),
    );

    const out = await fetchYahooChart({ ticker: "EXPL", date: "2026-05-06", range: "1mo" });

    expect(out.source).toBe("yahoo");
    expect(out.bars).toHaveLength(2);
    expect(out.bars[0]).toMatchObject({ date: "2026-05-05", close: 10.5 });
    expect(out.bars[1]).toMatchObject({ date: "2026-05-06", close: 11.8 });
  });
});

describe("fetchYahooQuoteKind — instrument-kind discriminator (FIX-762 follow-up)", () => {
  it("returns Yahoo's quoteType discriminator string", async () => {
    quoteSummaryMock.mockImplementation(
      passesOnlyWithValidateResultFalse(
        { quoteType: { quoteType: "ETF", longName: "Example Trust ETF" } },
        "#/definitions/QuoteSummaryResult",
      ),
    );

    expect(await fetchYahooQuoteKind("EXPL")).toBe("ETF");
  });

  it("normalizes a dotted class-share ticker before the lookup", async () => {
    quoteSummaryMock.mockImplementation((symbol: string) =>
      symbol === "BRK-B"
        ? Promise.resolve({ quoteType: { quoteType: "EQUITY" } })
        : Promise.reject(new Error(`no data found for symbol ${symbol}`)),
    );

    expect(await fetchYahooQuoteKind("BRK.B")).toBe("EQUITY");
    expect(quoteSummaryMock).toHaveBeenCalledWith("BRK-B", expect.anything(), expect.anything());
  });

  it("returns null (never throws) when Yahoo has nothing for the ticker", async () => {
    quoteSummaryMock.mockRejectedValue(new Error("no data found"));
    expect(await fetchYahooQuoteKind("NADA")).toBeNull();
  });
});
