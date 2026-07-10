/**
 * Route-level test for `GET /api/portfolio/quotes` (FIX-823).
 *
 * The Portfolio pane reads last-known prices here instead of the retired
 * `portfolioQuotes` resource. The route derives the ticker set SERVER-SIDE from
 * the user's holdings and returns the matching `app.quotes` rows. This drives the
 * real handler against an in-memory PGlite repository (the `portfolio-repository`
 * precedent), asserting it returns only the held tickers' cached rows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeTestRepository, seedAccount } from "./_helpers/portfolio-repo";
import type { PortfolioRepository } from "@/src/db/repository";

const repoState = vi.hoisted(() => ({ repo: null as PortfolioRepository | null }));
vi.mock("@/lib/portfolio-db", () => ({
  getRepository: async () => {
    if (!repoState.repo) throw new Error("test repository not initialized");
    return repoState.repo;
  },
}));

import { GET } from "../app/api/portfolio/quotes/route";

const USER_ID = "devuser";

beforeEach(async () => {
  repoState.repo = await makeTestRepository();
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
