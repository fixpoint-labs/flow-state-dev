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
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/server";
import { testFlow } from "@flow-state-dev/testing";
// The portfolio actions moved to the `trading-desk-portfolio` flow (FIX-736);
// build that flow to exercise them. The `accounts` collection is shared
// (flowIsolation: false → bare `{userId}`), so the state assertions below read
// the same key regardless of which flow wrote them.
import tradingDeskFlow from "../src/flows/trading-desk-portfolio/flow";

const USER_ID = "devuser";
// accounts collection is now user-scoped with flowIsolation: false, so state
// keys at bare {userId} rather than {userId}:trading-desk.
const USER_KEY = USER_ID;

type StoredHolding = {
  ticker: string;
  quantity: number;
  costBasis: number | null;
};
type StoredAccount = {
  accountId: string;
  name?: string;
  type?: string;
  holdings: StoredHolding[];
};

/** Read all user-scoped resource state (the `accounts` collection lives here,
 *  keyed by its storage path, e.g. `accounts/{accountId}`). */
async function userResources(
  stores: ReturnType<typeof createInMemoryStores>,
): Promise<Record<string, Record<string, unknown>>> {
  return (await stores.resourceState.getAll("user", USER_KEY)) as Record<
    string,
    Record<string, unknown>
  >;
}

/** Read one account record's holdings (or undefined if the account is absent). */
async function holdingsOf(
  stores: ReturnType<typeof createInMemoryStores>,
  accountId: string,
): Promise<StoredHolding[] | undefined> {
  const resources = await userResources(stores);
  const account = resources[`accounts/${accountId}`] as StoredAccount | undefined;
  return account?.holdings;
}

/** Create an account so imports (which require an existing account) can run. */
async function createAccount(
  stores: ReturnType<typeof createInMemoryStores>,
  accountId: string,
  name = "Test Account",
): Promise<void> {
  await testFlow({
    flow: tradingDeskFlow,
    action: "saveAccount",
    userId: USER_ID,
    stores,
    input: { accountId, name, type: "taxable" },
  });
}

const A1 = "acct-roth";
const A2 = "acct-taxable";

describe("importHoldings action", () => {
  it("upsert imports new holdings into the account record", async () => {
    const stores = createInMemoryStores();
    await createAccount(stores, A1);
    const result = await testFlow({
      flow: tradingDeskFlow,
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

    const holdings = await holdingsOf(stores, A1);
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
      flow: tradingDeskFlow,
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
    const resources = await userResources(stores);
    expect(resources[`accounts/no-such-account`]).toBeUndefined();
  });

  it("upsert replaces the named ticker but leaves other holdings untouched", async () => {
    const stores = createInMemoryStores();
    await createAccount(stores, A1);
    // First import: NVDA + AAPL.
    await testFlow({
      flow: tradingDeskFlow,
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
      flow: tradingDeskFlow,
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

    const holdings = await holdingsOf(stores, A1);
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
      flow: tradingDeskFlow,
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
      flow: tradingDeskFlow,
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

    const holdings = await holdingsOf(stores, A1);
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
      flow: tradingDeskFlow,
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
      flow: tradingDeskFlow,
      action: "importHoldings",
      userId: USER_ID,
      stores,
      input: {
        accountId: A2,
        mode: "upsert",
        csvText: "ticker,quantity,costBasis\nNVDA,4,80",
      },
    });

    const a1 = await holdingsOf(stores, A1);
    const a2 = await holdingsOf(stores, A2);
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
      flow: tradingDeskFlow,
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
      flow: tradingDeskFlow,
      action: "saveAccount",
      userId: USER_ID,
      stores,
      input: { accountId: A1, name: "Renamed", type: "Roth", cashBalance: 500 },
    });
    expect(edit.status).toBe("completed");

    const resources = await userResources(stores);
    const account = resources[`accounts/${A1}`] as StoredAccount & {
      name: string;
      cashBalance: number;
    };
    expect(account.name).toBe("Renamed");
    expect(account.cashBalance).toBe(500);
    // The holding was NOT wiped by the metadata edit.
    expect(account.holdings).toContainEqual(
      expect.objectContaining({ ticker: "NVDA", quantity: 10 }),
    );
  });
});

describe("deleteHolding", () => {
  it("removes one ticker from the account's holdings, leaving the rest", async () => {
    const stores = createInMemoryStores();
    await createAccount(stores, A1);
    await testFlow({
      flow: tradingDeskFlow,
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
      flow: tradingDeskFlow,
      action: "deleteHolding",
      userId: USER_ID,
      stores,
      input: { accountId: A1, ticker: "NVDA" },
    });
    expect(del.status).toBe("completed");

    const holdings = await holdingsOf(stores, A1);
    expect(holdings?.map((h) => h.ticker)).toEqual(["AAPL"]);
  });
});

describe("deleteAccount", () => {
  it("removes the account (and its inline holdings) entirely", async () => {
    const stores = createInMemoryStores();
    await createAccount(stores, A1, "My Roth IRA");
    await testFlow({
      flow: tradingDeskFlow,
      action: "importHoldings",
      userId: USER_ID,
      stores,
      input: {
        accountId: A1,
        mode: "upsert",
        csvText: "ticker,quantity\nNVDA,10",
      },
    });

    let resources = await userResources(stores);
    expect(resources[`accounts/${A1}`]).toMatchObject({
      accountId: A1,
      name: "My Roth IRA",
    });
    expect((resources[`accounts/${A1}`] as StoredAccount).holdings).toHaveLength(
      1,
    );

    await testFlow({
      flow: tradingDeskFlow,
      action: "deleteAccount",
      userId: USER_ID,
      stores,
      input: { accountId: A1 },
    });
    resources = await userResources(stores);
    expect(resources[`accounts/${A1}`]).toBeUndefined();
  });
});

describe("getQuotes action", () => {
  it("resolves a fixture-backed ticker's last close", async () => {
    const stores = createInMemoryStores();
    const result = await testFlow({
      flow: tradingDeskFlow,
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
      flow: tradingDeskFlow,
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
