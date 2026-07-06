/**
 * Tests for the portfolio write surface + `getQuotes`.
 *
 * The account / holdings / ledger writes are plain domain functions behind REST
 * routes (FIX-736 follow-up — `src/flows/portfolio/portfolio-writes.ts`), so
 * they're tested by calling those functions directly against a PGlite
 * repository (parsing inputs through the request schemas the routes use, so the
 * defaults are exercised too). `getQuotes` is the one portfolio FLOW action that
 * remains (it writes the cross-flow `portfolioQuotes` resource), so it's still
 * driven through `testFlow`.
 *
 * These lock the load-bearing data-model properties: holdings are keyed
 * `(account_id, ticker)`; upsert is non-destructive and replaces only the named
 * ticker; replace-account sets holdings to exactly the parsed rows; a metadata
 * edit preserves holdings (separate table); the SAME ticker in two accounts is
 * two independent rows; deleteHolding removes one; deleteAccount cascades; the
 * import report counts are honest; a manual event attributes to `manual` and
 * recomputes basis; and getQuotes degrades a missing fixture to a null price.
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
import {
  deleteAccount,
  deleteHolding,
  importHoldingsCsv,
  importHoldingsSchema,
  recordEventSchema,
  recordManualEvent,
  saveAccount,
  saveAccountSchema,
} from "@/src/flows/portfolio/portfolio-writes";

// `getQuotes` (still a flow action) doesn't touch the repository, so only the
// mock's presence matters for it; the write functions receive `repoState.repo!`
// explicitly. One fresh in-memory PGlite instance per test.
const repoState = vi.hoisted(() => ({ repo: null as PortfolioRepository | null }));
vi.mock("@/lib/portfolio-db", () => ({
  getRepository: async () => {
    if (!repoState.repo) throw new Error("test repository not initialized");
    return repoState.repo;
  },
}));

import portfolioFlow from "../src/flows/portfolio/flow";

const USER_ID = "devuser";
// portfolioQuotes is user-scoped (flowIsolation: false), keyed at bare {userId}.
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

/** Read one account record's holdings (or undefined if the account is absent). */
async function holdingsOf(accountId: string): Promise<StoredHolding[] | undefined> {
  const portfolio = await repoState.repo!.getPortfolio(USER_ID);
  const account = toAccountStates(portfolio).find((a) => a.accountId === accountId);
  return account?.holdings;
}

// Thin wrappers: parse the input through the route's request schema (applying
// defaults) then call the domain function against the test repository — exactly
// what the REST routes do, minus the HTTP layer.
const importHoldings = (input: unknown) =>
  importHoldingsCsv(importHoldingsSchema.parse(input), USER_ID, repoState.repo!);
const recordEvent = (input: unknown) =>
  recordManualEvent(recordEventSchema.parse(input), USER_ID, repoState.repo!);

/** Create an account so imports (which require an existing account) can run. */
async function createAccount(accountId: string, name = "Test Account"): Promise<void> {
  await saveAccount(
    saveAccountSchema.parse({ accountId, name, type: "taxable" }),
    USER_ID,
    repoState.repo!,
  );
}

beforeEach(async () => {
  repoState.repo = await makeTestRepository();
});

const A1 = "acct-roth";
const A2 = "acct-taxable";

