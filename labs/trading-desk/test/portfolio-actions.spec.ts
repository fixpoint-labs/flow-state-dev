/**
 * Integration tests for the portfolio write actions + getQuotes, driven through
 * the real `runAction` engine via `testFlow`.
 *
 * These lock the load-bearing data-model properties of the single-collection
 * model: holdings live inline in each `accounts/{accountId}` record; upsert is
 * non-destructive and replaces only the named ticker; replace-account sets the
 * account's holdings to exactly the parsed rows; saveAccount preserves an
 * account's holdings across a metadata edit; the SAME ticker in two accounts is
 * two independent entries (one per account's array); deleteHolding removes a
 * single entry; deleteAccount drops the account; the import report counts are
 * honest; and getQuotes degrades a missing fixture to a null price (never a
 * fabricated number).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";
import { makeTestRepository } from "./_helpers/portfolio-repo";
import {
  toAccountStates,
  type AccountRow,
  type PortfolioRepository,
} from "@/src/db/repository";

// The portfolio actions moved to the `portfolio` flow (FIX-736) and now read/
// write accounts + holdings through the app-owned repository (FIX-772) rather
// than an FSD resource. Mock the repo to a fresh in-memory PGlite instance per
// test; the dispatched actions and the assertion reads below share it, so the
// reads observe exactly what the actions wrote.
const repoState = vi.hoisted(() => ({ repo: null as PortfolioRepository | null }));
vi.mock("@/lib/portfolio-db", () => ({
  getRepository: async () => {
    if (!repoState.repo) throw new Error("test repository not initialized");
    return repoState.repo;
  },
}));

import portfolioFlow from "../src/flows/portfolio/flow";

const USER_ID = "devuser";
// portfolioQuotes is still user-scoped (flowIsolation: false), keyed at bare
// {userId}; the getQuotes test reads it there.
const USER_KEY = USER_ID;

type StoredHolding = {
  ticker: string;
  quantity: number;
  costBasis: number | null;
};

/** Read all of a user's accounts (account-level fields) from the repository. */
async function userAccounts(): Promise<AccountRow[]> {
  return repoState.repo!.getAccountsForUser(USER_ID);
}

/** Read one account record's holdings (or undefined if the account is absent),
 *  via the repository's inline-holdings projection. */
async function holdingsOf(accountId: string): Promise<StoredHolding[] | undefined> {
  const portfolio = await repoState.repo!.getPortfolio(USER_ID);
  const account = toAccountStates(portfolio).find((a) => a.accountId === accountId);
  return account?.holdings;
}

/** Create an account so imports (which require an existing account) can run. */
async function createAccount(
  stores: ReturnType<typeof createInMemoryStores>,
  accountId: string,
  name = "Test Account",
): Promise<void> {
  await testFlow({
    flow: portfolioFlow,
    action: "saveAccount",
    userId: USER_ID,
    stores,
    input: { accountId, name, type: "taxable" },
  });
}

beforeEach(async () => {
  repoState.repo = await makeTestRepository();
});

const A1 = "acct-roth";
const A2 = "acct-taxable";

