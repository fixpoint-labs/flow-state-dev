/**
 * Tests for the app-owned portfolio repository (FIX-772).
 *
 * Intent encoded — these pin the contract the cut-over (PR 2) and the blocked
 * consumers (FIX-762/771/763) depend on:
 *   1. The committed migration applies to a fresh PGlite DB and re-running it is
 *      a no-op (the journal-guarded idempotency the dev backing relies on).
 *   2. `upsertAccount` creates then updates, preserving `createdAt`; deleting an
 *      account cascades its holdings (the FK contract).
 *   3. `upsertHoldings("upsert")` replaces the matching ticker IN PLACE and
 *      leaves non-imported tickers untouched — it never averages existing vs.
 *      imported quantity (the current `importHoldings` semantics).
 *   4. `upsertHoldings("replace-account")` overwrites the whole account
 *      atomically.
 *   5. `getPortfolio` returns accounts joined to holdings, the same ticker in
 *      two accounts as two rows (the cross-account rollup input), and every
 *      numeric column coerced to a JS `number` (never a Drizzle string).
 *   6. Every mutation is household-scoped at the DB layer — another user cannot
 *      delete, overwrite, or import into an account they don't own (the IDOR
 *      boundary the old user-scoped resource enforced implicitly).
 *
 * Runs on embedded PGlite — the same engine the dev backing uses — with no
 * Docker (the `packages/store-postgres` test precedent).
 */
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { createMigratedPgliteDb } from "@/src/db/client";
import {
  createPortfolioRepository,
  type PortfolioRepository,
} from "@/src/db/repository";
import type { AccountInput } from "@/src/db/repository";
import type { CanonicalRow } from "@/src/flows/portfolio/portfolio-schema";

const MIGRATIONS_DIR = fileURLToPath(new URL("../src/db/migrations", import.meta.url));

async function freshRepo(): Promise<{ repo: PortfolioRepository; pglite: PGlite }> {
  const pglite = new PGlite();
  const db = await createMigratedPgliteDb(pglite, MIGRATIONS_DIR);
  return { repo: createPortfolioRepository(db), pglite };
}

function account(overrides: Partial<AccountInput> = {}): AccountInput {
  return {
    id: "acc-1",
    userId: "devuser",
    name: "Taxable",
    type: "taxable",
    ...overrides,
  };
}

function row(ticker: string, quantity: number, costBasis: number | null = null): CanonicalRow {
  return { ticker, quantity, costBasis, acquiredDate: null };
}

let repo: PortfolioRepository;
beforeEach(async () => {
  ({ repo } = await freshRepo());
});

describe("migration", () => {
  it("applies to a fresh DB and re-running is a no-op", async () => {
    const pglite = new PGlite();
    await createMigratedPgliteDb(pglite, MIGRATIONS_DIR);
    // Second apply on the same instance must not throw (journal-guarded).
    await expect(createMigratedPgliteDb(pglite, MIGRATIONS_DIR)).resolves.toBeDefined();
  });
});