describe("importHoldingsCsv", () => {
  it("upsert imports new holdings into the account record", async () => {
    await createAccount(A1);
    await importHoldings({
      accountId: A1,
      mode: "upsert",
      csvText: "ticker,quantity,costBasis\nNVDA,10,100\nAAPL,5,150",
    });

    const holdings = await holdingsOf(A1);
    expect(holdings).toContainEqual(
      expect.objectContaining({ ticker: "NVDA", quantity: 10, costBasis: 100 }),
    );
    expect(holdings).toContainEqual(
      expect.objectContaining({ ticker: "AAPL", quantity: 5 }),
    );
  });

  it("reports an error and imports nothing when the account does not exist", async () => {
    const report = await importHoldings({
      accountId: "no-such-account",
      mode: "upsert",
      csvText: "ticker,quantity\nNVDA,10",
    });
    // The edge guard: zero counts + an explanatory warning, and no record
    // materializes for the missing account.
    expect(report.imported).toBe(0);
    expect(report.updated).toBe(0);
    expect(report.deleted).toBe(0);
    expect(report.warnings.join(" ")).toMatch(/not found/i);
    const accounts = await userAccounts();
    expect(accounts.find((a) => a.accountId === "no-such-account")).toBeUndefined();
  });

  it("upsert replaces the named ticker but leaves other holdings untouched", async () => {
    await createAccount(A1);
    await importHoldings({
      accountId: A1,
      mode: "upsert",
      csvText: "ticker,quantity,costBasis\nNVDA,10,100\nAAPL,5,150",
    });
    // Second import: only NVDA, new quantity. AAPL must survive.
    await importHoldings({
      accountId: A1,
      mode: "upsert",
      csvText: "ticker,quantity,costBasis\nNVDA,99,120",
    });

    const holdings = await holdingsOf(A1);
    expect(holdings).toContainEqual(
      expect.objectContaining({ ticker: "NVDA", quantity: 99, costBasis: 120 }),
    );
    expect(holdings).toContainEqual(
      expect.objectContaining({ ticker: "AAPL", quantity: 5 }),
    );
  });

  it("replace-account sets holdings to exactly the parsed rows", async () => {
    await createAccount(A1);
    await importHoldings({
      accountId: A1,
      mode: "upsert",
      csvText: "ticker,quantity\nNVDA,10\nAAPL,5\nMSFT,3",
    });
    await importHoldings({
      accountId: A1,
      mode: "replace-account",
      csvText: "ticker,quantity\nTSLA,7",
    });

    const holdings = await holdingsOf(A1);
    expect(holdings).toEqual([
      expect.objectContaining({ ticker: "TSLA", quantity: 7 }),
    ]);
    expect(holdings?.map((h) => h.ticker)).not.toContain("NVDA");
    expect(holdings?.map((h) => h.ticker)).not.toContain("AAPL");
    expect(holdings?.map((h) => h.ticker)).not.toContain("MSFT");
  });

  it("tracks the SAME ticker in two accounts as independent entries", async () => {
    await createAccount(A1);
    await createAccount(A2);
    await importHoldings({
      accountId: A1,
      mode: "upsert",
      csvText: "ticker,quantity,costBasis\nNVDA,10,100",
    });
    await importHoldings({
      accountId: A2,
      mode: "upsert",
      csvText: "ticker,quantity,costBasis\nNVDA,4,80",
    });

    const a1 = await holdingsOf(A1);
    const a2 = await holdingsOf(A2);
    expect(a1).toContainEqual(
      expect.objectContaining({ ticker: "NVDA", quantity: 10, costBasis: 100 }),
    );
    expect(a2).toContainEqual(
      expect.objectContaining({ ticker: "NVDA", quantity: 4, costBasis: 80 }),
    );
    expect(a1?.find((h) => h.ticker === "NVDA")).not.toEqual(
      a2?.find((h) => h.ticker === "NVDA"),
    );
  });
});

describe("saveAccount", () => {
  it("preserves an account's holdings across a metadata edit", async () => {
    await createAccount(A1, "Original Name");
    await importHoldings({
      accountId: A1,
      mode: "upsert",
      csvText: "ticker,quantity,costBasis\nNVDA,10,100",
    });
    // Edit metadata only (rename). The holdings must survive.
    await saveAccount(
      saveAccountSchema.parse({ accountId: A1, name: "Renamed", type: "Roth", cashBalance: 500 }),
      USER_ID,
      repoState.repo!,
    );

    const accounts = await userAccounts();
    const account = accounts.find((a) => a.accountId === A1);
    expect(account?.name).toBe("Renamed");
    expect(account?.cashBalance).toBe(500);
    const holdings = await holdingsOf(A1);
    expect(holdings).toContainEqual(
      expect.objectContaining({ ticker: "NVDA", quantity: 10 }),
    );
  });
});

describe("deleteHolding", () => {
  it("removes one ticker from the account's holdings, leaving the rest", async () => {
    await createAccount(A1);
    await importHoldings({
      accountId: A1,
      mode: "upsert",
      csvText: "ticker,quantity\nNVDA,10\nAAPL,5",
    });
    await deleteHolding(A1, "NVDA", USER_ID, repoState.repo!);

    const holdings = await holdingsOf(A1);
    expect(holdings?.map((h) => h.ticker)).toEqual(["AAPL"]);
  });
});