describe("importHoldings action", () => {
  it("upsert imports new holdings into the account record", async () => {
    const stores = createInMemoryStores();
    await createAccount(stores, A1);
    const result = await testFlow({
      flow: portfolioFlow,
      action: "importHoldings",
      userId: USER_ID,
      stores,
      input: {
        accountId: A1,
        mode: "upsert",
        csvText: "ticker,quantity,costBasis\nNVDA,10,100\nAAPL,5,150",
      },
    });
    expect(result.status).toBe("completed");

    const holdings = await holdingsOf(A1);
    expect(holdings).toContainEqual(
      expect.objectContaining({ ticker: "NVDA", quantity: 10, costBasis: 100 }),
    );
    expect(holdings).toContainEqual(
      expect.objectContaining({ ticker: "AAPL", quantity: 5 }),
    );
  });

  it("reports an error and imports nothing when the account does not exist", async () => {
    const stores = createInMemoryStores();
    const result = await testFlow({
      flow: portfolioFlow,
      action: "importHoldings",
      userId: USER_ID,
      stores,
      input: {
        accountId: "no-such-account",
        mode: "upsert",
        csvText: "ticker,quantity\nNVDA,10",
      },
    });
    expect(result.status).toBe("completed");
    // The edge guard: zero counts + an explanatory warning, and no record
    // materializes for the missing account.
    const report = result.output as {
      imported: number;
      updated: number;
      deleted: number;
      warnings: string[];
    };
    expect(report.imported).toBe(0);
    expect(report.updated).toBe(0);
    expect(report.deleted).toBe(0);
    expect(report.warnings.join(" ")).toMatch(/not found/i);
    const accounts = await userAccounts();
    expect(accounts.find((a) => a.accountId === "no-such-account")).toBeUndefined();
  });

  it("upsert replaces the named ticker but leaves other holdings untouched", async () => {
    const stores = createInMemoryStores();
    await createAccount(stores, A1);
    // First import: NVDA + AAPL.
    await testFlow({
      flow: portfolioFlow,
      action: "importHoldings",
      userId: USER_ID,
      stores,
      input: {
        accountId: A1,
        mode: "upsert",
        csvText: "ticker,quantity,costBasis\nNVDA,10,100\nAAPL,5,150",
      },
    });
    // Second import: only NVDA, new quantity. AAPL must survive.
    const second = await testFlow({
      flow: portfolioFlow,
      action: "importHoldings",
      userId: USER_ID,
      stores,
      input: {
        accountId: A1,
        mode: "upsert",
        csvText: "ticker,quantity,costBasis\nNVDA,99,120",
      },
    });
    expect(second.status).toBe("completed");

    const holdings = await holdingsOf(A1);
    expect(holdings).toContainEqual(
      expect.objectContaining({ ticker: "NVDA", quantity: 99, costBasis: 120 }),
    );
    // AAPL untouched.
    expect(holdings).toContainEqual(
      expect.objectContaining({ ticker: "AAPL", quantity: 5 }),
    );
  });

  it("replace-account sets holdings to exactly the parsed rows", async () => {
    const stores = createInMemoryStores();
    await createAccount(stores, A1);
    await testFlow({
      flow: portfolioFlow,
      action: "importHoldings",
      userId: USER_ID,
      stores,
      input: {
        accountId: A1,
        mode: "upsert",
        csvText: "ticker,quantity\nNVDA,10\nAAPL,5\nMSFT,3",
      },
    });
    // Replace with a snapshot that has only TSLA.
    const replace = await testFlow({
      flow: portfolioFlow,
      action: "importHoldings",
      userId: USER_ID,
      stores,
      input: {
        accountId: A1,
        mode: "replace-account",
        csvText: "ticker,quantity\nTSLA,7",
      },
    });
    expect(replace.status).toBe("completed");

    const holdings = await holdingsOf(A1);
    expect(holdings).toEqual([
      expect.objectContaining({ ticker: "TSLA", quantity: 7 }),
    ]);
    // The three prior holdings are gone (the array is exactly the parsed rows).
    expect(holdings?.map((h) => h.ticker)).not.toContain("NVDA");
    expect(holdings?.map((h) => h.ticker)).not.toContain("AAPL");
    expect(holdings?.map((h) => h.ticker)).not.toContain("MSFT");
  });

  it("tracks the SAME ticker in two accounts as independent entries", async () => {
    const stores = createInMemoryStores();
    await createAccount(stores, A1);
    await createAccount(stores, A2);
    await testFlow({
      flow: portfolioFlow,
      action: "importHoldings",
      userId: USER_ID,
      stores,
      input: {
        accountId: A1,
        mode: "upsert",
        csvText: "ticker,quantity,costBasis\nNVDA,10,100",
      },
    });
    await testFlow({
      flow: portfolioFlow,
      action: "importHoldings",
      userId: USER_ID,
      stores,
      input: {
        accountId: A2,
        mode: "upsert",
        csvText: "ticker,quantity,costBasis\nNVDA,4,80",
      },
    });

    const a1 = await holdingsOf(A1);
    const a2 = await holdingsOf(A2);
    expect(a1).toContainEqual(
      expect.objectContaining({ ticker: "NVDA", quantity: 10, costBasis: 100 }),
    );
    expect(a2).toContainEqual(
      expect.objectContaining({ ticker: "NVDA", quantity: 4, costBasis: 80 }),
    );
    // One entry per account's array — importing into A2 did not clobber A1's NVDA.
    expect(a1?.find((h) => h.ticker === "NVDA")).not.toEqual(
      a2?.find((h) => h.ticker === "NVDA"),
    );
  });
});

