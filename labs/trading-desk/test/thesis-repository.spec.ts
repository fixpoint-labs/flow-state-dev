/**
 * Tests for the per-position thesis repository methods (FIX-760).
 *
 * Intent encoded — these pin the contract the analysis-side injection and the
 * blocked review loop (FIX-763) depend on:
 *   1. `upsertThesis` creates then overwrites in place on `(user_id, ticker)`,
 *      preserving `createdAt` and bumping `updatedAt` (overwrite, no history).
 *   2. A thesis is keyed at the HOUSEHOLD level — one record per name regardless
 *      of which account holds it; two households' theses for the same ticker are
 *      independent.
 *   3. `getThesis` returns null when absent; `listTheses` returns the household's
 *      theses ticker-ascending; numerics come back as JS numbers and tripwires as
 *      a parsed array.
 *   4. `deleteThesis` is household-scoped — another household cannot delete it.
 *
 * Runs on embedded PGlite (the dev backing engine), no Docker — the
 * `portfolio-repository.spec.ts` precedent.
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createMigratedPgliteDb } from "@/src/db/client";
import {
  createPortfolioRepository,
  type PortfolioRepository,
} from "@/src/db/repository";
import type { ThesisInput } from "@/src/flows/portfolio/thesis-schema";

const MIGRATIONS_DIR = fileURLToPath(new URL("../src/db/migrations", import.meta.url));

async function freshRepo(): Promise<PortfolioRepository> {
  const pglite = new PGlite();
  const db = await createMigratedPgliteDb(pglite, MIGRATIONS_DIR);
  return createPortfolioRepository(db);
}

function thesis(overrides: Partial<ThesisInput> = {}): ThesisInput {
  return {
    userId: "devuser",
    ticker: "NVDA",
    entryRationale: "Data-center compute demand outruns supply through 2027.",
    invalidationConditions: null,
    tripwires: [],
    timeHorizon: null,
    targetPrice: null,
    stopPrice: null,
    sourceSessionId: null,
    ...overrides,
  };
}

let repo: PortfolioRepository;
beforeEach(async () => {
  repo = await freshRepo();
});

describe("upsertThesis", () => {
  it("creates a thesis and reads it back with numerics + tripwires mapped", async () => {
    const created = await repo.upsertThesis(
      thesis({
        targetPrice: 200,
        stopPrice: 95.5,
        timeHorizon: "quarters",
        invalidationConditions: "Gross margin compresses below 60%.",
        tripwires: [
          { kind: "price", note: "stop", level: 95.5, byDate: null },
          { kind: "event", note: "Q3 datacenter revenue misses guide", level: null, byDate: "2026-08-01" },
        ],
        sourceSessionId: "sess-1",
      }),
    );
    expect(created.ticker).toBe("NVDA");
    expect(created.targetPrice).toBe(200);
    expect(typeof created.targetPrice).toBe("number");
    expect(created.stopPrice).toBe(95.5);
    expect(created.timeHorizon).toBe("quarters");
    expect(created.tripwires).toHaveLength(2);
    expect(created.tripwires[0]).toEqual({ kind: "price", note: "stop", level: 95.5, byDate: null });
    expect(created.sourceSessionId).toBe("sess-1");

    const fetched = await repo.getThesis("devuser", "NVDA");
    expect(fetched).not.toBeNull();
    expect(fetched?.entryRationale).toBe(created.entryRationale);
  });

  it("overwrites in place on (user_id, ticker), preserving createdAt and bumping updatedAt", async () => {
    const created = await repo.upsertThesis(thesis({ entryRationale: "First take." }));
    const updated = await repo.upsertThesis(
      thesis({ entryRationale: "Revised conviction.", targetPrice: 250 }),
    );

    expect(updated.entryRationale).toBe("Revised conviction.");
    expect(updated.targetPrice).toBe(250);
    expect(updated.createdAt).toBe(created.createdAt); // overwrite, not a new row
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.updatedAt).getTime(),
    );

    const all = await repo.listTheses("devuser");
    expect(all).toHaveLength(1); // upsert, not a second insert
  });
});

describe("household keying", () => {
  it("is one record per name regardless of account, independent across households", async () => {
    await repo.upsertThesis(thesis({ userId: "devuser", entryRationale: "mine" }));
    await repo.upsertThesis(thesis({ userId: "other", entryRationale: "theirs" }));

    expect((await repo.getThesis("devuser", "NVDA"))?.entryRationale).toBe("mine");
    expect((await repo.getThesis("other", "NVDA"))?.entryRationale).toBe("theirs");
    expect(await repo.listTheses("devuser")).toHaveLength(1);
  });
});

describe("getThesis / listTheses", () => {
  it("returns null for a ticker with no thesis", async () => {
    expect(await repo.getThesis("devuser", "AAPL")).toBeNull();
  });

  it("lists a household's theses ticker-ascending", async () => {
    await repo.upsertThesis(thesis({ ticker: "TSLA" }));
    await repo.upsertThesis(thesis({ ticker: "AAPL" }));
    await repo.upsertThesis(thesis({ ticker: "MSFT" }));
    const list = await repo.listTheses("devuser");
    expect(list.map((t) => t.ticker)).toEqual(["AAPL", "MSFT", "TSLA"]);
  });
});

describe("deleteThesis", () => {
  it("removes the household's thesis for one ticker", async () => {
    await repo.upsertThesis(thesis({ ticker: "AAPL" }));
    await repo.upsertThesis(thesis({ ticker: "MSFT" }));
    await repo.deleteThesis("devuser", "AAPL");
    expect((await repo.listTheses("devuser")).map((t) => t.ticker)).toEqual(["MSFT"]);
  });

  it("is household-scoped — another household cannot delete it", async () => {
    await repo.upsertThesis(thesis({ userId: "devuser", ticker: "NVDA" }));
    await repo.deleteThesis("intruder", "NVDA");
    expect(await repo.getThesis("devuser", "NVDA")).not.toBeNull();
  });
});