describe("accounts", () => {
  it("inserts then updates, preserving createdAt and bumping the name", async () => {
    const created = await repo.upsertAccount(account({ name: "Brokerage", cashBalance: 1000 }));
    expect(created.cashBalance).toBe(1000);
    expect(typeof created.cashBalance).toBe("number");

    const updated = await repo.upsertAccount(account({ name: "Renamed", cashBalance: 2000 }));
    expect(updated.name).toBe("Renamed");
    expect(updated.cashBalance).toBe(2000);
    expect(updated.createdAt).toBe(created.createdAt);

    const all = await repo.getAccountsForUser("devuser");
    expect(all).toHaveLength(1); // upsert, not a second insert
  });

  it("scopes reads to the household (userId)", async () => {
    await repo.upsertAccount(account({ id: "a", userId: "devuser" }));
    await repo.upsertAccount(account({ id: "b", userId: "other" }));
    expect(await repo.getAccountsForUser("devuser")).toHaveLength(1);
  });

  it("deletes an account and cascades its holdings", async () => {
    await repo.upsertAccount(account());
    await repo.upsertHoldings("acc-1", "devuser", [row("AAPL", 10)], "upsert");
    await repo.deleteAccount("acc-1", "devuser");

    const portfolio = await repo.getPortfolio("devuser");
    expect(portfolio.accounts).toHaveLength(0);
    expect(portfolio.holdings).toHaveLength(0); // cascade removed the holding
  });

  it("scopes deletes to the household — another user cannot delete the account", async () => {
    await repo.upsertAccount(account({ userId: "devuser" }));
    await repo.upsertHoldings("acc-1", "devuser", [row("AAPL", 10)], "upsert");

    // A different caller's userId must not delete devuser's account or holding.
    await repo.deleteAccount("acc-1", "intruder");
    await repo.deleteHolding("acc-1", "AAPL", "intruder");

    const portfolio = await repo.getPortfolio("devuser");
    expect(portfolio.accounts).toHaveLength(1);
    expect(portfolio.holdings.map((h) => h.ticker)).toEqual(["AAPL"]);
  });

  it("scopes the upsert update to the owner — another user cannot overwrite the account", async () => {
    await repo.upsertAccount(account({ name: "Taxable" }));

    // A different caller supplying the same account id must not clobber it.
    await expect(
      repo.upsertAccount(account({ userId: "intruder", name: "HACKED" })),
    ).rejects.toThrow();

    const [a] = await repo.getAccountsForUser("devuser");
    expect(a.name).toBe("Taxable"); // victim's account is untouched
  });
});

describe("upsertHoldings — upsert mode", () => {
  beforeEach(async () => {
    await repo.upsertAccount(account());
    await repo.upsertHoldings(
      "acc-1",
      "devuser",
      [row("AAPL", 10, 150), row("MSFT", 5, 300)],
      "upsert",
    );
  });

  it("replaces a matching ticker in place and leaves others untouched", async () => {
    await repo.upsertHoldings("acc-1", "devuser", [row("AAPL", 25, 160)], "upsert");
    const { holdings } = await repo.getPortfolio("devuser");
    const byTicker = Object.fromEntries(holdings.map((h) => [h.ticker, h]));
    expect(byTicker.AAPL.quantity).toBe(25); // replaced in place, not 10 + 25
    expect(byTicker.AAPL.costBasis).toBe(160);
    expect(byTicker.MSFT.quantity).toBe(5); // untouched
    expect(holdings).toHaveLength(2);
  });

  it("inserts a new ticker alongside the existing ones", async () => {
    await repo.upsertHoldings("acc-1", "devuser", [row("NVDA", 3)], "upsert");
    const { holdings } = await repo.getPortfolio("devuser");
    expect(holdings.map((h) => h.ticker).sort()).toEqual(["AAPL", "MSFT", "NVDA"]);
  });
});

describe("upsertHoldings — replace-account mode", () => {
  it("overwrites the account's holdings with exactly the imported rows", async () => {
    await repo.upsertAccount(account());
    await repo.upsertHoldings("acc-1", "devuser", [row("AAPL", 10), row("MSFT", 5)], "upsert");

    await repo.upsertHoldings("acc-1", "devuser", [row("TSLA", 2)], "replace-account");
    const { holdings } = await repo.getPortfolio("devuser");
    expect(holdings.map((h) => h.ticker)).toEqual(["TSLA"]);
  });

  it("clears the account when given no rows", async () => {
    await repo.upsertAccount(account());
    await repo.upsertHoldings("acc-1", "devuser", [row("AAPL", 10)], "upsert");

    await repo.upsertHoldings("acc-1", "devuser", [], "replace-account");
    const { holdings } = await repo.getPortfolio("devuser");
    expect(holdings).toHaveLength(0);
  });
});

