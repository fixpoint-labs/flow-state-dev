/**
 * Tests for the portfolio write surface + `refreshQuotes`.
 *
 * The account / holdings / ledger writes AND the quote refresh are plain domain
 * functions behind REST routes (FIX-736/FIX-823 — `portfolio-writes.ts` and
 * `refreshQuotes` in `get-quotes.ts`), so they're tested by calling those
 * functions directly against a PGlite repository (parsing inputs through the
 * request schemas the routes use, so the defaults are exercised too). The live
 * quote source is injected so `refreshQuotes`' write path runs offline and
 * deterministically without depending on provider or analysis-fixture wiring.
 *
 * These lock the load-bearing data-model properties: holdings are keyed
 * `(account_id, ticker)`; upsert is non-destructive and replaces only the named
 * ticker; replace-account sets holdings to exactly the parsed rows; a metadata
 * edit preserves holdings (separate table); the SAME ticker in two accounts is
 * two independent rows; deleteHolding removes one; deleteAccount cascades; the
 * import report counts are honest; a manual event attributes to `manual` and
 * recomputes basis; and `refreshQuotes` preserves a good prior row on a provider miss.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
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
} from "@/src/domain/portfolio/services/portfolio-writes";

// The write functions (and `refreshQuotes`) receive `repoState.repo!` explicitly.
// One fresh in-memory PGlite instance per test.
const repoState = vi.hoisted(() => ({ repo: null as PortfolioRepository | null }));
vi.mock("@/lib/portfolio-db", () => ({
  getRepository: async () => {
    if (!repoState.repo) throw new Error("test repository not initialized");
    return repoState.repo;
  },
}));

import { refreshQuotes } from "../src/domain/portfolio/services/get-quotes";

const quoteSource = vi.fn();

const USER_ID = "devuser";

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

  it("warns when a cash/MMF row imports alongside a non-zero cash balance (double-count guard, FIX-773)", async () => {
    await createAccount(A1);
    // A money-market fund row (XX + ~$1.00 → cash-class, values at par) imported
    // WHILE the same import sets a non-zero account cash balance. The same dollars
    // could be counted twice — once as a holding, once as cash — so we warn.
    const report = await importHoldings({
      accountId: A1,
      mode: "upsert",
      cashBalance: 5000,
      csvText: "ticker,quantity,markPrice\nSPAXX,1500,1.00\nNVDA,10,",
    });
    const joined = report.warnings.join(" ");
    expect(joined).toMatch(/counted twice/i);
    expect(joined).toContain("SPAXX");
    // The equity row is NOT named in the double-count warning.
    expect(joined).not.toMatch(/NVDA[^,]*counted twice/);
  });

  it("does NOT warn about double-counting when the cash balance is zero", async () => {
    await createAccount(A1);
    const report = await importHoldings({
      accountId: A1,
      mode: "upsert",
      csvText: "ticker,quantity,markPrice\nSPAXX,1500,1.00",
    });
    expect(report.warnings.join(" ")).not.toMatch(/counted twice/i);
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

  it("records a manual split that rebases the holding's derived lots (FIX-876)", async () => {
    await createAccount(A1);
    // A pre-split buy establishes the lot; the split then rebases it 4:1.
    await recordEvent({
      accountId: A1,
      type: "buy",
      tradeDate: "2024-01-01",
      ticker: "AAPL",
      quantity: 10,
      unitPrice: 400,
      amount: -4000,
    });
    const report = await recordEvent({
      accountId: A1,
      type: "split",
      tradeDate: "2024-06-10",
      ticker: "AAPL",
      amount: 0,
      attributes: { numerator: 4, denominator: 1 },
    });
    expect(report).toMatchObject({ inserted: 1 });
    const { holdings } = await repoState.repo!.getPortfolio(USER_ID);
    const aapl = holdings.find((h) => h.ticker === "AAPL");
    expect(aapl?.quantity).toBe(40); // 10 × 4
    expect(aapl?.costBasis).toBe(100); // 400 ÷ 4
  });

  it("rejects a split with no ratio at the schema boundary (refine)", () => {
    // The `refineLedgerEvent` boundary: a split MUST carry { numerator, denominator }.
    expect(() =>
      recordEventSchema.parse({
        accountId: A1,
        type: "split",
        tradeDate: "2024-06-10",
        ticker: "AAPL",
        amount: 0,
      }),
    ).toThrow();
  });

  it("rejects attributes on a non-split event at the schema boundary (refine)", () => {
    expect(() =>
      recordEventSchema.parse({
        accountId: A1,
        type: "buy",
        tradeDate: "2024-06-10",
        ticker: "AAPL",
        quantity: 10,
        amount: -100,
        attributes: { numerator: 4, denominator: 1 },
      }),
    ).toThrow();
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

describe("refreshQuotes (FIX-823 durable persistence)", () => {
  beforeEach(() => {
    quoteSource.mockReset();
  });

  it("persists live, non-null-priced quotes to the durable app.quotes table", async () => {
    quoteSource.mockResolvedValue([
      { ticker: "AAPL", price: 210.5, asOf: "2026-07-08" },
    ]);
    const result = await refreshQuotes(
      { tickers: ["aapl", "AAPL"] },
      repoState.repo!,
      quoteSource,
    );
    expect(result.quotes[0]).toMatchObject({ ticker: "AAPL", price: 210.5 });
    expect(quoteSource).toHaveBeenCalledWith({ tickers: ["AAPL"] });

    const rows = await repoState.repo!.getQuotes(["AAPL"]);
    expect(rows).toHaveLength(1);
    // price coerced to a JS number; last bar's close is the current price; source
    // records provenance; asOf is the last bar's date normalized to ISO.
    expect(rows[0]).toMatchObject({ ticker: "AAPL", price: 210.5, source: "live" });
    expect(rows[0].asOf).toBe(new Date("2026-07-08").toISOString());
    expect(typeof rows[0].fetchedAt).toBe("string");
  });

  it("drops a null-priced live quote, keeping the prior last-known row", async () => {
    // Seed a good last-known row.
    await repoState.repo!.upsertQuotes([
      { ticker: "TSLA", price: 250, asOf: "2026-07-01T00:00:00.000Z", source: "live" },
    ]);
    // A provider miss → null price → filtered out before upsert.
    quoteSource.mockResolvedValue([
      { ticker: "TSLA", price: null, asOf: null },
    ]);
    await refreshQuotes(
      { tickers: ["TSLA"] },
      repoState.repo!,
      quoteSource,
    );
    const rows = await repoState.repo!.getQuotes(["TSLA"]);
    expect(rows).toHaveLength(1);
    // The prior row survives with its original price — a failed refresh never
    // nulls a good last-known price.
    expect(rows[0].price).toBe(250);
  });
});
