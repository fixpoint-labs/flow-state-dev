/**
 * Route-level tests for the quotes REST surface (FIX-823):
 *  - `GET /api/portfolio/quotes` — the read: derive the held ticker set
 *    SERVER-SIDE and return the matching `app.quotes` rows.
 *  - `POST /api/portfolio/quotes/refresh` — the write (converted from the retired
 *    `getQuotes` flow action): derive + FILTER the held ticker set server-side
 *    (only quote-valued types), fetch live prices, and upsert `app.quotes`.
 *
 * Both drive the real handlers against an in-memory PGlite repository (the
 * `portfolio-repository` precedent); the live price provider is mocked so the
 * refresh write path runs offline and deterministically.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeTestRepository, seedAccount } from "./_helpers/portfolio-repo";
import type { PortfolioRepository } from "@/db/repository";

const repoState = vi.hoisted(() => ({ repo: null as PortfolioRepository | null }));
vi.mock("@/db/portfolio-db", () => ({
  getRepository: async () => {
    if (!repoState.repo) throw new Error("test repository not initialized");
    return repoState.repo;
  },
}));

// Mock the live price providers so the refresh route's live path is offline +
// deterministic. Finnhub is keyless (falls through to Yahoo); Yahoo returns
// controlled bars (last bar's close = the current price).
const yahooMock = vi.hoisted(() => ({ fetchYahooChart: vi.fn() }));
vi.mock("@/lib/providers/finnhub", async (importActual) => ({
  ...(await importActual<object>()),
  hasFinnhubKey: () => false,
}));
vi.mock("@/lib/providers/yahoo", async (importActual) => ({
  ...(await importActual<object>()),
  fetchYahooChart: yahooMock.fetchYahooChart,
}));

import { GET } from "../app/api/portfolio/quotes/route";
import { POST } from "../app/api/portfolio/quotes/refresh/route";
import { _resetCache } from "../lib/cache";

const USER_ID = "devuser";

beforeEach(async () => {
  repoState.repo = await makeTestRepository();
  _resetCache();
  yahooMock.fetchYahooChart.mockReset();
});

function get(userId?: string): NextRequest {
  const url =
    userId === undefined
      ? "http://localhost/api/portfolio/quotes"
      : `http://localhost/api/portfolio/quotes?userId=${encodeURIComponent(userId)}`;
  return new NextRequest(url);
}

describe("GET /api/portfolio/quotes", () => {
  it("returns the held tickers' last-known rows for the user", async () => {
    await seedAccount(repoState.repo!, {
      accountId: "acc-1",
      userId: USER_ID,
      holdings: [
        { ticker: "AAPL", quantity: 10, costBasis: 150, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" } },
      ],
    });
    await repoState.repo!.upsertQuotes([
      { ticker: "AAPL", price: 210.5, asOf: "2026-07-08T00:00:00.000Z", source: "live" },
      // A ticker the user does NOT hold — must not be returned (server derives the
      // set from holdings, never from the client).
      { ticker: "MSFT", price: 400, asOf: null, source: "live" },
    ]);

    const res = await GET(get(USER_ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { quotes: Array<{ ticker: string; price: number }> };
    expect(body.quotes.map((q) => q.ticker)).toEqual(["AAPL"]);
    expect(body.quotes[0].price).toBe(210.5);
  });

  it("400s without a userId query param", async () => {
    const res = await GET(get(undefined));
    expect(res.status).toBe(400);
  });

  it("returns an empty list when the user has no holdings", async () => {
    const res = await GET(get(USER_ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { quotes: unknown[] };
    expect(body.quotes).toEqual([]);
  });
});

function post(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/portfolio/quotes/refresh", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/portfolio/quotes/refresh", () => {
  it("fetches + persists only the quote-valued held tickers (server-side filter)", async () => {
    yahooMock.fetchYahooChart.mockImplementation(async (input: { ticker: string }) => ({
      source: "yahoo" as const,
      ticker: input.ticker,
      range: "1mo" as const,
      bars: [{ date: "2026-07-08", open: 0, high: 0, low: 0, close: 210.5, volume: 0 }],
    }));
    await seedAccount(repoState.repo!, {
      accountId: "acc-1",
      userId: USER_ID,
      holdings: [
        { ticker: "AAPL", quantity: 10, costBasis: 150, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" } },
        // A money-market holding values at par, never via a live quote — the route
        // filters it out server-side, so its provider is never called and it never
        // lands a spurious quote row (usesLiveQuote gate, BP-033).
        { ticker: "SPAXX", quantity: 100, costBasis: 1, acquiredDate: null, assetClass: "cash", assetType: "money_market", attributes: { kind: "none" } },
      ],
    });

    const res = await POST(post({ userId: USER_ID }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { quotes: Array<{ ticker: string; price: number | null }> };
    // Only the equity was fetched (the MMF was filtered before the provider call).
    expect(body.quotes.map((q) => q.ticker)).toEqual(["AAPL"]);
    expect(yahooMock.fetchYahooChart).toHaveBeenCalledTimes(1);

    // And only the equity's live price was upserted to the durable table.
    expect((await repoState.repo!.getQuotes(["AAPL"]))[0]).toMatchObject({ ticker: "AAPL", price: 210.5, source: "live" });
    expect(await repoState.repo!.getQuotes(["SPAXX"])).toEqual([]);
  });

  it("400s without a userId body field", async () => {
    const res = await POST(post({}));
    expect(res.status).toBe(400);
  });
});
