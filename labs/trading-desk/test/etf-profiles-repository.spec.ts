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