describe("deleteAccount", () => {
  it("removes the account (and its holdings) entirely", async () => {
    await createAccount(A1, "My Roth IRA");
    await importHoldings({
      accountId: A1,
      mode: "upsert",
      csvText: "ticker,quantity\nNVDA,10",
    });

    const accountsBefore = await userAccounts();
    expect(accountsBefore.find((a) => a.accountId === A1)).toMatchObject({
      accountId: A1,
      name: "My Roth IRA",
    });
    expect(await holdingsOf(A1)).toHaveLength(1);

    await deleteAccount(A1, USER_ID, repoState.repo!);

    const accountsAfter = await userAccounts();
    expect(accountsAfter.find((a) => a.accountId === A1)).toBeUndefined();
    // The FK cascade dropped the account's holdings too.
    const { holdings } = await repoState.repo!.getPortfolio(USER_ID);
    expect(holdings.some((h) => h.accountId === A1)).toBe(false);
  });
});

describe("recordManualEvent", () => {
  it("records a manual event, attributes it to the manual source, and recomputes basis", async () => {
    await createAccount(A1);
    await importHoldings({ accountId: A1, mode: "upsert", csvText: "ticker,quantity\nAAPL,10" });

    const report = await recordEvent({
      accountId: A1,
      type: "buy",
      tradeDate: "2026-01-10",
      ticker: "AAPL",
      quantity: 10,
      unitPrice: 150,
      amount: -1500,
    });
    expect(report).toMatchObject({ inserted: 1, deduplicated: 0 });

    const ledger = await repoState.repo!.getLedger(USER_ID);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ ticker: "AAPL", source: "manual", externalId: null });

    // Basis was derived onto the existing holding from the recorded buy.
    const { holdings } = await repoState.repo!.getPortfolio(USER_ID);
    expect(holdings.find((h) => h.ticker === "AAPL")?.costBasis).toBe(150);
  });

  it("canonicalizes a lower-case ticker so basis lands on the upper-case holding", async () => {
    await createAccount(A1);
    await importHoldings({ accountId: A1, mode: "upsert", csvText: "ticker,quantity\nAAPL,10" });
    // A direct caller passes a lower-case, padded ticker — normalized here.
    await recordEvent({
      accountId: A1,
      type: "buy",
      tradeDate: "2026-01-10",
      ticker: " aapl ",
      quantity: 10,
      unitPrice: 150,
      amount: -1500,
    });
    const ledger = await repoState.repo!.getLedger(USER_ID);
    expect(ledger[0].ticker).toBe("AAPL"); // stored upper-case
    const { holdings } = await repoState.repo!.getPortfolio(USER_ID);
    expect(holdings.find((h) => h.ticker === "AAPL")?.costBasis).toBe(150); // basis landed
  });

  it("records a basis-unknown transfer-in without zero-filling the basis", async () => {
    await createAccount(A1);
    await importHoldings({ accountId: A1, mode: "upsert", csvText: "ticker,quantity\nTSLA,5" });

    await recordEvent({
      accountId: A1,
      type: "transfer",
      tradeDate: "2026-01-10",
      ticker: "TSLA",
      quantity: 5,
      amount: 0,
      basisUnknown: "transferred in; no acquisition record",
    });

    const { holdings } = await repoState.repo!.getPortfolio(USER_ID);
    expect(holdings.find((h) => h.ticker === "TSLA")?.costBasis).toBeNull(); // not 0
  });

  it("rejects a manual event targeting an account the caller does not own", async () => {
    // Account belongs to "other"; devuser must not be able to write to it.
    await repoState.repo!.upsertAccount({
      id: "foreign",
      userId: "other",
      name: "Theirs",
      type: "taxable",
    });
    // The ownership guard throws inside the ingest transaction, rolling it back.
    await expect(
      recordEvent({ accountId: "foreign", type: "deposit", tradeDate: "2026-01-10", amount: 100 }),
    ).rejects.toThrow();
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
