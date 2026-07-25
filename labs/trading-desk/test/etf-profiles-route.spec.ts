/**
 * Route-level tests for the ETF profile fill surface (FIX-801 §8 step 3):
 *  - `GET /api/portfolio/etf-profiles?userId=…` — derive the held eligible
 *    fund tickers SERVER-SIDE, fetch only the misses/stale (paced, capped),
 *    persist successes AND refusals, honour backoff, and never clobber a
 *    stored success with a refusal from a failed refresh attempt.
 *
 * Drives the real handler against an in-memory PGlite repository (the
 * `classifications-route` precedent); `fetchEtfProfile` is mocked so the fill
 * path runs offline and deterministically.
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { seedAccount } from "./_helpers/portfolio-repo";
import { _resetLeases } from "@/lib/singleflight";
import { createMigratedPgliteDb, type Db } from "@/db/client";
import { createPortfolioRepository, type PortfolioRepository } from "@/db/repository";
import { etfProfiles } from "@/db/schema";
import type { NormalizedEtfProfile } from "@/lib/providers/etf-profile";

const MIGRATIONS_DIR = fileURLToPath(new URL("../db/migrations", import.meta.url));

const repoState = vi.hoisted(() => ({
  repo: null as PortfolioRepository | null,
  db: null as Db | null,
}));
vi.mock("@/db/portfolio-db", () => ({
  getRepository: async () => {
    if (!repoState.repo) throw new Error("test repository not initialized");
    return repoState.repo;
  },
}));

/** Backdate a stored ETF profile's `fetched_at` past the staleness bound —
 *  the repository's public API always stamps `now()` on write, so forcing a
 *  genuinely stale row (rather than asserting only the fresh/no-refetch path)
 *  needs a direct write against the migrated table (reviewer follow-up on
 *  FIX-801 sub-PR a: the original spec admitted it couldn't force staleness). */
async function backdateFetchedAt(ticker: string, daysAgo: number): Promise<void> {
  await repoState.db!
    .update(etfProfiles)
    .set({ fetchedAt: sql`now() - (${daysAgo} || ' days')::interval` })
    .where(eq(etfProfiles.ticker, ticker.toUpperCase()));
}

const fetcherMock = vi.hoisted(() => ({ fetchEtfProfile: vi.fn() }));
vi.mock("@/lib/providers/etf-profile", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/providers/etf-profile")>();
  return { ...actual, fetchEtfProfile: fetcherMock.fetchEtfProfile };
});

import {
  GET,
  ETF_PROFILE_MISS_CAP,
  type EtfProfilesResponse,
} from "../app/api/portfolio/etf-profiles/route";

const USER_ID = "devuser";

const SAMPLE_PROFILE: NormalizedEtfProfile = {
  leveraged: false,
  constituents: [{ ticker: "AAPL", weight: 0.07 }],
  nameCoverage: 0.99,
  sectors: [{ sector: "Technology", weight: 0.3 }],
  sectorCoverage: 0.96,
  netExpenseRatio: 0.03,
  inceptionDate: "1993-01-22",
};

beforeEach(async () => {
  const db = await createMigratedPgliteDb(new PGlite(), MIGRATIONS_DIR);
  repoState.db = db;
  repoState.repo = createPortfolioRepository(db);
  fetcherMock.fetchEtfProfile.mockReset();
  _resetLeases();
});

function get(userId?: string): NextRequest {
  const url =
    userId === undefined
      ? "http://localhost/api/portfolio/etf-profiles"
      : `http://localhost/api/portfolio/etf-profiles?userId=${encodeURIComponent(userId)}`;
  return new NextRequest(url);
}

async function seedEtf(ticker: string, quantity = 5, price = 400): Promise<void> {
  await seedAccount(repoState.repo!, {
    accountId: `acc-${ticker}`,
    userId: USER_ID,
    holdings: [
      {
        ticker,
        quantity,
        costBasis: 300,
        acquiredDate: null,
        assetClass: "equity",
        assetType: "etf",
        attributes: { kind: "none" },
      },
    ],
  });
  await repoState.repo!.upsertQuotes([{ ticker, price, asOf: null, source: "live" }]);
}

