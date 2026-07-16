/**
 * Tests for the per-ticker sector classification store (FIX-762).
 *
 * Intent encoded — these pin the cache contract the Health view + analysis seed
 * read against:
 *   1. Round-trip: an upserted classification reads back, upper-cased and
 *      timestamped; an unknown ticker is simply omitted (never a full-table scan).
 *   2. Upsert-on-conflict overwrites the sector in place (a re-classification).
 *   3. The read is global reference data — no `userId` guard (a ticker's sector is
 *      a public fact), unlike every portfolio method.
 *
 * Runs on embedded PGlite — the `portfolio-repository.spec.ts` precedent.
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createMigratedPgliteDb } from "@/db/client";
import { createPortfolioRepository, type PortfolioRepository } from "@/db/repository";

const MIGRATIONS_DIR = fileURLToPath(new URL("../db/migrations", import.meta.url));

async function freshRepo(): Promise<PortfolioRepository> {
  const pglite = new PGlite();
  const db = await createMigratedPgliteDb(pglite, MIGRATIONS_DIR);
  return createPortfolioRepository(db);
}

let repo: PortfolioRepository;
beforeEach(async () => {
  repo = await freshRepo();
});

describe("instrument classifications repository (FIX-762)", () => {
  it("round-trips an upserted classification and omits unknown tickers", async () => {
    await repo.upsertInstrumentClassifications([
      { ticker: "AAPL", sector: "Technology", source: "yahoo" },
      { ticker: "JPM", sector: "Financial Services", source: "yahoo" },
    ]);
    const rows = await repo.getInstrumentClassifications(["AAPL", "JPM", "NOPE"]);
    const byTicker = new Map(rows.map((r) => [r.ticker, r]));
    expect(byTicker.get("AAPL")?.sector).toBe("Technology");
    expect(byTicker.get("JPM")?.sector).toBe("Financial Services");
    // Unknown ticker returns no row (not a null-sector row).
    expect(byTicker.has("NOPE")).toBe(false);
    expect(byTicker.get("AAPL")?.source).toBe("yahoo");
    expect(typeof byTicker.get("AAPL")?.fetchedAt).toBe("string");
  });

  it("upper-cases the ticker on read and write", async () => {
    await repo.upsertInstrumentClassifications([{ ticker: "aapl", sector: "Technology", source: "yahoo" }]);
    const rows = await repo.getInstrumentClassifications(["aApL"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].ticker).toBe("AAPL");
  });

  it("overwrites the sector in place on a conflicting upsert (re-classification)", async () => {
    await repo.upsertInstrumentClassifications([{ ticker: "META", sector: "Technology", source: "yahoo" }]);
    await repo.upsertInstrumentClassifications([
      { ticker: "META", sector: "Communication Services", source: "yahoo" },
    ]);
    const rows = await repo.getInstrumentClassifications(["META"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sector).toBe("Communication Services");
  });

  it("dedupes a same-ticker batch (last write wins) without an intra-statement conflict", async () => {
    await repo.upsertInstrumentClassifications([
      { ticker: "NVDA", sector: "Technology", source: "yahoo" },
      { ticker: "NVDA", sector: "Semiconductors", source: "yahoo" },
    ]);
    const rows = await repo.getInstrumentClassifications(["NVDA"]);
    expect(rows).toHaveLength(1);
    expect(rows[0].sector).toBe("Semiconductors");
  });

  it("returns [] for an empty ticker list without a query", async () => {
    expect(await repo.getInstrumentClassifications([])).toEqual([]);
  });

  it("is a no-op on an empty upsert batch", async () => {
    await expect(repo.upsertInstrumentClassifications([])).resolves.toBeUndefined();
  });
});
