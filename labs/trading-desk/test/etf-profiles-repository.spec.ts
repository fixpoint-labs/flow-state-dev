/**
 * Tests for the ETF-profile store (FIX-801) — the repository pair backing the
 * fill route and the analysis seed.
 *
 * Intent encoded:
 *   1. Round-trip a success row (payload set) and a refusal row (payload null,
 *      reason/detail/retryAt/transientAttempts set), each read back intact.
 *   2. Upsert-on-conflict overwrites in place (a refresh, or a refusal
 *      superseding a stale success and vice versa).
 *   3. Global reference data — no `userId` guard, upper-cased ticker key,
 *      same-batch dedupe, empty-input no-ops (the `instrument_classifications`
 *      precedent).
 *
 * Runs on embedded PGlite (the sibling spec's precedent).
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createMigratedPgliteDb } from "@/db/client";
import { createPortfolioRepository, type PortfolioRepository } from "@/db/repository";
import type { NormalizedEtfProfile } from "@/lib/providers/etf-profile";

const MIGRATIONS_DIR = fileURLToPath(new URL("../db/migrations", import.meta.url));

async function freshRepo(): Promise<PortfolioRepository> {
  const pglite = new PGlite();
  const db = await createMigratedPgliteDb(pglite, MIGRATIONS_DIR);
  return createPortfolioRepository(db);
}

const SAMPLE_PROFILE: NormalizedEtfProfile = {
  leveraged: false,
  constituents: [
    { ticker: "AAPL", weight: 0.07 },
    { ticker: null, weight: 0.01 },
  ],
  nameCoverage: 0.08,
  sectors: [{ sector: "Technology", weight: 0.3 }],
  sectorCoverage: 0.3,
  netExpenseRatio: 0.0945,
  inceptionDate: "1993-01-22",
};

let repo: PortfolioRepository;
beforeEach(async () => {
  repo = await freshRepo();
});

describe("ETF profiles repository (FIX-801)", () => {
  it("round-trips a success row (payload set, no refusal) and omits unknown tickers", async () => {
    await repo.upsertEtfProfiles([{ ticker: "SPY", payload: SAMPLE_PROFILE, refusalReason: null }]);
    const rows = await repo.getEtfProfiles(["SPY", "NOPE"]);
    const byTicker = new Map(rows.map((r) => [r.ticker, r]));
    expect(byTicker.has("NOPE")).toBe(false);
    const spy = byTicker.get("SPY")!;
    expect(spy.payload).toEqual(SAMPLE_PROFILE);
    expect(spy.refusalReason).toBeNull();
    expect(spy.refusalDetail).toBeNull();
    expect(spy.retryAt).toBeNull();
    expect(spy.transientAttempts).toBe(0);
    expect(typeof spy.fetchedAt).toBe("string");
  });

  it("round-trips a refusal row (payload null, reason/detail/retryAt/transientAttempts set)", async () => {
    const retryAt = new Date("2026-08-01T00:00:00.000Z").toISOString();
    await repo.upsertEtfProfiles([
      {
        ticker: "TQQQ",
        payload: null,
        refusalReason: "ineligible",
        refusalDetail: "leveraged/inverse fund",
        retryAt,
        transientAttempts: 0,
      },
    ]);
    const rows = await repo.getEtfProfiles(["TQQQ"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toBeNull();
    expect(rows[0].refusalReason).toBe("ineligible");
    expect(rows[0].refusalDetail).toBe("leveraged/inverse fund");
    expect(rows[0].retryAt).toBe(retryAt);
  });

  it("upper-cases the ticker on read and write", async () => {
    await repo.upsertEtfProfiles([{ ticker: "spy", payload: SAMPLE_PROFILE, refusalReason: null }]);
    const rows = await repo.getEtfProfiles(["sPy"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].ticker).toBe("SPY");
  });

  it("a refusal upsert does NOT overwrite an existing success — the atomic cross-process guard (Codex review, FIX-801 sub-PR a)", async () => {
    // This is the repository-level enforcement of the same invariant the
    // route's JS-side `hasStoredSuccess` guard already applies — pushed into
    // the upsert's SQL so it holds atomically across concurrent Postgres
    // writers (multiple route instances), not just within one Node process.
    // Simulates the race directly: two upserts in sequence where the SECOND
    // (the refusal) is the "loser" case and must be silently dropped, not
    // applied — exactly what a losing concurrent writer's commit would do.
    await repo.upsertEtfProfiles([{ ticker: "VXX", payload: SAMPLE_PROFILE, refusalReason: null }]);
    await repo.upsertEtfProfiles([
      {
        ticker: "VXX",
        payload: null,
        refusalReason: "malformed",
        refusalDetail: "weights over 100%",
        retryAt: new Date().toISOString(),
        transientAttempts: 0,
      },
    ]);
    const rows = await repo.getEtfProfiles(["VXX"]);
    expect(rows).toHaveLength(1);
    // The success payload survives — the refusal write was a no-op.
    expect(rows[0].payload).toEqual(SAMPLE_PROFILE);
    expect(rows[0].refusalReason).toBeNull();
  });

  it("a success upsert with an OLDER fetchedAt than the currently-stored row does NOT overwrite it — the freshness guard (Codex review round 2, FIX-801 sub-PR a)", async () => {
    // The first WHERE-clause fix (the test above) only distinguished
    // refusal-shaped vs. success-shaped writes, which left a residual gap: a
    // SUCCESS-shaped write can itself be stale — the route's "preserved
    // payload" case carries the OLD fetchedAt forward on purpose (so a
    // backoff-only write doesn't look freshly fetched), and that old
    // fetchedAt can be older than a fresher row a DIFFERENT concurrent
    // instance already persisted. Simulates that race directly: instance A's
    // fresh success lands first, then instance B's own stale preserved-
    // payload write (still success-shaped, but with an older fetchedAt) must
    // be silently dropped, not applied.
    const freshWriteTime = new Date();
    await repo.upsertEtfProfiles([{ ticker: "IVV", payload: SAMPLE_PROFILE, refusalReason: null }]);
    const afterFresh = (await repo.getEtfProfiles(["IVV"]))[0]!;
    expect(afterFresh.payload).toEqual(SAMPLE_PROFILE);
    expect(new Date(afterFresh.fetchedAt).getTime()).toBeGreaterThanOrEqual(freshWriteTime.getTime());

    const staleProfile: NormalizedEtfProfile = { ...SAMPLE_PROFILE, netExpenseRatio: 0.5 }; // distinguishable
    const staleFetchedAt = new Date(new Date(afterFresh.fetchedAt).getTime() - 60_000).toISOString(); // 1 minute OLDER
    await repo.upsertEtfProfiles([
      {
        ticker: "IVV",
        payload: staleProfile,
        refusalReason: null,
        retryAt: new Date().toISOString(),
        transientAttempts: 0,
        fetchedAt: staleFetchedAt, // a preserved-payload write carrying the OLD fetch time forward
      },
    ]);
    const rows = await repo.getEtfProfiles(["IVV"]);
    expect(rows).toHaveLength(1);
    // The fresher row survives — the stale success-shaped write was a no-op.
    expect(rows[0].payload).toEqual(SAMPLE_PROFILE);
    expect(rows[0].fetchedAt).toBe(afterFresh.fetchedAt);
  });

  it("a success upsert for a genuinely new ticker (no existing row) is never blocked by the guard", async () => {
    await repo.upsertEtfProfiles([
      {
        ticker: "NEWT",
        payload: null,
        refusalReason: "not_an_etf",
        refusalDetail: "no profile",
        retryAt: new Date().toISOString(),
        transientAttempts: 0,
      },
    ]);
    const rows = await repo.getEtfProfiles(["NEWT"]);
    expect(rows[0].payload).toBeNull();
    expect(rows[0].refusalReason).toBe("not_an_etf");
  });

  it("overwrites in place — a success supersedes a stale refusal (coverage improved on refresh)", async () => {
    await repo.upsertEtfProfiles([
      {
        ticker: "VXX",
        payload: null,
        refusalReason: "transient",
        refusalDetail: "network error",
        retryAt: new Date().toISOString(),
        transientAttempts: 1,
      },
    ]);
    await repo.upsertEtfProfiles([{ ticker: "VXX", payload: SAMPLE_PROFILE, refusalReason: null }]);
    const rows = await repo.getEtfProfiles(["VXX"]);
    expect(rows[0].payload).toEqual(SAMPLE_PROFILE);
    expect(rows[0].refusalReason).toBeNull();
    expect(rows[0].transientAttempts).toBe(0); // cleared on a success
  });

  it("a TRANSPORT-class refusal (transient/quota) does NOT overwrite an existing DOMAIN-class refusal — refusal-type precedence (Codex review, FIX-801 sub-PR c)", async () => {
    // The prior WHERE-clause guard only distinguished refusal-shaped vs.
    // success-shaped writes, treating "any refusal beats any refusal" —
    // which let a network-blip/quota-hit write from a losing concurrent
    // instance silently downgrade an already-recorded DEFINITIVE domain
    // judgment (a real AV response saying "this isn't an ETF") down to a
    // 15-minute/next-reset backoff, causing the very next read to re-spend a
    // budget unit re-litigating a settled question.
    await repo.upsertEtfProfiles([
      {
        ticker: "NOTETF",
        payload: null,
        refusalReason: "not_an_etf",
        refusalDetail: "no profile",
        retryAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        transientAttempts: 0,
      },
    ]);
    await repo.upsertEtfProfiles([
      {
        ticker: "NOTETF",
        payload: null,
        refusalReason: "transient",
        refusalDetail: "network error",
        retryAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        transientAttempts: 1,
      },
    ]);
    const rows = await repo.getEtfProfiles(["NOTETF"]);
    expect(rows).toHaveLength(1);
    // The domain refusal survives — the transport-failure write was a no-op.
    expect(rows[0].refusalReason).toBe("not_an_etf");
    expect(rows[0].transientAttempts).toBe(0);
  });

  it("a TRANSPORT-class refusal DOES overwrite a DOMAIN-class refusal once the domain refusal's OWN backoff has expired — the legitimate sequential retry (Codex review, FIX-801 sub-PR c round 7)", async () => {
    // The precedence guard above must only block the CONCURRENT-race case —
    // a domain refusal still WITHIN its backoff window. Once `retry_at` is
    // in the past, the route's own `isDueForFetch` gate lets a fresh attempt
    // through, and if THAT attempt hits a transient/quota failure, this is
    // not "clobbering a settled verdict" — the verdict's hold period is over
    // and a new outcome is being recorded. Without this expiry check, that
    // legitimate write would be silently dropped, `retry_at` would never
    // advance, and every subsequent read would immediately re-attempt
    // forever instead of backing off on the fresh transient/quota failure.
    await repo.upsertEtfProfiles([
      {
        ticker: "EXPIRED",
        payload: null,
        refusalReason: "not_an_etf",
        refusalDetail: "no profile",
        retryAt: new Date(Date.now() - 1000).toISOString(), // already past
        transientAttempts: 0,
      },
    ]);
    const freshRetryAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    await repo.upsertEtfProfiles([
      {
        ticker: "EXPIRED",
        payload: null,
        refusalReason: "transient",
        refusalDetail: "network error on retry",
        retryAt: freshRetryAt,
        transientAttempts: 1,
      },
    ]);
    const rows = await repo.getEtfProfiles(["EXPIRED"]);
    expect(rows).toHaveLength(1);
    // The write landed — retry_at advanced to the fresh transient backoff.
    expect(rows[0].refusalReason).toBe("transient");
    expect(rows[0].transientAttempts).toBe(1);
    expect(rows[0].retryAt).toBe(freshRetryAt);
  });

  it("a TRANSPORT-class PRESERVED-PAYLOAD refresh write does NOT overwrite a DOMAIN-class one recorded first for the SAME stale payload — equal fetchedAt can't be a tiebreaker (Codex review, FIX-801 sub-PR c round 10)", async () => {
    // Two instances concurrently REFRESH the same stale SUCCESSFUL profile.
    // Both writes PRESERVE the old payload/fetchedAt (the round-6/7
    // freshness check can't discriminate "older" between them — they're
    // equal), one gets a domain refusal, the other a transport failure.
    // Without extending the refusal-type precedence to this preserved-
    // payload shape too, whichever wrote SECOND would win regardless of
    // class — the same budget-waste consequence the payload-less precedence
    // (rounds 6/7) was built to prevent.
    await repo.upsertEtfProfiles([
      { ticker: "REFRESHRACE", payload: SAMPLE_PROFILE, refusalReason: null },
    ]);
    const staleFetchedAt = (await repo.getEtfProfiles(["REFRESHRACE"]))[0]!.fetchedAt;

    // Instance A: refresh hits a domain refusal (a real AV response).
    await repo.upsertEtfProfiles([
      {
        ticker: "REFRESHRACE",
        payload: SAMPLE_PROFILE,
        refusalReason: "not_an_etf",
        refusalDetail: "no profile on refresh",
        retryAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        transientAttempts: 0,
        fetchedAt: staleFetchedAt,
      },
    ]);
    // Instance B: refresh hits a transport failure, lands SECOND, same
    // preserved (stale) fetchedAt.
    await repo.upsertEtfProfiles([
      {
        ticker: "REFRESHRACE",
        payload: SAMPLE_PROFILE,
        refusalReason: "transient",
        refusalDetail: "network error",
        retryAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        transientAttempts: 1,
        fetchedAt: staleFetchedAt,
      },
    ]);

    const rows = await repo.getEtfProfiles(["REFRESHRACE"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).not.toBeNull(); // still a usable, attributable profile
    expect(rows[0].refusalReason).toBe("not_an_etf"); // domain's class survives
    expect(rows[0].transientAttempts).toBe(0); // the transport write was a no-op
  });

  it("...and the SAME domain backoff wins regardless of write order — transport landing FIRST still loses to domain landing SECOND", async () => {
    await repo.upsertEtfProfiles([
      { ticker: "REFRESHRACE2", payload: SAMPLE_PROFILE, refusalReason: null },
    ]);
    const staleFetchedAt = (await repo.getEtfProfiles(["REFRESHRACE2"]))[0]!.fetchedAt;

    // Instance B (transport) lands FIRST this time.
    await repo.upsertEtfProfiles([
      {
        ticker: "REFRESHRACE2",
        payload: SAMPLE_PROFILE,
        refusalReason: "transient",
        refusalDetail: "network error",
        retryAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
        transientAttempts: 1,
        fetchedAt: staleFetchedAt,
      },
    ]);
    // Instance A (domain) lands SECOND — this direction is a genuine
    // re-judgment, not a downgrade, so it must be admitted (the
    // domain-replacing-domain / domain-replacing-transport precedent).
    await repo.upsertEtfProfiles([
      {
        ticker: "REFRESHRACE2",
        payload: SAMPLE_PROFILE,
        refusalReason: "not_an_etf",
        refusalDetail: "no profile on refresh",
        retryAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
        transientAttempts: 0,
        fetchedAt: staleFetchedAt,
      },
    ]);

    const rows = await repo.getEtfProfiles(["REFRESHRACE2"]);
    expect(rows[0].refusalReason).toBe("not_an_etf");
    expect(rows[0].transientAttempts).toBe(0);
  });

  it("a fresh DOMAIN-class refusal DOES overwrite an existing DOMAIN-class refusal — a genuine re-judgment on a real fetch, not a transport failure", async () => {
    await repo.upsertEtfProfiles([
      {
        ticker: "RECLASS",
        payload: null,
        refusalReason: "malformed",
        refusalDetail: "weights over 100%",
        retryAt: new Date().toISOString(),
        transientAttempts: 0,
      },
    ]);
    await repo.upsertEtfProfiles([
      {
        ticker: "RECLASS",
        payload: null,
        refusalReason: "not_an_etf",
        refusalDetail: "no profile on retry",
        retryAt: new Date().toISOString(),
        transientAttempts: 0,
      },
    ]);
    const rows = await repo.getEtfProfiles(["RECLASS"]);
    expect(rows[0].refusalReason).toBe("not_an_etf");
  });

  it("a TRANSPORT-class refusal DOES overwrite an existing TRANSPORT-class refusal — an ordinary continued failure, unaffected by the precedence guard", async () => {
    await repo.upsertEtfProfiles([
      {
        ticker: "FLAKY",
        payload: null,
        refusalReason: "transient",
        refusalDetail: "network error 1",
        retryAt: new Date().toISOString(),
        transientAttempts: 1,
      },
    ]);
    await repo.upsertEtfProfiles([
      {
        ticker: "FLAKY",
        payload: null,
        refusalReason: "quota",
        refusalDetail: "budget exhausted",
        retryAt: new Date().toISOString(),
        transientAttempts: 0,
      },
    ]);
    const rows = await repo.getEtfProfiles(["FLAKY"]);
    expect(rows[0].refusalReason).toBe("quota");
  });

  it("dedupes a same-ticker batch (last write wins) without an intra-statement conflict", async () => {
    await repo.upsertEtfProfiles([
      { ticker: "QQQ", payload: SAMPLE_PROFILE, refusalReason: null },
      {
        ticker: "QQQ",
        payload: null,
        refusalReason: "not_an_etf",
        refusalDetail: "no profile",
        retryAt: new Date().toISOString(),
        transientAttempts: 0,
      },
    ]);
    const rows = await repo.getEtfProfiles(["QQQ"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].refusalReason).toBe("not_an_etf");
  });

  it("returns [] for an empty ticker list without a query", async () => {
    expect(await repo.getEtfProfiles([])).toEqual([]);
  });

  it("is a no-op on an empty upsert batch", async () => {
    await expect(repo.upsertEtfProfiles([])).resolves.toBeUndefined();
  });
});
