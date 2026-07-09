/**
 * PortfolioPane — the Portfolio view. An account summary-card grid (value,
 * cash, uP/L $ + %, position count); clicking a card opens that account's
 * detail view (`AccountDetail`) with Holdings / Transactions / Income tabs.
 * The toolbar (add account, imports, add transaction, refresh prices) and the
 * portfolio-level totals stay above both views.
 *
 * Data path:
 *  - Accounts (with inline holdings) come from the app-owned tables via the
 *    `/api/portfolio/accounts` read route (`usePortfolioAccounts`, FIX-772) —
 *    accounts are no longer an FSD resource. `refetch` after each write action.
 *  - Prices come from the `getQuotes` action: dispatch → `session.refresh()` →
 *    read the `portfolioQuotes` resource via `useResource`. `sendAction` does
 *    not return handler output in this runtime, so the resource is the channel.
 *  - All derived money math (values, weights, P/L, rollups) is computed in
 *    `useMemo` (BP-010), never an effect.
 *
 * Real-money trust gates: money figures are display approximations labeled as
 * such; a missing price shows "—" (never fabricated); a fixture-vs-live + as-of
 * provenance line sits near the totals so a pinned snapshot is never mistaken
 * for a live quote.
 */
"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import { Plus, Upload, FileText, RefreshCw, Receipt, FileUp, Split } from "lucide-react";
import type { SessionView } from "@flow-state-dev/react";
import { useResource, useFlowContext } from "@flow-state-dev/react";
import { cn } from "@/lib/utils";
import { apiMutate } from "@/lib/use-api-query";
import type { AssetClass, Holding } from "@/src/flows/portfolio/portfolio-schema";
import type { Quote } from "@/src/flows/portfolio/get-quotes";
import { deriveLots } from "@/src/flows/portfolio/lots";
import type { TermLot } from "./holding-term";
import type { PortfolioQuotesState } from "@/src/flows/portfolio/portfolio-resources";
import type { ThesisInputFields } from "@/src/flows/portfolio/thesis-schema";
import { AccountCard } from "./account-card";
import { AccountDetail } from "./account-detail";
import { RealizedStat } from "./realized-stat";
import {
  buildRealizedGainsRowModel,
  computeRealizedGainTotals,
  realizedTotalsByAccount,
} from "./realized-gains-row-model";
import { AddAccountDialog, type NewAccountDraft } from "./add-account-dialog";
import { ImportCsvDialog, type ImportSubmit } from "./import-csv-dialog";
import { ImportPdfDialog } from "./import-pdf-dialog";
import {
  ImportTransactionsDialog,
  type TransactionImportSubmit,
} from "./import-transactions-dialog";
import {
  AddTransactionDialog,
  type NewLedgerEvent,
} from "./add-transaction-dialog";
import { ThesisDialog } from "./thesis-dialog";
import { TaxEstimateCard } from "./tax-estimate-card";
import { TaxProfileDialog } from "./tax-profile-dialog";
import { usePortfolioAccounts } from "./use-portfolio-accounts";
import { useLedger } from "./use-ledger";
import { useIncome } from "./use-income";
import { useTax } from "./use-tax";
import { useTheses } from "./use-theses";
import {
  holdingMarketValue,
  holdingUnrealizedPL,
  usesLiveQuote,
} from "@/src/flows/portfolio/value-holding";
import {
  DASH,
  allocationByClass,
  formatMoney,
  formatPercent,
  formatSignedMoney,
  formatSignedPercent,
} from "./portfolio-format";

/** Display labels for the asset-class allocation breakdown. */
const ASSET_CLASS_LABELS: Record<AssetClass, string> = {
  equity: "Equity",
  fixed_income: "Fixed income",
  cash: "Cash",
  crypto: "Crypto",
  alternative: "Alt",
};

type PortfolioPaneProps = {
  /** A bound session whose snapshot the user-scoped resource reads project
   *  from. Undefined when the user has no sessions at all. */
  session: SessionView;
  /** Whether the bound session is resolvable (a snapshot exists to read). */
  hasSession: boolean;
};

/** Per-account computed rollups, indexed by accountId. `uplPct` is the P/L as
 *  a fraction of the computable cost base (null when there is none). */
type AccountRollup = {
  value: number | null;
  upl: number | null;
  uplPct: number | null;
};

