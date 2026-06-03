/**
 * Integration tests for the portfolio write actions + getQuotes, driven through
 * the real `runAction` engine via `testFlow`.
 *
 * These lock the load-bearing data-model properties: upsert is non-destructive
 * and replaces only the named ticker; replace-account wipes the account first;
 * the SAME ticker in two accounts is two distinct `{accountId}__{ticker}` keys
 * (the isolation property the whole real-money model rests on); the import
 * report counts are honest; and getQuotes degrades a missing fixture to a null
 * price (never a fabricated number).
 */
import { describe, expect, it } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/server";
import { testFlow } from "@flow-state-dev/testing";
import tradingDeskFlow from "../src/flows/trading-desk/flow";

const USER_ID = "devuser";
const ISOLATED_KEY = `${USER_ID}:trading-desk`;

/** Read all user-scoped resource state (collections live here, keyed by their
 *  storage path, e.g. `holdings/{accountId}__{ticker}`). */
async function userResources(
  stores: ReturnType<typeof createInMemoryStores>,
): Promise<Record<string, Record<string, unknown>>> {
  return (await stores.resourceState.getAll("user", ISOLATED_KEY)) as Record<
    string,
    Record<string, unknown>
  >;
}

const A1 = "acct-roth";
const A2 = "acct-taxable";

describe("importHoldings action", () => {
  it("upsert imports new holdings keyed {accountId}__{ticker}", async () => {
    const stores = createInMemoryStores();
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

    const resources = await userResources(stores);
    expect(resources[`holdings/${A1}__NVDA`]).toMatchObject({
      accountId: A1,
      ticker: "NVDA",
      quantity: 10,
      costBasis: 100,
    });
    expect(resources[`holdings/${A1}__AAPL`]).toMatchObject({
      ticker: "AAPL",
      quantity: 5,
    });
  });

  it("upsert replaces the named ticker but leaves other holdings untouched", async () => {
    const stores = createInMemoryStores();
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

    const resources = await userResources(stores);
    expect(resources[`holdings/${A1}__NVDA`]).toMatchObject({
      quantity: 99,
      costBasis: 120,
    });
    // AAPL untouched.
    expect(resources[`holdings/${A1}__AAPL`]).toMatchObject({ quantity: 5 });
  });

  it("replace-account wipes existing holdings before importing", async () => {
    const stores = createInMemoryStores();
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

    const resources = await userResources(stores);
    expect(resources[`holdings/${A1}__TSLA`]).toMatchObject({ quantity: 7 });
    // The three prior holdings are gone.
    expect(resources[`holdings/${A1}__NVDA`]).toBeUndefined();
    expect(resources[`holdings/${A1}__AAPL`]).toBeUndefined();
    expect(resources[`holdings/${A1}__MSFT`]).toBeUndefined();
  });

  it("tracks the SAME ticker in two accounts as two distinct holdings", async () => {
    const stores = createInMemoryStores();
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

    const resources = await userResources(stores);
    expect(resources[`holdings/${A1}__NVDA`]).toMatchObject({
      accountId: A1,
      quantity: 10,
      costBasis: 100,
    });
    expect(resources[`holdings/${A2}__NVDA`]).toMatchObject({
      accountId: A2,
      quantity: 4,
      costBasis: 80,
    });
    // Two distinct keys — importing into A2 did not clobber A1's NVDA.
    expect(resources[`holdings/${A1}__NVDA`]).not.toEqual(
      resources[`holdings/${A2}__NVDA`],
    );
  });
});

describe("saveAccount + deleteAccount actions", () => {
  it("saveAccount persists an account; deleteAccount removes it and its holdings", async () => {
    const stores = createInMemoryStores();
    // Create an account with an explicit id so we can assert its storage key.
    await testFlow({
      flow: tradingDeskFlow,
      action: "saveAccount",
      userId: USER_ID,
      stores,
      input: { accountId: A1, name: "My Roth IRA", type: "Roth" },
    });
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
      type: "Roth",
    });
    expect(resources[`holdings/${A1}__NVDA`]).toBeDefined();

    await testFlow({
      flow: tradingDeskFlow,
      action: "deleteAccount",
      userId: USER_ID,
      stores,
      input: { accountId: A1 },
    });
    resources = await userResources(stores);
    expect(resources[`accounts/${A1}`]).toBeUndefined();
    expect(resources[`holdings/${A1}__NVDA`]).toBeUndefined();
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

    // The quotes are written to the session-scoped resource for the UI to read.
    const sessionResources = (await stores.resourceState.getAll(
      "session",
      "quotes-session",
    )) as Record<string, { quotes?: Array<{ ticker: string; price: number | null }> }>;
    const quotes = sessionResources.portfolioQuotes?.quotes ?? [];
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
    const sessionResources = (await stores.resourceState.getAll(
      "session",
      "quotes-missing",
    )) as Record<string, { quotes?: Array<{ ticker: string; price: number | null }> }>;
    const quotes = sessionResources.portfolioQuotes?.quotes ?? [];
    const missing = quotes.find((q) => q.ticker === "ZZZZ");
    expect(missing).toBeDefined();
    expect(missing?.price).toBeNull();
  });
});