describe("upsertHoldings — cash balance", () => {
  beforeEach(async () => {
    await repo.upsertAccount(account({ cashBalance: 1000 }));
  });

  it("updates the account's cash in the same write as the holdings", async () => {
    await repo.upsertHoldings("acc-1", "devuser", [row("AAPL", 10, 150)], "upsert", 2500);
    const { accounts, holdings } = await repo.getPortfolio("devuser");
    expect(accounts[0].cashBalance).toBe(2500); // cash moved with the import
    expect(typeof accounts[0].cashBalance).toBe("number");
    expect(holdings.map((h) => h.ticker)).toEqual(["AAPL"]); // and the holding landed
  });

  it("leaves cash untouched when no balance is given", async () => {
    await repo.upsertHoldings("acc-1", "devuser", [row("AAPL", 10, 150)], "upsert");
    const { accounts } = await repo.getPortfolio("devuser");
    expect(accounts[0].cashBalance).toBe(1000); // unchanged — undefined means "don't touch"

    await repo.upsertHoldings("acc-1", "devuser", [row("MSFT", 5)], "upsert", null);
    const after = await repo.getPortfolio("devuser");
    expect(after.accounts[0].cashBalance).toBe(1000); // null is also "don't touch"
  });

  it("updates cash on a replace-account import too", async () => {
    await repo.upsertHoldings("acc-1", "devuser", [row("TSLA", 2)], "replace-account", 750);
    const { accounts, holdings } = await repo.getPortfolio("devuser");
    expect(accounts[0].cashBalance).toBe(750);
    expect(holdings.map((h) => h.ticker)).toEqual(["TSLA"]);
  });
});

describe("upsertHoldings — household scoping", () => {
  it("rejects an import into an account the caller does not own, writing nothing", async () => {
    await repo.upsertAccount(account({ userId: "devuser" }));
    await repo.upsertHoldings("acc-1", "devuser", [row("AAPL", 10, 150)], "upsert", 1000);

    // An intruder targeting devuser's account id is rejected at the DB guard,
    // and the transaction rolls back — no holdings, no cash change.
    await expect(
      repo.upsertHoldings("acc-1", "intruder", [row("TSLA", 99)], "upsert", 999),
    ).rejects.toThrow();

    const { accounts, holdings } = await repo.getPortfolio("devuser");
    expect(holdings.map((h) => h.ticker)).toEqual(["AAPL"]); // intruder's row never landed
    expect(accounts[0].cashBalance).toBe(1000); // cash untouched
  });

  it("rejects a replace-account import the caller does not own without clearing holdings", async () => {
    await repo.upsertAccount(account({ userId: "devuser" }));
    await repo.upsertHoldings("acc-1", "devuser", [row("AAPL", 10)], "upsert");

    // The destructive delete-all must not run for a non-owner.
    await expect(
      repo.upsertHoldings("acc-1", "intruder", [], "replace-account"),
    ).rejects.toThrow();

    const { holdings } = await repo.getPortfolio("devuser");
    expect(holdings.map((h) => h.ticker)).toEqual(["AAPL"]); // not wiped
  });
});

describe("deleteHolding", () => {
  it("removes exactly one (account, ticker) row", async () => {
    await repo.upsertAccount(account());
    await repo.upsertHoldings("acc-1", "devuser", [row("AAPL", 10), row("MSFT", 5)], "upsert");

    await repo.deleteHolding("acc-1", "AAPL", "devuser");
    const { holdings } = await repo.getPortfolio("devuser");
    expect(holdings.map((h) => h.ticker)).toEqual(["MSFT"]);
  });
});

describe("getPortfolio", () => {
  it("returns the same ticker across two accounts as two rows, numerics as numbers", async () => {
    await repo.upsertAccount(account({ id: "acc-1", name: "Taxable" }));
    await repo.upsertAccount(account({ id: "acc-2", name: "IRA", type: "IRA" }));
    await repo.upsertHoldings("acc-1", "devuser", [row("AAPL", 10, 150.25)], "upsert");
    await repo.upsertHoldings("acc-2", "devuser", [row("AAPL", 4, 148.5)], "upsert");

    const { accounts, holdings } = await repo.getPortfolio("devuser");
    expect(accounts).toHaveLength(2);
    const aapl = holdings.filter((h) => h.ticker === "AAPL");
    expect(aapl).toHaveLength(2); // cross-account rollup input
    for (const h of aapl) {
      expect(typeof h.quantity).toBe("number");
      expect(typeof h.costBasis).toBe("number");
    }
    expect(aapl.map((h) => h.accountId).sort()).toEqual(["acc-1", "acc-2"]);
  });

  it("returns an account with no holdings as an empty list", async () => {
    await repo.upsertAccount(account());
    const { accounts, holdings } = await repo.getPortfolio("devuser");
    expect(accounts).toHaveLength(1);
    expect(holdings).toHaveLength(0);
  });
});