describe("saveAccount", () => {
  it("preserves an account's holdings across a metadata edit", async () => {
    const stores = createInMemoryStores();
    await createAccount(stores, A1, "Original Name");
    await testFlow({
      flow: portfolioFlow,
      action: "importHoldings",
      userId: USER_ID,
      stores,
      input: {
        accountId: A1,
        mode: "upsert",
        csvText: "ticker,quantity,costBasis\nNVDA,10,100",
      },
    });
    // Edit metadata only (rename). The holdings array must survive.
    const edit = await testFlow({
      flow: portfolioFlow,
      action: "saveAccount",
      userId: USER_ID,
      stores,
      input: { accountId: A1, name: "Renamed", type: "Roth", cashBalance: 500 },
    });
    expect(edit.status).toBe("completed");

    const accounts = await userAccounts();
    const account = accounts.find((a) => a.accountId === A1);
    expect(account?.name).toBe("Renamed");
    expect(account?.cashBalance).toBe(500);
    // The holding was NOT wiped by the metadata edit (holdings are a separate
    // table, so an account upsert never touches positions).
    const holdings = await holdingsOf(A1);
    expect(holdings).toContainEqual(
      expect.objectContaining({ ticker: "NVDA", quantity: 10 }),
    );
  });
});

describe("deleteHolding", () => {
  it("removes one ticker from the account's holdings, leaving the rest", async () => {
    const stores = createInMemoryStores();
    await createAccount(stores, A1);
    await testFlow({
      flow: portfolioFlow,
      action: "importHoldings",
      userId: USER_ID,
      stores,
      input: {
        accountId: A1,
        mode: "upsert",
        csvText: "ticker,quantity\nNVDA,10\nAAPL,5",
      },
    });
    const del = await testFlow({
      flow: portfolioFlow,
      action: "deleteHolding",
      userId: USER_ID,
      stores,
      input: { accountId: A1, ticker: "NVDA" },
    });
    expect(del.status).toBe("completed");

    const holdings = await holdingsOf(A1);
    expect(holdings?.map((h) => h.ticker)).toEqual(["AAPL"]);
  });
});

describe("deleteAccount", () => {
  it("removes the account (and its inline holdings) entirely", async () => {
    const stores = createInMemoryStores();
    await createAccount(stores, A1, "My Roth IRA");
    await testFlow({
      flow: portfolioFlow,
      action: "importHoldings",
      userId: USER_ID,
      stores,
      input: {
        accountId: A1,
        mode: "upsert",
        csvText: "ticker,quantity\nNVDA,10",
      },
    });

    const accountsBefore = await userAccounts();
    expect(accountsBefore.find((a) => a.accountId === A1)).toMatchObject({
      accountId: A1,
      name: "My Roth IRA",
    });
    expect(await holdingsOf(A1)).toHaveLength(1);

    await testFlow({
      flow: portfolioFlow,
      action: "deleteAccount",
      userId: USER_ID,
      stores,
      input: { accountId: A1 },
    });
    const accountsAfter = await userAccounts();
    expect(accountsAfter.find((a) => a.accountId === A1)).toBeUndefined();
    // The FK cascade dropped the account's holdings too: getPortfolio returns
    // no holding rows for the deleted account.
    const { holdings } = await repoState.repo!.getPortfolio(USER_ID);
    expect(holdings.some((h) => h.accountId === A1)).toBe(false);
  });
});

