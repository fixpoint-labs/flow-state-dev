/**
 * PortfolioPane — the Portfolio view, split into sidebar-switched perspectives
 * (FIX-885): **Accounts** (the summary-card grid; clicking a card opens that
 * account's detail view (`AccountDetail`) with Holdings / Transactions /
 * Income / Realized Gains tabs) and **Gains & Taxes** (`GainsTaxesSection` —
 * the household year-by-year realized gains + tax-estimate card). A desktop
 * left rail / mobile strip (`portfolio-section-nav.tsx`) picks the section.
 * The pinned toolbar holds only the always-relevant bits — refresh prices and
 * the portfolio-level totals — plus the provenance line; account-management
 * actions (add account, imports, add transaction, backfill splits) live in the
 * Accounts perspective (`AccountsActionsBar`), since they don't apply on Gains &
 * Taxes. Only the content region swaps between sections.
 *
 * Data path:
 *  - Accounts (with inline holdings) come from the app-owned tables via the
 *    `/api/portfolio/accounts` read route (`usePortfolioAccounts`, FIX-772) —
 *    accounts are no longer an FSD resource. `refetch` after each write action.
 *  - Prices come from the quote-refresh route: `POST /api/portfolio/quotes/refresh`
 *    (which fetches live prices + upserts `app.quotes`) → `refetch` the durable
 *    table via `GET /api/portfolio/quotes` (`useQuotes`, FIX-823). A plain awaited
 *    REST write → refetch, exactly like the CRUD writes below — no flow action, no
 *    `isStreaming`-settle race (the retired `getQuotes` action + `portfolioQuotes`
 *    resource are both gone; the FIX-772 accounts-migration pattern).
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
import { RefreshCw } from "lucide-react";
import type { SessionView } from "@flow-state-dev/react";
import { useFlowContext } from "@flow-state-dev/react";
import { cn } from "@/lib/utils";
import { apiMutate } from "@/lib/use-api-query";
import type { AssetClass, Holding } from "@/domain/portfolio/schema/portfolio-schema";
import type { Quote } from "@/domain/portfolio/services/get-quotes";
import { deriveLots } from "@/domain/portfolio/math/lots";
import type { TermLot } from "./holding-term";
import type { ThesisInputFields } from "@/domain/portfolio/schema/thesis-schema";
import { AccountCard } from "./account-card";
import { AccountDetail } from "./account-detail";
import { AccountsActionsBar } from "./accounts-actions-bar";
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
import { ResolveSplitDialog } from "./resolve-split-dialog";
import { ThesisDialog } from "./thesis-dialog";
import { MandateDialog } from "./mandate-dialog";
import { usePortfolioMandate } from "./use-portfolio-mandate";
import { GainsTaxesSection } from "./gains-taxes-section";
import { HealthSection } from "./health-section";
import {
  PortfolioSectionRail,
  PortfolioSectionStrip,
  type PortfolioSection,
} from "./portfolio-section-nav";
import { TaxProfileDialog } from "./tax-profile-dialog";
import { usePortfolioAccounts } from "./use-portfolio-accounts";
import { useQuotes } from "./use-quotes";
import { useLedger } from "./use-ledger";
import { useIncome } from "./use-income";
import { useTax } from "./use-tax";
import { useTheses } from "./use-theses";
import {
  holdingMarketValue,
  holdingUnrealizedPL,
  usesLiveQuote,
} from "@/domain/portfolio/math/value-holding";
import {
  ASSET_CLASS_LABELS,
  DASH,
  allocationByClass,
  formatMoney,
  formatPercent,
  formatSignedMoney,
  formatSignedPercent,
} from "./portfolio-format";

/** Display labels for the asset-class allocation breakdown. */
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
    incomeByYear,
    estimate: taxEstimate,
    refetch: refetchTax,
  } = useTax();
  // Theses remain a user-scoped FSD resource (live client read), so this stays
  // session-based — unlike accounts/ledger/income which moved to REST routes.
  const { theses, loading: thesesLoading, refetch: refetchTheses } = useTheses(session);
  // Durable household portfolio mandate (FIX-761) — live-read + write via the
  // user-scoped resource; the summary chip + editor update on save/clear with no
  // manual refetch.
  const { mandate, ready: mandateReady, saveMandate, clearMandate } = usePortfolioMandate(session);
  // Last-known prices from the durable `app.quotes` table via the REST hook
  // (FIX-823) — the retired `portfolioQuotes` resource's `useResource` read is
  // gone. The refresh route upserts the table; `refetchQuotes` runs once that
  // awaited POST resolves (see `fetchPrices` below).
  const { quotes, refetch: refetchQuotes } = useQuotes();

  // Portfolio provenance as-of: the OLDEST quote time across ALL rows, not an
  // arbitrary first row. `getQuotes` is an unordered `WHERE IN`, so `quotes[0]`
  // is nondeterministic — one fresh row must not make a portfolio with a stale
  // row look fresher than it is. This is the honest "as of at least" the
  // analysis seed's `snapshotAsOf` already uses (guards.ts). Prefer each row's
  // market `asOf`; fall back to the oldest cache `fetchedAt` only when no row
  // carries a market time.
  const priceAsOf = useMemo(() => {
    const oldest = (times: (string | null)[]) =>
      times.reduce<string | null>(
        (min, t) => (t === null ? min : min === null || t < min ? t : min),
        null,
      );
    return oldest(quotes.map((q) => q.asOf)) ?? oldest(quotes.map((q) => q.fetchedAt));
  }, [quotes]);

  const [addOpen, setAddOpen] = useState(false);
  const [taxProfileOpen, setTaxProfileOpen] = useState(false);
  const [addTransactionOpen, setAddTransactionOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importPdfOpen, setImportPdfOpen] = useState(false);
  const [importTxnOpen, setImportTxnOpen] = useState(false);
  // The ticker whose thesis editor is open (null = closed). The dialog pre-fills
  // from the existing thesis for this ticker, if any.
  const [thesisTicker, setThesisTicker] = useState<string | null>(null);
  const [mandateOpen, setMandateOpen] = useState<boolean>(false);
  // The ticker whose "resolve split" dialog is open (null = closed), for a
  // flagged inconsistent-history holding (FIX-876).
  const [resolveSplitTicker, setResolveSplitTicker] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(
    undefined,
  );
  /** The account whose detail view (holdings/transactions/income tabs) is
   *  open; null shows the summary-card grid. */
  const [openAccountId, setOpenAccountId] = useState<string | null>(null);
  /** The sidebar-selected perspective (FIX-885). Deliberately local state (no
   *  routing in this app) — resets when the pane unmounts, same lifetime as
   *  `openAccountId`, which it does NOT reset: returning to Accounts restores
   *  the open drill-in. */
  const [section, setSection] = useState<PortfolioSection>("accounts");
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

  // Price map: ticker (upper) → quote. Built from the durable table rows the
  // refresh route upserted (FIX-823), projected to the `Quote` shape the
  // holdings table + valuation seam consume (`{ ticker, price, asOf }`).
  const priceMap = useMemo(() => {
    const map = new Map<string, Quote>();
    for (const q of quotes)
      map.set(q.ticker.toUpperCase(), { ticker: q.ticker, price: q.price, asOf: q.asOf });
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
        // A FIX-876 inconsistent-history holding (quantity 0, an unaccounted
        // split) is an UNKNOWN input — never fold its fake $0 into account/
        // portfolio totals (mirrors `buildPortfolioContext`). Its row is already
        // blanked with the ⚠ marker; skip it from the money math entirely.
        if (h.dataQuality === "inconsistent_history") continue;
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
    const entries = holdings
      // Skip inconsistent-history holdings (FIX-876) — an unknown position must not
      // land as a $0 slice in the allocation breakdown (same gate as the totals).
      .filter((h) => h.dataQuality !== "inconsistent_history")
      .map((h) => ({
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

  // Refresh live prices for the held tickers: POST the refresh route (which
  // fetches live quotes + upserts `app.quotes`), then refetch the durable table
  // directly. A plain awaited REST write → refetch — the same idiom the import
  // handlers use — with no bound session and no `isStreaming`-settle race (the
  // `getQuotes` flow action was retired for this route, FIX-823).
  const fetchPrices = useCallback(async () => {
    // Only quote-valued types (equity/etf/mutual_fund/crypto) need a live quote;
    // bond/option value at their carried mark and cash/MMF at par (BP-033), so
    // there's nothing to refresh when the portfolio holds none of them. The route
    // re-derives + re-filters the ticker set server-side; this is just a skip
    // guard so an all-bond portfolio doesn't fire a no-op request.
    const tickers = [
      ...new Set(
        holdings.filter((h) => usesLiveQuote(h.assetType)).map((h) => h.ticker.toUpperCase()),
      ),
    ];
    if (tickers.length === 0) return;
    setIsFetchingPrices(true);
    try {
      // Portfolio holdings are real, so prices are always LIVE — decoupled from
      // the analysis fixture/live toggle (fixtures only cover the 3 demo tickers).
      // The route bounds the fan-out + retries, so a large portfolio isn't
      // throttled into "—". The POST resolves only after the upsert commits, so
      // refetching immediately after reads the fresh rows (no settle race).
      await apiMutate("/api/portfolio/quotes/refresh", "POST", { userId: uid });
      refetchQuotes();
    } catch (err) {
      console.error("[trading-desk] refreshQuotes failed", err);
    } finally {
      setIsFetchingPrices(false);
    }
  }, [holdings, uid, refetchQuotes]);

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
    // The refresh route needs no session, so the held-ticker set is the only
    // trigger — imported/existing holdings get live prices without a manual
    // refresh or a session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerSignature]);

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

  // No whole-pane empty state anymore: account/holdings/ledger management AND the
  // price refresh are plain REST and work with no bound session (FIX-736/FIX-823).
  // Only the genuinely flow-shaped features still need a session — PDF import (a
  // streaming generator, its button disabled below) and thesis editing (a reactive
  // resource — the per-holding editor is disabled until the session-backed theses
  // load). So a cold-start user can build their portfolio and see live prices
  // immediately; only the PDF-import and thesis affordances wait on a session.
  const totalUplFmt = formatSignedMoney(totalUpl, "USD");
  const totalUplPctFmt = formatSignedPercent(totalUplPct);
  const openAccount =
    openAccountId === null
      ? undefined
      : accounts.find((a) => a.accountId === openAccountId);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Toolbar — only the always-relevant actions (refresh prices) + totals.
          Account-management actions live in the Accounts perspective below. */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[color:var(--c-border)] px-4 py-2">
        <button
          type="button"
          onClick={() => void fetchPrices()}
          disabled={holdings.length === 0 || isFetchingPrices}
          title="Refresh live prices"
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md border border-[color:var(--c-border)] px-2.5 text-[11.5px]",
            holdings.length === 0 || isFetchingPrices
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

        {/* Durable portfolio mandate (FIX-761) — edit entry + a summary chip. The
            write is a flow action (a reactive user-scoped resource), so it needs a
            bound session; gate the affordance on `hasSession`. */}
        <button
          type="button"
          onClick={() => setMandateOpen(true)}
          disabled={!hasSession || !mandateReady}
          title={
            !hasSession
              ? "Run an analysis first to bind a session"
              : !mandateReady
                ? "Loading the portfolio mandate…"
                : "Edit the household portfolio mandate"
          }
          className={cn(
            "inline-flex h-7 items-center gap-1 rounded-md border border-[color:var(--c-border)] px-2.5 text-[11.5px]",
            !hasSession || !mandateReady
              ? "cursor-not-allowed opacity-50"
              : "hover:bg-[color:var(--c-surface-2)]",
          )}
        >
          {mandate !== null ? "Edit mandate" : "Set mandate"}
        </button>
        {mandate !== null ? (
          <span
            className="rounded-sm border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-1.5 py-0.5 font-mono text-[10.5px] text-[color:var(--c-fg-muted)]"
            title="Active portfolio mandate"
          >
            {mandate.label}
            {mandate.constraints.maxPositionWeightPct != null
              ? ` · max ${mandate.constraints.maxPositionWeightPct}%`
              : ""}
            {mandate.constraints.exclusions.length > 0
              ? ` · ${mandate.constraints.exclusions.length} excluded`
              : ""}
          </span>
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

      {/* Provenance line (real-money gate): live source + as-of, derived from the
          durable quote rows (FIX-823). Portfolio holdings are real, so prices are
          always live — independent of the analysis fixture/live toggle. `source`
          is uniformly "live" in the table (fixture rows are never persisted); the
          as-of is the OLDEST market time across all rows ("as of at least"), so a
          single fresh row can't mask a stale one. */}
      <div className="border-b border-[color:var(--c-border)] px-4 py-1 text-[10px] text-[color:var(--c-fg-faint)]">
        Prices: {quotes[0]?.source ?? "live"}
        {priceAsOf ? ` · as of ${priceAsOf}` : ""}.
        Money figures are display approximations, not precise accounting.
      </div>

      {/* Perspective nav (FIX-885): a pinned segmented strip below `lg`, a left
          rail at `lg`+. Only the content column swaps between sections; the
          toolbar / totals / provenance rows above stay pinned. */}
      <PortfolioSectionStrip value={section} onChange={setSection} />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <PortfolioSectionRail value={section} onChange={setSection} />
        {/* The section content column. `@container` lives here so the account
            card-grid column count tracks the column's width, not the viewport
            (the HoldingsTable precedent). */}
        <div className="@container flex-1 space-y-4 overflow-y-auto p-4">
          {/* Account-management actions live here (not the pinned toolbar) — only
              on the Accounts perspective's list view, hidden in an open account's
              detail (which has its own header). */}
          {section === "accounts" && openAccount === undefined ? (
            <AccountsActionsBar
              hasAccounts={accounts.length > 0}
              hasSession={hasSession}
              canBackfill={ledgerEvents.length > 0}
              backfillRunning={splitBackfill.running}
              backfillNote={splitBackfill.note}
              onAddAccount={() => setAddOpen(true)}
              onImportCsv={() => setImportOpen(true)}
              onImportPdf={() => setImportPdfOpen(true)}
              onImportTransactions={() => setImportTxnOpen(true)}
              onAddTransaction={() => setAddTransactionOpen(true)}
              onBackfillSplits={() => void handleBackfillSplits()}
            />
          ) : null}
          {section === "gains" ? (
            /* Gains & Taxes: household year-by-year realized gains + the
               tax-estimate card (relocated from above the account grid). */
            <GainsTaxesSection
              realizedGains={realizedGains}
              incomeByYear={incomeByYear}
              estimate={taxEstimate}
              profile={taxProfile}
              onEditProfile={() => setTaxProfileOpen(true)}
            />
          ) : section === "health" ? (
            /* Health (FIX-762): household exposure, concentration, sector splits,
               cash + coverage — the deterministic aggregation leaf, self-contained
               like GainsTaxesSection. */
            <HealthSection
              accounts={accounts}
              priceMap={priceMap}
              pricesAsOf={priceAsOf}
              hasSession={hasSession}
              onRefreshPrices={() => void fetchPrices()}
              onAccountsCorrected={refetchAccounts}
            />
          ) : accounts.length === 0 ? (
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
              onResolveSplit={(ticker) => setResolveSplitTicker(ticker)}
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
      {/* Resolve-split dialog for a flagged inconsistent-history holding
          (FIX-876). Only reachable from an open account's holdings table, so it
          binds to that account; its ledger + quote drive the live preview, and
          confirming records the split through the same manual-ledger path. */}
      {openAccount !== undefined && resolveSplitTicker !== null ? (
        <ResolveSplitDialog
          open
          onClose={() => setResolveSplitTicker(null)}
          ticker={resolveSplitTicker}
          accountId={openAccount.accountId}
          currency={openAccount.currency}
          events={ledgerEvents.filter((e) => e.accountId === openAccount.accountId)}
          quote={priceMap.get(resolveSplitTicker.toUpperCase())}
          onConfirm={(event) => void handleRecordTransaction(event)}
        />
      ) : null}
      <ThesisDialog
        open={thesisTicker !== null}
        onClose={() => setThesisTicker(null)}
        ticker={thesisTicker ?? ""}
        existing={editingThesis}
        onSave={(payload) => void handleSaveThesis(payload)}
        onDelete={(ticker) => void handleDeleteThesis(ticker)}
      />
      <MandateDialog
        open={mandateOpen}
        onClose={() => setMandateOpen(false)}
        existing={mandate}
        onSave={(payload) => void saveMandate(payload)}
        onClear={() => void clearMandate()}
      />
    </div>
  );
}
