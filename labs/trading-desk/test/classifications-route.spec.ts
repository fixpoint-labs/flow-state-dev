/**
 * Route-level tests for the sector classification fill surface (FIX-762):
 *  - `GET /api/portfolio/classifications?tickers=…` — read cached sectors, resolve
 *    misses via the existing Yahoo `resolveSector`, and cache SUCCESSES ONLY.
 *
 * Drives the real handler against an in-memory PGlite repository (the
 * `portfolio-quotes-route` precedent); `resolveSector` is mocked so the fill path
 * runs offline and deterministically.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeTestRepository } from "./_helpers/portfolio-repo";
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

beforeEach(async () => {
  repoState.repo = await makeTestRepository();
  sectorMock.resolveSector.mockReset();
});

function get(tickers?: string): NextRequest {
  const url =
    tickers === undefined
      ? "http://localhost/api/portfolio/classifications"
      : `http://localhost/api/portfolio/classifications?tickers=${encodeURIComponent(tickers)}`;
  return new NextRequest(url);
}

type Body = { classifications: Array<{ ticker: string; sector: string | null }> };

describe("GET /api/portfolio/classifications", () => {
  it("resolves misses via Yahoo, returns them, and caches successes", async () => {
    sectorMock.resolveSector.mockImplementation(async (ticker: string) => ({
      sector: ticker === "AAPL" ? "Technology" : "Financial Services",
      industry: null,
      sectorEtf: null,
    }));

    const res = await GET(get("aapl,jpm"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Body;
    const bySector = new Map(body.classifications.map((c) => [c.ticker, c.sector]));
    expect(bySector.get("AAPL")).toBe("Technology");
    expect(bySector.get("JPM")).toBe("Financial Services");

    // Successes were cached: a second request serves them without re-resolving.
    sectorMock.resolveSector.mockClear();
    await GET(get("AAPL,JPM"));
    expect(sectorMock.resolveSector).not.toHaveBeenCalled();
    expect((await repoState.repo!.getInstrumentClassifications(["AAPL"]))[0]?.sector).toBe("Technology");
  });

  it("returns a null sector for an unresolved ticker and does NOT cache it (retried later)", async () => {
    sectorMock.resolveSector.mockResolvedValue({ sector: null, industry: null, sectorEtf: null });

    const res = await GET(get("ZZZZ"));
    const body = (await res.json()) as Body;
    expect(body.classifications).toEqual([{ ticker: "ZZZZ", sector: null }]);
    // A miss is never persisted — the table stays empty so a later request retries.
    expect(await repoState.repo!.getInstrumentClassifications(["ZZZZ"])).toEqual([]);
    // A second request resolves again (not served from a poisoned null row).
    sectorMock.resolveSector.mockClear();
    await GET(get("ZZZZ"));
    expect(sectorMock.resolveSector).toHaveBeenCalledTimes(1);
  });

  it("de-dupes and upper-cases tickers before resolving", async () => {
    sectorMock.resolveSector.mockResolvedValue({ sector: "Technology", industry: null, sectorEtf: null });
    await GET(get("aapl,AAPL,Aapl"));
    expect(sectorMock.resolveSector).toHaveBeenCalledTimes(1);
    expect(sectorMock.resolveSector).toHaveBeenCalledWith("AAPL", expect.any(String));
  });

  it("400s on a missing tickers param", async () => {
    expect((await GET(get(undefined))).status).toBe(400);
  });

  it("400s on an empty tickers param", async () => {
    expect((await GET(get(""))).status).toBe(400);
    expect((await GET(get(",, ,"))).status).toBe(400);
  });

  it("400s above the sanity cap of 200 tickers", async () => {
    const many = Array.from({ length: 201 }, (_, i) => `T${i}`).join(",");
    const res = await GET(get(many));
    expect(res.status).toBe(400);
    expect(sectorMock.resolveSector).not.toHaveBeenCalled();
  });
});