export function PortfolioPane({
  session,
  hasSession,
}: PortfolioPaneProps): ReactElement {
  const { userId } = useFlowContext();
  const uid = userId ?? "devuser";
  const { accounts, refetch: refetchAccounts } = usePortfolioAccounts();
  const { events: ledgerEvents, refetch: refetchLedger } = useLedger();
  const { income, refetch: refetchIncome } = useIncome();
  // The household tax view (profile + realized gains + current-year estimate).
  // Its refetch joins the fan-out after every ledger mutation, account save/
  // delete, and a tax-profile save — each of those changes a tax input.
  const {
    profile: taxProfile,
    realizedGains,
    estimate: taxEstimate,
    refetch: refetchTax,
  } = useTax();
  // Theses remain a user-scoped FSD resource (live client read), so this stays
  // session-based — unlike accounts/ledger/income which moved to REST routes.
  const { theses, loading: thesesLoading, refetch: refetchTheses } = useTheses(session);
  const { clientData: quotesData } = useResource(session, "portfolioQuotes");

  const [addOpen, setAddOpen] = useState(false);
  const [taxProfileOpen, setTaxProfileOpen] = useState(false);
  const [addTransactionOpen, setAddTransactionOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importPdfOpen, setImportPdfOpen] = useState(false);
  const [importTxnOpen, setImportTxnOpen] = useState(false);
  // The ticker whose thesis editor is open (null = closed). The dialog pre-fills
  // from the existing thesis for this ticker, if any.
  const [thesisTicker, setThesisTicker] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(
    undefined,
  );
  /** The account whose detail view (holdings/transactions/income tabs) is
   *  open; null shows the summary-card grid. */
  const [openAccountId, setOpenAccountId] = useState<string | null>(null);
  const [isFetchingPrices, setIsFetchingPrices] = useState(false);
  // Split backfill (FIX-874 follow-up): running state + a short result note.
  const [splitBackfill, setSplitBackfill] = useState<{ running: boolean; note: string | null }>({
    running: false,
    note: null,
  });

  // Holdings ride inline in each account record. Index them by accountId for
  // the per-account sections, and flatten them for the price fetch.
  const holdingsByAccount = useMemo(() => {
    const map = new Map<string, Holding[]>();
    for (const account of accounts) map.set(account.accountId, account.holdings);
    return map;
  }, [accounts]);
  const holdings = useMemo<Holding[]>(
    () => accounts.flatMap((a) => a.holdings),
    [accounts],
  );

  // Household tickers (upper) that have a standing thesis, for the per-holding
  // indicator. Derived (BP-010). The thesis is keyed household × ticker, so the
  // set is shared across every account.
  const thesisTickers = useMemo(
    () => new Set(theses.map((t) => t.ticker.toUpperCase())),
    [theses],
  );
  // The existing thesis for the open editor's ticker, if any (pre-fill source).
  const editingThesis = useMemo(() => {
    if (thesisTicker === null) return null;
    const upper = thesisTicker.toUpperCase();
    return theses.find((t) => t.ticker.toUpperCase() === upper) ?? null;
  }, [thesisTicker, theses]);

  // Ledger-derived income, shaped for its consumers: a per-account
  // ticker→dividends map for the holdings tables, per-account and portfolio
  // dividend totals for the summary lines (BP-010 — derived, memoed). Totals
  // include income earned on since-closed positions and ticker-less
  // account-level dividends (e.g. fund distributions) — earned is earned.
  const { dividendsByAccount, dividendTotals, totalDividends } = useMemo(() => {
    const dividendsByAccount = new Map<string, Map<string, number>>();
    const dividendTotals = new Map<string, number>();
    let totalDividends: number | null = null;
    for (const r of income) {
      if (r.dividends !== 0) {
        dividendTotals.set(r.accountId, (dividendTotals.get(r.accountId) ?? 0) + r.dividends);
        totalDividends = (totalDividends ?? 0) + r.dividends;
      }
      if (r.ticker === null) continue;
      const acct = dividendsByAccount.get(r.accountId) ?? new Map<string, number>();
      acct.set(r.ticker.toUpperCase(), r.dividends);
      dividendsByAccount.set(r.accountId, acct);
    }
    return { dividendsByAccount, dividendTotals, totalDividends };
  }, [income]);

  // Open FIFO lots per account per ticker, derived client-side from the
  // already-fetched ledger (deriveLots is a pure browser-safe leaf — the same
  // reduction the server's position materialization runs). Feeds the per-lot
  // short/long term split; a holding with no ledger history falls back to its
  // own acquiredDate inside the row model.
  const lotsByAccount = useMemo(() => {
    const map = new Map<string, Map<string, TermLot[]>>();
    for (const event of ledgerEvents) {
      if (!map.has(event.accountId)) map.set(event.accountId, new Map());
    }
    for (const [accountId, perTicker] of map) {
      const { lots } = deriveLots(ledgerEvents.filter((e) => e.accountId === accountId));
      for (const lot of lots) {
        const key = lot.ticker.toUpperCase();
        const list = perTicker.get(key) ?? [];
        list.push({ quantity: lot.quantity, acquiredDate: lot.acquiredDate });
        perTicker.set(key, list);
      }
    }
    return map;
  }, [ledgerEvents]);

  // Lifetime net realized gain/loss (all years), reusing the Realized Gains
  // tab's grand-total logic: per account (in its own currency) for the account
  // cards, and one household figure (USD, the summary line's label) for the
  // summary line. Basis-unknown disposals drop out honestly (excludedCount); a
  // non-USD account nulls the household figure via the currency gate. BP-010.
  const realizedByAccount = useMemo(
    () =>
      realizedTotalsByAccount(
        realizedGains,
        new Map(accounts.map((a) => [a.accountId, a.currency])),
      ),
    [realizedGains, accounts],
  );
  const householdRealized = useMemo(
    () => computeRealizedGainTotals(buildRealizedGainsRowModel(realizedGains), "USD").grandTotal,
    [realizedGains],
  );

  // Price map: ticker (upper) → quote. Read from the resource the action wrote.
  const quotes = quotesData as PortfolioQuotesState | null;
  const priceMap = useMemo(() => {
    const map = new Map<string, Quote>();
    for (const q of quotes?.quotes ?? []) map.set(q.ticker.toUpperCase(), q);
    return map;
  }, [quotes]);

  // Per-account rollups + grand totals, derived (BP-010). A value is null when
  // no holding in the account has a known price (degrades to "—"). The P/L
  // percent bases on the cost of the holdings whose P/L was computable — the
  // same subset the dollar figure sums, so $ and % always describe one book.
  const { rollups, totalValue, totalUpl, totalUplPct } = useMemo(() => {
    const rollups = new Map<string, AccountRollup>();
    let totalValue: number | null = null;
    let totalUpl: number | null = null;
    let totalCost = 0;
    for (const account of accounts) {
      const accHoldings = holdingsByAccount.get(account.accountId) ?? [];
      let value: number | null = null;
      let upl: number | null = null;
      let cost = 0;
      for (const h of accHoldings) {
        const quote = priceMap.get(h.ticker.toUpperCase());
        // Value BY TYPE (FIX-773 Slice C) so the account/portfolio totals and the
        // weight denominator match the per-row values (bond at mark, MMF at par,
        // equity via quote). uP/L stays vs the type-resolved price.
        const v = holdingMarketValue(h, quote);
        if (v !== null) value = (value ?? 0) + v;
        // uP/L BY TYPE too (bond/option vs its mark, equity vs its quote); track
        // the cost of the computable subset so uplPct bases on the same book the
        // dollar figure sums.
        const p = holdingUnrealizedPL(h, quote);
        if (p !== null) {
          upl = (upl ?? 0) + p;
          cost += (h.costBasis as number) * h.quantity;
        }
      }
      // Cash counts toward account + portfolio value.
      if (account.cashBalance !== 0 || value !== null) {
        value = (value ?? 0) + account.cashBalance;
      }
      const uplPct = upl !== null && cost !== 0 ? upl / cost : null;
      rollups.set(account.accountId, { value, upl, uplPct });
      if (value !== null) totalValue = (totalValue ?? 0) + value;
      if (upl !== null) {
        totalUpl = (totalUpl ?? 0) + upl;
        totalCost += cost;
      }
    }
    const totalUplPct =
      totalUpl !== null && totalCost !== 0 ? totalUpl / totalCost : null;
    return { rollups, totalValue, totalUpl, totalUplPct };
  }, [accounts, holdingsByAccount, priceMap]);

  // Allocation by asset class (BP-010 — derived, memoed, never stored). Each
  // holding's market value is resolved BY TYPE (same as the totals above) so the
  // split's denominator matches NAV; account cash balances roll into the `cash`
  // bucket. An unpriced holding contributes 0 (the "—" real-money gate).
  const allocation = useMemo(() => {
    const entries = holdings.map((h) => ({
      assetClass: h.assetClass,
      value: holdingMarketValue(h, priceMap.get(h.ticker.toUpperCase())),
    }));
    for (const account of accounts) {
      if (account.cashBalance !== 0) {
        entries.push({ assetClass: "cash", value: account.cashBalance });
      }
    }
    return allocationByClass(entries);
  }, [holdings, accounts, priceMap]);

  // Fetch prices for the union of held tickers. Dispatch → refresh → the
  // `portfolioQuotes` resource updates and `useResource` re-projects.
  const fetchPrices = useCallback(async () => {
    // Prices are the one portfolio feature that still needs a bound session:
    // `getQuotes` writes the cross-flow `portfolioQuotes` resource, so it stays
    // a flow action. Without a session (cold start, no analysis run yet) prices
    // stay "—" and the rest of the pane (CRUD) still works.
    if (!hasSession) return;
    // Only quote-valued types (equity/etf/mutual_fund/crypto) need a live quote;
    // bond/option value at their carried mark and cash/MMF at par (BP-033), so
    // fetching those would just burn retries and could surface a misleading quote
    // (e.g. CASH = Pathward). Filter at the source.
    const tickers = [
      ...new Set(
        holdings.filter((h) => usesLiveQuote(h.assetType)).map((h) => h.ticker.toUpperCase()),
      ),
    ];
    if (tickers.length === 0) return;
    setIsFetchingPrices(true);
    try {
      // Portfolio holdings are real, so prices are always LIVE — decoupled from
      // the analysis fixture/live toggle (fixtures only cover the 3 demo
      // tickers). getQuotes bounds the fan-out + retries, so a large portfolio
      // isn't throttled into "—".
      await session.sendAction("getQuotes", { tickers, dataSource: "live" });
      await session.refresh();
    } catch (err) {
      console.error("[trading-desk] getQuotes failed", err);
    } finally {
      setIsFetchingPrices(false);
    }
  }, [holdings, session]);

  // Auto-fetch prices once holdings are loaded and we have none yet, and when
  // the held-ticker set changes. Genuine side effect (network + external
  // resource sync), so an effect is correct here (BP-010). Keyed on the sorted
  // ticker signature so it doesn't refire on unrelated re-renders.
  const tickerSignature = useMemo(
    () =>
      [
        ...new Set(
          holdings.filter((h) => usesLiveQuote(h.assetType)).map((h) => h.ticker.toUpperCase()),
        ),
      ]
        .sort()
        .join(","),
    [holdings],
  );
  useEffect(() => {
    if (tickerSignature.length === 0) return;
    void fetchPrices();
    // fetchPrices is intentionally omitted: it closes over `holdings` which
    // changes identity every render; the ticker signature is the real trigger.
    // `hasSession` IS a trigger: when accounts load before the auto-created
    // session is ready, `fetchPrices` early-returns; re-run once the session
    // arrives so imported/existing holdings get live prices without a manual
    // refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerSignature, hasSession]);

  // Every mutation is an awaited REST call that returns its real result, then an
  // explicit refetch of the affected reads — no flow round-trip, no request
  // envelope, no session needed (FIX-736 follow-up). `userId` is passed in the
  // body/query, the client-asserted dev posture the read routes already use.
  const handleAddAccount = useCallback(
    async (draft: NewAccountDraft) => {
      try {
        await apiMutate("/api/portfolio/accounts", "POST", {
          userId: uid,
          accountId: null,
          ...draft,
        });
        refetchAccounts();
        // A new account (esp. a taxable one) changes the estimate's
        // taxable-account filter, so the tax read refetches too.
        refetchTax();
      } catch (err) {
        console.error("[trading-desk] saveAccount failed", err);
      }
    },
    [uid, refetchAccounts, refetchTax],
  );

  const handleImport = useCallback(
    async (submit: ImportSubmit) => {
      try {
        await apiMutate("/api/portfolio/holdings/import", "POST", { userId: uid, ...submit });
        // Holdings ride along inside the account record, so refetching accounts
        // is enough — there is no separate holdings list to refresh.
        refetchAccounts();
        await fetchPrices();
      } catch (err) {
        console.error("[trading-desk] importHoldings failed", err);
      }
    },
    [uid, refetchAccounts, fetchPrices],
  );

  const handleImportTransactions = useCallback(
    async (submit: TransactionImportSubmit) => {
      try {
        await apiMutate("/api/portfolio/transactions/import", "POST", {
          userId: uid,
          ...submit,
        });
        // An import writes ledger events AND materializes the derived positions
        // into holdings, so refetch the ledger, the accounts, and the income.
        // Sells produce realized gains, so refetch the tax read too.
        refetchLedger();
        refetchAccounts();
        refetchIncome();
        refetchTax();
        await fetchPrices();
      } catch (err) {
        console.error("[trading-desk] importTransactions failed", err);
      }
    },
    [uid, refetchLedger, refetchAccounts, refetchIncome, refetchTax, fetchPrices],
  );

  const handleRecordTransaction = useCallback(
    async (event: NewLedgerEvent) => {
      try {
        await apiMutate("/api/portfolio/ledger", "POST", { userId: uid, ...event });
        // An ingest materializes derived positions into holdings, so refetch the
        // ledger, the accounts, and the income. A sell realizes a gain, so
        // refetch the tax read too.
        refetchLedger();
        refetchAccounts();
        refetchIncome();
        refetchTax();
      } catch (err) {
        console.error("[trading-desk] recordLedgerEvent failed", err);
      }
    },
    [uid, refetchLedger, refetchAccounts, refetchIncome, refetchTax],
  );

  const handleDeleteHolding = useCallback(
    async (accountId: string, ticker: string) => {
      try {
        const params = new URLSearchParams({ userId: uid, accountId, ticker });
        await apiMutate(`/api/portfolio/holdings?${params}`, "DELETE");
        refetchAccounts();
      } catch (err) {
        console.error("[trading-desk] deleteHolding failed", err);
      }
    },
    [uid, refetchAccounts],
  );

  const handleSetAssetClass = useCallback(
    async (accountId: string, ticker: string, assetClass: AssetClass) => {
      try {
        await apiMutate("/api/portfolio/holdings", "PATCH", {
          userId: uid,
          accountId,
          ticker,
          assetClass,
        });
        refetchAccounts();
      } catch (err) {
        console.error("[trading-desk] setHoldingAssetClass failed", err);
      }
    },
    [uid, refetchAccounts],
  );

  // Backfill stock splits from the market-data provider (FIX-874 follow-up), then
  // refetch every read the corrected lot derivation touches (ledger, holdings,
  // income, and the realized-gains/tax read). Idempotent server-side.
  const handleBackfillSplits = useCallback(async () => {
    setSplitBackfill({ running: true, note: null });
    try {
      const report = (await apiMutate("/api/portfolio/splits/backfill", "POST", {
        userId: uid,
      })) as { inserted: number; deduplicated: number; splitsFound: number; errors: unknown[] };
      refetchLedger();
      refetchAccounts();
      refetchIncome();
      refetchTax();
      const note =
        report.inserted > 0
          ? `Added ${report.inserted} split${report.inserted === 1 ? "" : "s"}; realized gains updated.`
          : report.splitsFound > 0
            ? "Splits already applied — nothing to add."
            : "No splits found for your holdings.";
      const withErrors =
        report.errors.length > 0 ? `${note} (${report.errors.length} ticker lookup(s) failed)` : note;
      setSplitBackfill({ running: false, note: withErrors });
    } catch (err) {
      console.error("[trading-desk] backfillSplits failed", err);
      setSplitBackfill({ running: false, note: "Split backfill failed — see console." });
    }
  }, [uid, refetchLedger, refetchAccounts, refetchIncome, refetchTax]);

  const handleDeleteAccount = useCallback(
    async (accountId: string) => {
      try {
        const params = new URLSearchParams({ userId: uid, accountId });
        await apiMutate(`/api/portfolio/accounts?${params}`, "DELETE");
        // The open detail view (if it was this account) no longer exists —
        // return to the card grid.
        setOpenAccountId((open) => (open === accountId ? null : open));
        refetchAccounts();
        refetchLedger();
        refetchIncome();
        // The FK cascade removes this account's realized-gain rows, and its
        // type is a tax input, so refetch the tax read.
        refetchTax();
      } catch (err) {
        console.error("[trading-desk] deleteAccount failed", err);
      }
    },
    [uid, refetchAccounts, refetchLedger, refetchIncome, refetchTax],
  );

  // Thesis writes stay flow actions (theses are a reactive user-scoped resource,
  // not a REST table), so they need a bound session — the affordance is gated on
  // `hasSession && !thesesLoading` below, so these only fire when a session exists.
  const handleSaveThesis = useCallback(
    async (payload: ThesisInputFields) => {
      try {
        await session.sendAction("saveThesis", payload);
        // sendAction returns a request envelope, not handler output — refetch
        // for the committed row so the per-holding indicator updates.
        refetchTheses();
      } catch (err) {
        console.error("[trading-desk] saveThesis failed", err);
      }
    },
    [session, refetchTheses],
  );

  const handleDeleteThesis = useCallback(
    async (ticker: string) => {
      try {
        await session.sendAction("deleteThesis", { ticker });
        refetchTheses();
      } catch (err) {
        console.error("[trading-desk] deleteThesis failed", err);
      }
    },
    [session, refetchTheses],
  );

  // No whole-pane empty state anymore: account/holdings/ledger management is
  // plain REST and works with no bound session (FIX-736 follow-up). Only the
  // genuinely flow-shaped features need a session — live prices (`getQuotes`,
  // which fetchPrices no-ops without one), PDF import (a streaming generator, its
  // button disabled below), and thesis editing (a reactive resource — the
  // per-holding editor is disabled until the session-backed theses load). So a
  // cold-start user can build their portfolio immediately; prices and thesis
  // affordances fill in once an analysis has been run.
  const totalUplFmt = formatSignedMoney(totalUpl, "USD");
  const totalUplPctFmt = formatSignedPercent(totalUplPct);
  const openAccount =
    openAccountId === null
      ? undefined
      : accounts.find((a) => a.accountId === openAccountId);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[color:var(--c-border)] px-4 py-2">
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="inline-flex h-7 items-center gap-1 rounded-md border border-[color:var(--c-border)] px-2.5 text-[11.5px] font-medium hover:bg-[color:var(--c-surface-2)]"
        >
          <Plus className="h-3 w-3" aria-hidden /> Add account
        </button>
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          disabled={accounts.length === 0}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md border border-[color:var(--c-border)] px-2.5 text-[11.5px] font-medium",
            accounts.length === 0
              ? "cursor-not-allowed opacity-50"
              : "hover:bg-[color:var(--c-surface-2)]",
          )}
          title={
            accounts.length === 0 ? "Add an account first" : "Import holdings CSV"
          }
        >
          <Upload className="h-3 w-3" aria-hidden /> Import CSV
        </button>
        <button
          type="button"
          onClick={() => setImportPdfOpen(true)}
          disabled={accounts.length === 0 || !hasSession}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md border border-[color:var(--c-border)] px-2.5 text-[11.5px] font-medium",
            accounts.length === 0 || !hasSession
              ? "cursor-not-allowed opacity-50"
              : "hover:bg-[color:var(--c-surface-2)]",
          )}
          title={
            accounts.length === 0
              ? "Add an account first"
              : !hasSession
                ? "PDF import uses an AI extraction pass — run an analysis first to start a session"
                : "Import holdings from a statement PDF"
          }
        >
          <FileText className="h-3 w-3" aria-hidden /> Import PDF
        </button>
        <button
          type="button"
          onClick={() => setImportTxnOpen(true)}
          disabled={accounts.length === 0}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md border border-[color:var(--c-border)] px-2.5 text-[11.5px] font-medium",
            accounts.length === 0
              ? "cursor-not-allowed opacity-50"
              : "hover:bg-[color:var(--c-surface-2)]",
          )}
          title={
            accounts.length === 0
              ? "Add an account first"
              : "Import a transaction file (OFX/QFX/QBO)"
          }
        >
          <FileUp className="h-3 w-3" aria-hidden /> Import transactions
        </button>
        <button
          type="button"
          onClick={() => setAddTransactionOpen(true)}
          disabled={accounts.length === 0}
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md border border-[color:var(--c-border)] px-2.5 text-[11.5px] font-medium",
            accounts.length === 0
              ? "cursor-not-allowed opacity-50"
              : "hover:bg-[color:var(--c-surface-2)]",
          )}
          title={
            accounts.length === 0
              ? "Add an account first"
              : "Record a manual transaction"
          }
        >
          <Receipt className="h-3 w-3" aria-hidden /> Add transaction
        </button>
        <button
          type="button"
          onClick={() => void fetchPrices()}
          disabled={holdings.length === 0 || isFetchingPrices || !hasSession}
          title={
            !hasSession
              ? "Live prices need a session — run an analysis first"
              : "Refresh live prices"
          }
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md border border-[color:var(--c-border)] px-2.5 text-[11.5px]",
            holdings.length === 0 || isFetchingPrices || !hasSession
              ? "cursor-not-allowed opacity-50"
              : "hover:bg-[color:var(--c-surface-2)]",
          )}
        >
          <RefreshCw
            className={cn("h-3 w-3", isFetchingPrices && "animate-spin")}
            aria-hidden
          />
          Refresh prices
        </button>
        <button
          type="button"
          onClick={() => void handleBackfillSplits()}
          disabled={ledgerEvents.length === 0 || splitBackfill.running}
          title="Fetch stock splits from market data so realized gains re-derive correctly (fixes split-mangled cost basis)"
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md border border-[color:var(--c-border)] px-2.5 text-[11.5px]",
            ledgerEvents.length === 0 || splitBackfill.running
              ? "cursor-not-allowed opacity-50"
              : "hover:bg-[color:var(--c-surface-2)]",
          )}
        >
          <Split className={cn("h-3 w-3", splitBackfill.running && "animate-pulse")} aria-hidden />
          {splitBackfill.running ? "Backfilling…" : "Backfill splits"}
        </button>
        {splitBackfill.note ? (
          <span className="text-[10.5px] text-[color:var(--c-fg-muted)]">{splitBackfill.note}</span>
        ) : null}

        <div className="ml-auto flex items-center gap-4 font-mono text-[11px] text-[color:var(--c-fg-muted)]">
          <span>
            total value{" "}
            <span className="text-[color:var(--c-fg)]">
              {totalValue === null ? DASH : formatMoney(totalValue, "USD")}
            </span>
          </span>
          <span>
            total uP/L{" "}
            <span
              style={{
                color: totalUplFmt.direction === "down" ? "var(--c-warn)" : "var(--c-fg)",
              }}
            >
              {totalUplFmt.text}
              {totalUplPctFmt === DASH ? "" : ` (${totalUplPctFmt})`}
            </span>
          </span>
          <span>
            total dividends{" "}
            <span className="text-[color:var(--c-fg)]">
              {formatMoney(totalDividends, "USD")}
            </span>
          </span>
          <span>
            total realized <RealizedStat total={householdRealized} currency="USD" />
          </span>
          {allocation.length > 0 && (
            <span>
              allocation{" "}
              <span className="text-[color:var(--c-fg)]">
                {allocation
                  .map(
                    (s) =>
                      `${ASSET_CLASS_LABELS[s.assetClass]} ${formatPercent(s.weight)}`,
                  )
                  .join(" · ")}
              </span>
            </span>
          )}
        </div>
      </div>

      {/* Provenance line (real-money gate): live source + as-of. Portfolio
          holdings are real, so prices are always live — independent of the
          analysis fixture/live toggle. */}
      <div className="border-b border-[color:var(--c-border)] px-4 py-1 text-[10px] text-[color:var(--c-fg-faint)]">
        Prices: {quotes?.dataSource ?? "live"}
        {quotes?.quotes?.[0]?.asOf ? ` · as of ${quotes.quotes[0].asOf}` : ""}.
        Money figures are display approximations, not precise accounting.
      </div>

      {/* Accounts: a clickable summary-card grid, or one opened account's
          detail view (Holdings / Transactions / Income tabs). `@container` so
          the card-grid column count tracks the pane's width, not the viewport
          (the HoldingsTable precedent). */}
      <div className="@container flex-1 space-y-4 overflow-y-auto p-4">
        {/* Household-level realized-gains tax preview — a standalone section
            above the accounts. */}
        <TaxEstimateCard
          estimate={taxEstimate}
          profile={taxProfile}
          onEditProfile={() => setTaxProfileOpen(true)}
        />
        {accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <p className="text-sm text-[color:var(--c-fg)]">No accounts yet</p>
            <p className="max-w-md text-xs text-[color:var(--c-fg-muted)]">
              Add an account, then import a brokerage CSV or transaction file.
              The same ticker in two accounts is tracked as two distinct
              holdings.
            </p>
          </div>
        ) : openAccount !== undefined ? (
          <AccountDetail
            account={openAccount}
            holdings={holdingsByAccount.get(openAccount.accountId) ?? []}
            ledgerEvents={ledgerEvents}
            income={income}
            realizedGains={realizedGains}
            prices={priceMap}
            dividends={dividendsByAccount.get(openAccount.accountId) ?? new Map()}
            lots={lotsByAccount.get(openAccount.accountId) ?? new Map()}
            accountValue={rollups.get(openAccount.accountId)?.value ?? null}
            accountUpl={rollups.get(openAccount.accountId)?.upl ?? null}
            accountUplPct={rollups.get(openAccount.accountId)?.uplPct ?? null}
            accountDividends={dividendTotals.get(openAccount.accountId) ?? null}
            onBack={() => setOpenAccountId(null)}
            thesisTickers={thesisTickers}
            // Gate the thesis editor until the household theses load (session-
            // backed resource; no session → never ready), so a click can't open
            // a blank editor against a partial list and overwrite an unloaded one.
            thesisReady={hasSession && !thesesLoading}
            onDeleteHolding={(ticker) =>
              void handleDeleteHolding(openAccount.accountId, ticker)
            }
            onDeleteAccount={() => void handleDeleteAccount(openAccount.accountId)}
            onEditThesis={(ticker) => setThesisTicker(ticker)}
            onSetAssetClass={(ticker, assetClass) =>
              void handleSetAssetClass(openAccount.accountId, ticker, assetClass)
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-2 @6xl:grid-cols-3">
            {accounts.map((account) => {
              const rollup = rollups.get(account.accountId) ?? {
                value: null,
                upl: null,
                uplPct: null,
              };
              return (
                <AccountCard
                  key={account.accountId}
                  account={account}
                  holdingsCount={
                    (holdingsByAccount.get(account.accountId) ?? []).length
                  }
                  accountValue={rollup.value}
                  accountUpl={rollup.upl}
                  accountUplPct={rollup.uplPct}
                  accountDividends={dividendTotals.get(account.accountId) ?? null}
                  accountRealized={realizedByAccount.get(account.accountId) ?? null}
                  onOpen={() => {
                    setOpenAccountId(account.accountId);
                    // The import/add dialogs default to the account in focus.
                    setSelectedAccountId(account.accountId);
                  }}
                />
              );
            })}
          </div>
        )}
      </div>

      <AddAccountDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={(draft) => void handleAddAccount(draft)}
      />
      <ImportCsvDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        accounts={accounts}
        defaultAccountId={selectedAccountId ?? accounts[0]?.accountId}
        onSubmit={(submit) => {
          setSelectedAccountId(submit.accountId);
          void handleImport(submit);
        }}
      />
      <ImportPdfDialog
        open={importPdfOpen}
        onClose={() => setImportPdfOpen(false)}
        session={session}
        accounts={accounts}
        defaultAccountId={selectedAccountId ?? accounts[0]?.accountId}
        onSubmit={(submit) => {
          setSelectedAccountId(submit.accountId);
          void handleImport(submit);
        }}
      />
      <ImportTransactionsDialog
        open={importTxnOpen}
        onClose={() => setImportTxnOpen(false)}
        accounts={accounts}
        defaultAccountId={selectedAccountId ?? accounts[0]?.accountId}
        onSubmit={(submit) => {
          setSelectedAccountId(submit.accountId);
          void handleImportTransactions(submit);
        }}
      />
      <AddTransactionDialog
        open={addTransactionOpen}
        onClose={() => setAddTransactionOpen(false)}
        accounts={accounts}
        defaultAccountId={selectedAccountId ?? accounts[0]?.accountId}
        onSubmit={(event) => void handleRecordTransaction(event)}
      />
      <TaxProfileDialog
        open={taxProfileOpen}
        onClose={() => setTaxProfileOpen(false)}
        userId={uid}
        profile={taxProfile}
        onSaved={() => refetchTax()}
      />
      <ThesisDialog
        open={thesisTicker !== null}
        onClose={() => setThesisTicker(null)}
        ticker={thesisTicker ?? ""}
        existing={editingThesis}
        onSave={(payload) => void handleSaveThesis(payload)}
        onDelete={(ticker) => void handleDeleteThesis(ticker)}
      />
    </div>
  );
}
