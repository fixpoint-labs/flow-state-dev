/**
 * PortfolioPane — the Portfolio view. Per-account holdings tables with per-
 * account + total rollups, an account selector / add-account control, a CSV
 * import control, and a refresh-prices action.
 *
 * Data path:
 *  - Accounts come from the user-scoped `accounts` collection via
 *    `useResourceCollectionList`. Holdings ride inline in each account record
 *    (`account.holdings`) — there is no separate holdings collection.
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
import { Plus, Upload, FileText, RefreshCw } from "lucide-react";
import type { SessionView } from "@flow-state-dev/react";
import {
  useResource,
  useResourceCollectionList,
} from "@flow-state-dev/react";
import { cn } from "@/lib/utils";
import type {
  AccountState,
  Holding,
} from "@/src/flows/trading-desk-portfolio/portfolio-schema";
import type { Quote } from "@/src/flows/trading-desk-portfolio/get-quotes";
import type { PortfolioQuotesState } from "@/src/flows/trading-desk-portfolio/portfolio-resources";
import { AccountSection } from "./account-section";
import { AddAccountDialog, type NewAccountDraft } from "./add-account-dialog";
import { ImportCsvDialog, type ImportSubmit } from "./import-csv-dialog";
import { ImportPdfDialog } from "./import-pdf-dialog";
import {
  DASH,
  formatMoney,
  formatSignedMoney,
  marketValue,
  unrealizedPL,
} from "./portfolio-format";

type PortfolioPaneProps = {
  /** A bound session whose snapshot the user-scoped resource reads project
   *  from. Undefined when the user has no sessions at all. */
  session: SessionView;
  /** Whether the bound session is resolvable (a snapshot exists to read). */
  hasSession: boolean;
};

/** Per-account computed rollups, indexed by accountId. */
type AccountRollup = { value: number | null; upl: number | null };

