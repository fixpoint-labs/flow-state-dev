/**
 * Route-level tests for the sector classification fill surface (FIX-762):
 *  - `GET /api/portfolio/classifications?userId=…` — derive the held single-name
 *    equity tickers SERVER-SIDE (the quotes-route precedent, BP-031/033), resolve
 *    misses via the existing Yahoo `resolveSector`, and cache SUCCESSES ONLY.
 *
 * Drives the real handler against an in-memory PGlite repository (the
 * `portfolio-quotes-route` precedent); `resolveSector` is mocked so the fill path
 * runs offline and deterministically.
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

const sectorMock = vi.hoisted(() => ({ resolveSector: vi.fn() }));
vi.mock("@/src/flows/analysis/lib/sector-resolution", () => ({
  resolveSector: sectorMock.resolveSector,
}));

import { GET } from "../app/api/portfolio/classifications/route";

const USER_ID = "devuser";

beforeEach(async () => {
  repoState.repo = await makeTestRepository();
  sectorMock.resolveSector.mockReset();
});

function get(userId?: string): NextRequest {
  const url =
    userId === undefined
      ? "http://localhost/api/portfolio/classifications"
      : `http://localhost/api/portfolio/classifications?userId=${encodeURIComponent(userId)}`;
  return new NextRequest(url);
}

/** Seed one account holding an equity, an ETF, and a bond. */
async function seedMixedBook(): Promise<void> {
  await seedAccount(repoState.repo!, {
    accountId: "acc-1",
    userId: USER_ID,
    holdings: [
      { ticker: "AAPL", quantity: 10, costBasis: 150, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" } },
      { ticker: "SPY", quantity: 5, costBasis: 300, acquiredDate: null, assetClass: "equity", assetType: "etf", attributes: { kind: "none" } },
      { ticker: "912810TW8", quantity: 1, costBasis: null, acquiredDate: null, assetClass: "fixed_income", assetType: "bond", attributes: { kind: "bond", cusip: null, markPrice: 98 } },
    ],
  });
}

type Body = { classifications: Array<{ ticker: string; sector: string | null }> };

describe("GET /api/portfolio/classifications", () => {
  it("resolves ONLY the held equity tickers (server-derived), caching successes", async () => {
    await seedMixedBook();
    sectorMock.resolveSector.mockResolvedValue({ sector: "Technology", industry: null, sectorEtf: null });

    const res = await GET(get(USER_ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    // Only the equity (AAPL) — the ETF and bond don't use the sector axis and
    // are never resolved.
    expect(body.classifications.map((c) => c.ticker)).toEqual(["AAPL"]);
    expect(sectorMock.resolveSector).toHaveBeenCalledTimes(1);
    expect(sectorMock.resolveSector).toHaveBeenCalledWith("AAPL", expect.any(String));

    // The success is cached: a second request serves it without re-resolving.
    sectorMock.resolveSector.mockClear();
    await GET(get(USER_ID));
    expect(sectorMock.resolveSector).not.toHaveBeenCalled();
    expect((await repoState.repo!.getInstrumentClassifications(["AAPL"]))[0]?.sector).toBe("Technology");
  });

  it("does not fan out for a book with no equities (empty result, no provider call)", async () => {
    await seedAccount(repoState.repo!, {
      accountId: "acc-1",
      userId: USER_ID,
      holdings: [
        { ticker: "SPY", quantity: 5, costBasis: 300, acquiredDate: null, assetClass: "equity", assetType: "etf", attributes: { kind: "none" } },
      ],
    });
    const res = await GET(get(USER_ID));
    expect(res.status).toBe(200);
    expect((await res.json()) as Body).toEqual({ classifications: [] });
    expect(sectorMock.resolveSector).not.toHaveBeenCalled();
  });

  it("returns a null sector for an unresolved ticker and does NOT cache it (retried later)", async () => {
    await seedAccount(repoState.repo!, {
      accountId: "acc-1",
      userId: USER_ID,
      holdings: [
        { ticker: "ZZZZ", quantity: 1, costBasis: null, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" } },
      ],
    });
    sectorMock.resolveSector.mockResolvedValue({ sector: null, industry: null, sectorEtf: null });

    const body = (await (await GET(get(USER_ID))).json()) as Body;
    expect(body.classifications).toEqual([{ ticker: "ZZZZ", sector: null }]);
    // A miss is never persisted — the table stays empty so a later request retries.
    expect(await repoState.repo!.getInstrumentClassifications(["ZZZZ"])).toEqual([]);
    sectorMock.resolveSector.mockClear();
    await GET(get(USER_ID));
    expect(sectorMock.resolveSector).toHaveBeenCalledTimes(1);
  });

  it("400s without a userId query param", async () => {
    expect((await GET(get(undefined))).status).toBe(400);
    expect(sectorMock.resolveSector).not.toHaveBeenCalled();
  });

  it("returns an empty list when the user has no holdings", async () => {
    const res = await GET(get(USER_ID));
    expect(res.status).toBe(200);
    expect((await res.json()) as Body).toEqual({ classifications: [] });
  });
});