describe("recordLedgerEvent action", () => {
  it("records a manual event, attributes it to the manual source, and recomputes basis", async () => {
    const stores = createInMemoryStores();
    await createAccount(stores, A1);
    await testFlow({
      flow: portfolioFlow,
      action: "importHoldings",
      userId: USER_ID,
      stores,
      input: { accountId: A1, mode: "upsert", csvText: "ticker,quantity\nAAPL,10" },
    });

    const result = await testFlow({
      flow: portfolioFlow,
      action: "recordLedgerEvent",
      userId: USER_ID,
      stores,
      input: {
        accountId: A1,
        type: "buy",
        tradeDate: "2026-01-10",
        ticker: "AAPL",
        quantity: 10,
        unitPrice: 150,
        amount: -1500,
      },
    });
    expect(result.status).toBe("completed");
    expect(result.output).toMatchObject({ inserted: 1, deduplicated: 0 });

    const ledger = await repoState.repo!.getLedger(USER_ID);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ ticker: "AAPL", source: "manual", externalId: null });

    // Basis was derived onto the existing holding from the recorded buy.
    const { holdings } = await repoState.repo!.getPortfolio(USER_ID);
    expect(holdings.find((h) => h.ticker === "AAPL")?.costBasis).toBe(150);
  });

  it("records a basis-unknown transfer-in without zero-filling the basis", async () => {
    const stores = createInMemoryStores();
    await createAccount(stores, A1);
    await testFlow({
      flow: portfolioFlow,
      action: "importHoldings",
      userId: USER_ID,
      stores,
      input: { accountId: A1, mode: "upsert", csvText: "ticker,quantity\nTSLA,5" },
    });

    await testFlow({
      flow: portfolioFlow,
      action: "recordLedgerEvent",
      userId: USER_ID,
      stores,
      input: {
        accountId: A1,
        type: "transfer",
        tradeDate: "2026-01-10",
        ticker: "TSLA",
        quantity: 5,
        amount: 0,
        basisUnknown: "transferred in; no acquisition record",
      },
    });

    const { holdings } = await repoState.repo!.getPortfolio(USER_ID);
    expect(holdings.find((h) => h.ticker === "TSLA")?.costBasis).toBeNull(); // not 0
  });

  it("rejects a manual event targeting an account the caller does not own", async () => {
    const stores = createInMemoryStores();
    // Account belongs to "other"; devuser must not be able to write to it.
    await repoState.repo!.upsertAccount({
      id: "foreign",
      userId: "other",
      name: "Theirs",
      type: "taxable",
    });
    const result = await testFlow({
      flow: portfolioFlow,
      action: "recordLedgerEvent",
      userId: USER_ID,
      stores,
      input: { accountId: "foreign", type: "deposit", tradeDate: "2026-01-10", amount: 100 },
    });
    expect(result.status).not.toBe("completed");
    expect(await repoState.repo!.getLedger(USER_ID)).toHaveLength(0);
  });
});

describe("getQuotes action", () => {
  it("resolves a fixture-backed ticker's last close", async () => {
    const stores = createInMemoryStores();
    const result = await testFlow({
      flow: portfolioFlow,
      action: "getQuotes",
      userId: USER_ID,
      sessionId: "quotes-session",
      stores,
      input: { tickers: ["NVDA"], dataSource: "fixture" },
    });
    expect(result.status).toBe("completed");

    // portfolioQuotes is now user-scoped (flowIsolation: false), keyed at bare
    // {userId} — readable cross-flow so the report flow can seed from it.
    const userResources = (await stores.resourceState.getAll(
      "user",
      USER_KEY,
    )) as Record<string, { quotes?: Array<{ ticker: string; price: number | null }> }>;
    const quotes = userResources.portfolioQuotes?.quotes ?? [];
    const nvda = quotes.find((q) => q.ticker === "NVDA");
    expect(nvda).toBeDefined();
    // Fixture NVDA last bar close is 131.4 (pinned snapshot).
    expect(nvda?.price).toBe(131.4);
  });

  it("degrades a missing fixture to a null price, never a fabricated number", async () => {
    const stores = createInMemoryStores();
    await testFlow({
      flow: portfolioFlow,
      action: "getQuotes",
      userId: USER_ID,
      sessionId: "quotes-missing",
      stores,
      input: { tickers: ["ZZZZ"], dataSource: "fixture" },
    });
    const userResources = (await stores.resourceState.getAll(
      "user",
      USER_KEY,
    )) as Record<string, { quotes?: Array<{ ticker: string; price: number | null }> }>;
    const quotes = userResources.portfolioQuotes?.quotes ?? [];
    const missing = quotes.find((q) => q.ticker === "ZZZZ");
    expect(missing).toBeDefined();
    expect(missing?.price).toBeNull();
  });
});
