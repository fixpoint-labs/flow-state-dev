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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  // The route gates on hasAlphaVantageKey() before attempting any fill
  // (Codex review, FIX-801 sub-PR a) — set a key by default so the existing
  // fetch-path tests exercise the mocked fetcher as before; the dedicated
  // no-key test below deletes it.
  process.env.ALPHAVANTAGE_API_KEY = "test-key";
});

afterEach(() => {
  delete process.env.ALPHAVANTAGE_API_KEY;
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

  it("stamps a retry boundary on a preserved-payload refresh failure — a repeatedly-failing refresh does not retry on every read (Codex review P1)", async () => {
    await seedEtf("SPY");
    fetcherMock.fetchEtfProfile.mockResolvedValueOnce({ kind: "profile", profile: SAMPLE_PROFILE });
    await GET(get(USER_ID));

    await backdateFetchedAt("SPY", 31);
    // Capture the (backdated) fetchedAt the preserve-write is expected to
    // keep — this IS the "prior successful fetch time" from the write's
    // point of view, not the pre-backdate value.
    const backdatedFetchedAt = (await repoState.repo!.getEtfProfiles(["SPY"]))[0]!.fetchedAt;
    fetcherMock.fetchEtfProfile.mockClear();
    fetcherMock.fetchEtfProfile.mockRejectedValueOnce(new Error("network blip"));
    await GET(get(USER_ID)); // the refresh attempt fails; the payload is preserved

    const stored = (await repoState.repo!.getEtfProfiles(["SPY"]))[0]!;
    expect(stored.payload).not.toBeNull(); // preserved (the existing guard)
    expect(stored.retryAt).not.toBeNull(); // a backoff boundary was recorded
    // CRITICAL (follow-up review): fetchedAt must NOT be bumped to "now" on
    // this write — isDueForFetch checks staleness (fetchedAt) BEFORE it ever
    // looks at retryAt, so if fetchedAt advanced the row would look freshly
    // fetched and the retryAt boundary above would never actually be
    // consulted, silently defeating the backoff.
    expect(new Date(stored.fetchedAt).getTime()).toBe(new Date(backdatedFetchedAt).getTime());

    // A second read, still within that backoff window and still "stale" by
    // fetchedAt, must NOT retry the refresh — the retryAt boundary is what
    // stops a repeatedly-failing refresh from re-attempting on every read.
    fetcherMock.fetchEtfProfile.mockClear();
    const res = await GET(get(USER_ID));
    expect(fetcherMock.fetchEtfProfile).not.toHaveBeenCalled();
    const body = (await res.json()) as EtfProfilesResponse;
    expect(body.profiles.map((p) => p.ticker)).toEqual(["SPY"]);
  });

  it("gates on hasAlphaVantageKey() before attempting any fill — no key configured means no fetch and nothing persisted (Codex review)", async () => {
    await seedEtf("SPY");
    delete process.env.ALPHAVANTAGE_API_KEY;

    const res = await GET(get(USER_ID));
    expect(fetcherMock.fetchEtfProfile).not.toHaveBeenCalled();
    const body = (await res.json()) as EtfProfilesResponse;
    expect(body.profiles).toEqual([]);
    expect(body.refusals).toEqual([]); // no persisted "transient" refusal either
    expect(await repoState.repo!.getEtfProfiles(["SPY"])).toEqual([]);

    // Configuring the key afterward unblocks the ticker immediately — no
    // lingering refusal/backoff from the keyless period.
    process.env.ALPHAVANTAGE_API_KEY = "test-key";
    fetcherMock.fetchEtfProfile.mockResolvedValueOnce({ kind: "profile", profile: SAMPLE_PROFILE });
    const res2 = await GET(get(USER_ID));
    const body2 = (await res2.json()) as EtfProfilesResponse;
    expect(body2.profiles.map((p) => p.ticker)).toEqual(["SPY"]);
  });

  it("a sequential race: a caller whose own pre-fetch snapshot is stale re-checks fresh state under the lease and skips a redundant fetch (Codex review P2)", async () => {
    await seedEtf("SPY");
    await backdateFetchedAt("SPY", 31); // force both callers to see it as stale up front

    fetcherMock.fetchEtfProfile.mockResolvedValueOnce({ kind: "profile", profile: SAMPLE_PROFILE });

    // Start call2 but let it only begin its own initial repo reads before
    // call1 runs all the way to completion (fetch + persist + lease
    // release) — call2's OWN request-local snapshot is taken from THIS
    // point, before call1's write lands.
    const call2Promise = GET(get(USER_ID));
    await Promise.resolve();

    const res1 = await GET(get(USER_ID));
    const body1 = (await res1.json()) as EtfProfilesResponse;
    expect(body1.profiles.map((p) => p.ticker)).toEqual(["SPY"]);
    expect(fetcherMock.fetchEtfProfile).toHaveBeenCalledTimes(1);

    // call2 now reaches its own fetch decision. Without the lease-scoped
    // fresh re-read, its stale local snapshot would say "still a miss" and
    // it would spend a second unit (and, if that attempt failed, risk
    // clobbering call1's fresh success per the earlier guard).
    const res2 = await call2Promise;
    const body2 = (await res2.json()) as EtfProfilesResponse;
    expect(body2.profiles.map((p) => p.ticker)).toEqual(["SPY"]);
    expect(fetcherMock.fetchEtfProfile).toHaveBeenCalledTimes(1); // NOT called again
  });

  it("propagates a quota hit to a caller deduped onto another caller's lease for the same ticker (Codex review P2)", async () => {
    // Both concurrent requests need the SAME new ticker — the lease dedupes
    // them onto one execution. Whichever caller actually runs the fetch sets
    // its OWN local `quotaHit`; the deduped caller must independently learn
    // the same thing from the lease's shared return value, not just receive
    // the row.
    await seedEtf("SPY");
    const { AlphaVantageBudgetError } = await import("@/lib/providers/alpha-vantage");
    fetcherMock.fetchEtfProfile.mockRejectedValue(new AlphaVantageBudgetError(25));

    const [res1, res2] = await Promise.all([GET(get(USER_ID)), GET(get(USER_ID))]);
    expect(fetcherMock.fetchEtfProfile).toHaveBeenCalledTimes(1); // deduped to one attempt
    const body1 = (await res1.json()) as EtfProfilesResponse;
    const body2 = (await res2.json()) as EtfProfilesResponse;
    // Both callers see the SAME quota refusal — the deduped one didn't fall
    // back to some other (stale or empty) view of the ticker.
    for (const body of [body1, body2]) {
      expect(body.refusals).toEqual([
        expect.objectContaining({ ticker: "SPY", reason: "quota" }),
      ]);
    }
  });

  it("when this instance's own write loses the cross-process freshness race, the response reflects what's actually stored, not the local write attempt (Codex review round 2, FIX-801 sub-PR a)", async () => {
    await seedEtf("SPY");
    // Establish a first stored success, then force it stale so the next GET
    // treats it as due for a refresh.
    fetcherMock.fetchEtfProfile.mockResolvedValueOnce({ kind: "profile", profile: SAMPLE_PROFILE });
    await GET(get(USER_ID));
    await backdateFetchedAt("SPY", 31);

    // This GET's own refresh attempt will FAIL (transient), so it computes a
    // success-shaped PRESERVED-payload write carrying the OLD (backdated)
    // fetchedAt forward. Intercept the route's OWN upsert call — the exact
    // moment it reaches Postgres — and land a "concurrent instance"'s
    // genuinely fresh write immediately before it, deterministically
    // (no timing-dependent promise juggling around the real PGlite I/O).
    fetcherMock.fetchEtfProfile.mockClear();
    fetcherMock.fetchEtfProfile.mockRejectedValueOnce(new Error("network blip"));
    // nameCoverage (not netExpenseRatio/inceptionDate, which the route's
    // response projection deliberately drops) is the distinguishing marker —
    // it's one of the fields `EtfProfileEntry` actually carries through.
    const FRESHER_PROFILE: NormalizedEtfProfile = { ...SAMPLE_PROFILE, nameCoverage: 0.42 };
    const originalUpsert = repoState.repo!.upsertEtfProfiles.bind(repoState.repo!);
    vi.spyOn(repoState.repo!, "upsertEtfProfiles").mockImplementation(async (rows) => {
      await originalUpsert([{ ticker: "SPY", payload: FRESHER_PROFILE, refusalReason: null }]);
      return originalUpsert(rows);
    });

    const res = await GET(get(USER_ID));
    const body = (await res.json()) as EtfProfilesResponse;

    // The route's own write (the stale preserved-payload one) was silently
    // dropped by the repository's freshness guard — the concurrent instance's
    // fresher row won. The response must reflect THAT row, not this
    // request's own (losing) write intent.
    const spy = body.profiles.find((p) => p.ticker === "SPY");
    expect(spy?.nameCoverage).toBeCloseTo(0.42);
    const stored = (await repoState.repo!.getEtfProfiles(["SPY"]))[0]!;
    expect(stored.payload?.nameCoverage).toBeCloseTo(0.42);
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