export function PortfolioPane({
  session,
  hasSession,
}: PortfolioPaneProps): ReactElement {
  const accountsList = useResourceCollectionList(session, "accounts", {
    limit: 50,
  });
  const { clientData: quotesData } = useResource(session, "portfolioQuotes");

  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importPdfOpen, setImportPdfOpen] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | undefined>(
    undefined,
  );
  const [isFetchingPrices, setIsFetchingPrices] = useState(false);

  // Project collection items to typed state. `item.clientData` carries full
  // state (collections declare `client.state.read: true`).
  const accounts = useMemo<AccountState[]>(
    () =>
      accountsList.items
        .map((it) => it.clientData as AccountState | undefined)
        .filter((a): a is AccountState => a !== undefined),
    [accountsList.items],
  );
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

  // Price map: ticker (upper) → quote. Read from the resource the action wrote.
  const quotes = quotesData as PortfolioQuotesState | null;
  const priceMap = useMemo(() => {
    const map = new Map<string, Quote>();
    for (const q of quotes?.quotes ?? []) map.set(q.ticker.toUpperCase(), q);
    return map;
  }, [quotes]);

  // Per-account rollups + grand totals, derived (BP-010). A value is null when
  // no holding in the account has a known price (degrades to "—").
  const { rollups, totalValue, totalUpl } = useMemo(() => {
    const rollups = new Map<string, AccountRollup>();
    let totalValue: number | null = null;
    let totalUpl: number | null = null;
    for (const account of accounts) {
      const accHoldings = holdingsByAccount.get(account.accountId) ?? [];
      let value: number | null = null;
      let upl: number | null = null;
      for (const h of accHoldings) {
        const price = priceMap.get(h.ticker.toUpperCase())?.price ?? null;
        const v = marketValue(h.quantity, price);
        if (v !== null) value = (value ?? 0) + v;
        const p = unrealizedPL(h.quantity, h.costBasis, price);
        if (p !== null) upl = (upl ?? 0) + p;
      }
      // Cash counts toward account + portfolio value.
      if (account.cashBalance !== 0 || value !== null) {
        value = (value ?? 0) + account.cashBalance;
      }
      rollups.set(account.accountId, { value, upl });
      if (value !== null) totalValue = (totalValue ?? 0) + value;
      if (upl !== null) totalUpl = (totalUpl ?? 0) + upl;
    }
    return { rollups, totalValue, totalUpl };
  }, [accounts, holdingsByAccount, priceMap]);

  // Fetch prices for the union of held tickers. Dispatch → refresh → the
  // `portfolioQuotes` resource updates and `useResource` re-projects.
  const fetchPrices = useCallback(async () => {
    const tickers = [...new Set(holdings.map((h) => h.ticker.toUpperCase()))];
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
    () => [...new Set(holdings.map((h) => h.ticker.toUpperCase()))].sort().join(","),
    [holdings],
  );
  useEffect(() => {
    if (tickerSignature.length === 0) return;
    void fetchPrices();
    // fetchPrices is intentionally omitted: it closes over `holdings` which
    // changes identity every render; the ticker signature is the real trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerSignature]);

  const handleAddAccount = useCallback(
    async (draft: NewAccountDraft) => {
      try {
        await session.sendAction("saveAccount", { accountId: null, ...draft });
        accountsList.refetch();
      } catch (err) {
        console.error("[trading-desk] saveAccount failed", err);
      }
    },
    [session, accountsList],
  );

  const handleImport = useCallback(
    async (submit: ImportSubmit) => {
      try {
        await session.sendAction("importHoldings", submit);
        // Holdings ride along inside the account record, so refetching accounts
        // is enough — there is no separate holdings list to refresh.
        accountsList.refetch();
        await fetchPrices();
      } catch (err) {
        console.error("[trading-desk] importHoldings failed", err);
      }
    },
    [session, accountsList, fetchPrices],
  );

  const handleDeleteHolding = useCallback(
    async (accountId: string, ticker: string) => {
      try {
        await session.sendAction("deleteHolding", { accountId, ticker });
        accountsList.refetch();
      } catch (err) {
        console.error("[trading-desk] deleteHolding failed", err);
      }
    },
    [session, accountsList],
  );

  const handleDeleteAccount = useCallback(
    async (accountId: string) => {
      try {
        await session.sendAction("deleteAccount", { accountId });
        accountsList.refetch();
      } catch (err) {
        console.error("[trading-desk] deleteAccount failed", err);
      }
    },
    [session, accountsList],
  );

  // Empty-state: no bound session OR no accounts yet. Spec §12.1 recommendation
  // (a) would auto-create a junk session; we take the honest empty-state CTA
  // instead — Add Account works the moment a session exists (one is bound once
  // any analysis has run, or the user can run one first).
  if (!hasSession) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-sm text-[color:var(--c-fg)]">No session yet</p>
        <p className="max-w-md text-xs text-[color:var(--c-fg-muted)]">
          The portfolio reads user-scoped data through a session snapshot. Run an
          analysis first (New Analysis), then return here to add accounts and
          import holdings.
        </p>
      </div>
    );
  }

  const totalUplFmt = formatSignedMoney(totalUpl, "USD");

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
              : "Import holdings from a statement PDF"
          }
        >
          <FileText className="h-3 w-3" aria-hidden /> Import PDF
        </button>
        <button
          type="button"
          onClick={() => void fetchPrices()}
          disabled={holdings.length === 0 || isFetchingPrices}
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
            </span>
          </span>
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

      {/* Account sections */}
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <p className="text-sm text-[color:var(--c-fg)]">No accounts yet</p>
            <p className="max-w-md text-xs text-[color:var(--c-fg-muted)]">
              Add an account, then import a brokerage CSV. The same ticker in two
              accounts is tracked as two distinct holdings.
            </p>
          </div>
        ) : (
          accounts.map((account) => {
            const rollup = rollups.get(account.accountId) ?? {
              value: null,
              upl: null,
            };
            return (
              <AccountSection
                key={account.accountId}
                account={account}
                holdings={holdingsByAccount.get(account.accountId) ?? []}
                prices={priceMap}
                accountValue={rollup.value}
                accountUpl={rollup.upl}
                onDeleteHolding={(ticker) =>
                  void handleDeleteHolding(account.accountId, ticker)
                }
                onDeleteAccount={() => void handleDeleteAccount(account.accountId)}
              />
            );
          })
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
    </div>
  );
}