describe("GET /api/portfolio/etf-profiles", () => {
  it("derives the eligible fund tickers server-side and fetches only misses", async () => {
    await seedEtf("SPY");
    fetcherMock.fetchEtfProfile.mockResolvedValue({ kind: "profile", profile: SAMPLE_PROFILE });

    const res = await GET(get(USER_ID));
    expect(res.status).toBe(200);
    const body = (await res.json()) as EtfProfilesResponse;
    expect(body.profiles.map((p) => p.ticker)).toEqual(["SPY"]);
    expect(body.refusals).toEqual([]);
    expect(fetcherMock.fetchEtfProfile).toHaveBeenCalledTimes(1);
    expect(fetcherMock.fetchEtfProfile).toHaveBeenCalledWith("SPY");

    // Cached: a second request within the staleness bound doesn't re-fetch.
    fetcherMock.fetchEtfProfile.mockClear();
    await GET(get(USER_ID));
    expect(fetcherMock.fetchEtfProfile).not.toHaveBeenCalled();
  });

  it("two overlapping requests for the same NEW ticker share ONE fetch-and-persist, not two (Codex review — the lease must cover the write, not just the fetch)", async () => {
    await seedEtf("SPY");
    const upsertSpy = vi.spyOn(repoState.repo!, "upsertEtfProfiles");
    let resolveFetch!: (v: { kind: "profile"; profile: NormalizedEtfProfile }) => void;
    const pending = new Promise<{ kind: "profile"; profile: NormalizedEtfProfile }>((resolve) => {
      resolveFetch = resolve;
    });
    fetcherMock.fetchEtfProfile.mockReturnValue(pending);

    // Two concurrent GETs — the miss-detection read in each has already
    // happened by the time either reaches the fetch, so without a lease that
    // spans the WRITE too, both would independently decide "SPY is a miss".
    const call1 = GET(get(USER_ID));
    const call2 = GET(get(USER_ID));
    await Promise.resolve(); // let both requests reach the fetch stage
    resolveFetch({ kind: "profile", profile: SAMPLE_PROFILE });
    const [res1, res2] = await Promise.all([call1, call2]);

    expect(fetcherMock.fetchEtfProfile).toHaveBeenCalledTimes(1); // one upstream call, not two
    expect(upsertSpy).toHaveBeenCalledTimes(1); // one write, not two
    const body1 = (await res1.json()) as EtfProfilesResponse;
    const body2 = (await res2.json()) as EtfProfilesResponse;
    expect(body1.profiles.map((p) => p.ticker)).toEqual(["SPY"]);
    expect(body2.profiles.map((p) => p.ticker)).toEqual(["SPY"]);
  });

  it("does not fan out for a fund-less book", async () => {
    await seedAccount(repoState.repo!, {
      accountId: "acc-1",
      userId: USER_ID,
      holdings: [
        { ticker: "AAPL", quantity: 10, costBasis: 150, acquiredDate: null, assetClass: "equity", assetType: "equity", attributes: { kind: "none" } },
      ],
    });
    const res = await GET(get(USER_ID));
    expect(res.status).toBe(200);
    expect((await res.json()) as EtfProfilesResponse).toEqual({ profiles: [], refusals: [] });
    expect(fetcherMock.fetchEtfProfile).not.toHaveBeenCalled();
  });

  it("costs zero fetches for a pre-filtered known bond ETF (fixed_income asset class)", async () => {
    await seedAccount(repoState.repo!, {
      accountId: "acc-1",
      userId: USER_ID,
      holdings: [
        { ticker: "BND", quantity: 10, costBasis: 80, acquiredDate: null, assetClass: "fixed_income", assetType: "etf", attributes: { kind: "none" } },
      ],
    });
    const res = await GET(get(USER_ID));
    expect((await res.json()) as EtfProfilesResponse).toEqual({ profiles: [], refusals: [] });
    expect(fetcherMock.fetchEtfProfile).not.toHaveBeenCalled();
  });

  it("excludes an unpriced fund from the fetch set (no budget unit for a profile nothing can use)", async () => {
    await seedAccount(repoState.repo!, {
      accountId: "acc-1",
      userId: USER_ID,
      holdings: [
        { ticker: "SPY", quantity: 5, costBasis: 300, acquiredDate: null, assetClass: "equity", assetType: "etf", attributes: { kind: "none" } },
      ],
    });
    // No upsertQuotes call — SPY is unpriced.
    const res = await GET(get(USER_ID));
    expect((await res.json()) as EtfProfilesResponse).toEqual({ profiles: [], refusals: [] });
    expect(fetcherMock.fetchEtfProfile).not.toHaveBeenCalled();
  });

  it("caps how many misses one call fetches, deferring the remainder", async () => {
    const tickers = Array.from({ length: ETF_PROFILE_MISS_CAP + 2 }, (_, i) => `ETF${i}`);
    for (const t of tickers) await seedEtf(t);
    fetcherMock.fetchEtfProfile.mockResolvedValue({ kind: "profile", profile: SAMPLE_PROFILE });

    const res = await GET(get(USER_ID));
    const body = (await res.json()) as EtfProfilesResponse;
    expect(fetcherMock.fetchEtfProfile).toHaveBeenCalledTimes(ETF_PROFILE_MISS_CAP);
    expect(body.profiles).toHaveLength(ETF_PROFILE_MISS_CAP);

    // The next read picks up the deferred remainder.
    fetcherMock.fetchEtfProfile.mockClear();
    const res2 = await GET(get(USER_ID));
    const body2 = (await res2.json()) as EtfProfilesResponse;
    expect(fetcherMock.fetchEtfProfile).toHaveBeenCalledTimes(2);
    expect(body2.profiles).toHaveLength(tickers.length);
  });

  it("writes a refusal and does not re-attempt it inside the backoff window (budget protection)", async () => {
    await seedEtf("TQQQ");
    fetcherMock.fetchEtfProfile.mockResolvedValue({
      kind: "refused",
      reason: "ineligible",
      detail: "leveraged/inverse fund",
    });

    const res = await GET(get(USER_ID));
    const body = (await res.json()) as EtfProfilesResponse;
    expect(body.refusals).toEqual([
      { ticker: "TQQQ", reason: "ineligible", detail: "leveraged/inverse fund", retryAt: expect.any(String) },
    ]);

    fetcherMock.fetchEtfProfile.mockClear();
    const res2 = await GET(get(USER_ID));
    expect(fetcherMock.fetchEtfProfile).not.toHaveBeenCalled();
    const body2 = (await res2.json()) as EtfProfilesResponse;
    expect(body2.refusals[0]?.ticker).toBe("TQQQ"); // still reported, from the stored row
  });

  it("a throwing fetch on a FORCED-STALE refresh leaves the stored row intact rather than overwriting it with a refusal", async () => {
    await seedEtf("SPY");
    // First call succeeds and stores a real profile.
    fetcherMock.fetchEtfProfile.mockResolvedValueOnce({ kind: "profile", profile: SAMPLE_PROFILE });
    await GET(get(USER_ID));

    // Force genuine staleness (not just "the route didn't happen to re-fetch")
    // by backdating fetched_at directly, then make the refresh attempt throw.
    await backdateFetchedAt("SPY", 31);
    fetcherMock.fetchEtfProfile.mockClear();
    fetcherMock.fetchEtfProfile.mockRejectedValueOnce(new Error("network blip"));
    const res = await GET(get(USER_ID));
    // The refresh WAS attempted (proving staleness was real, not a no-op)...
    expect(fetcherMock.fetchEtfProfile).toHaveBeenCalledTimes(1);
    // ...but the throw did not clobber the stored profile with a refusal.
    const body = (await res.json()) as EtfProfilesResponse;
    expect(body.profiles.map((p) => p.ticker)).toEqual(["SPY"]);
    expect(body.refusals).toEqual([]);
  });

  it("a REFUSED (non-throwing) outcome on a FORCED-STALE refresh also leaves the stored row intact (Cursor review)", async () => {
    // AV can return a clean HTTP-200 refusal (e.g. an empty/flaky body judged
    // not_an_etf) without throwing at all — this must be guarded exactly like
    // the throw path, or a spurious flaky response silently destroys a good
    // stored profile and stamps a 90-day backoff on top of it.
    await seedEtf("SPY");
    fetcherMock.fetchEtfProfile.mockResolvedValueOnce({ kind: "profile", profile: SAMPLE_PROFILE });
    await GET(get(USER_ID));

    await backdateFetchedAt("SPY", 31);
    fetcherMock.fetchEtfProfile.mockClear();
    fetcherMock.fetchEtfProfile.mockResolvedValueOnce({
      kind: "refused",
      reason: "not_an_etf",
      detail: "empty profile response",
    });
    const res = await GET(get(USER_ID));
    expect(fetcherMock.fetchEtfProfile).toHaveBeenCalledTimes(1); // the refresh WAS attempted
    const body = (await res.json()) as EtfProfilesResponse;
    expect(body.profiles.map((p) => p.ticker)).toEqual(["SPY"]); // still a healthy profile
    expect(body.refusals).toEqual([]); // never turned into a refusal
    // The stored row itself is untouched, not just the response projection.
    const stored = await repoState.repo!.getEtfProfiles(["SPY"]);
    expect(stored[0]?.payload).not.toBeNull();
    expect(stored[0]?.refusalReason).toBeNull();
  });

  it("a genuinely new ticker whose fetch throws (transient) is persisted as a refusal", async () => {
    await seedEtf("SPY");
    fetcherMock.fetchEtfProfile.mockRejectedValueOnce(new Error("ECONNRESET"));
    const res = await GET(get(USER_ID));
    const body = (await res.json()) as EtfProfilesResponse;
    expect(body.refusals).toEqual([
      { ticker: "SPY", reason: "transient", detail: "ECONNRESET", retryAt: expect.any(String) },
    ]);
    expect(body.profiles).toEqual([]);
  });

  it("400s without a userId query param", async () => {
    expect((await GET(get(undefined))).status).toBe(400);
    expect(fetcherMock.fetchEtfProfile).not.toHaveBeenCalled();
  });

  it("returns an empty list when the user has no holdings", async () => {
    const res = await GET(get(USER_ID));
    expect(res.status).toBe(200);
    expect((await res.json()) as EtfProfilesResponse).toEqual({ profiles: [], refusals: [] });
  });
});
