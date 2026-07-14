/**
 * AccountDetail — one account, opened from its summary card. A back header
 * (name, type chip, rollups, delete-account) over three tabs:
 *
 *   Holdings       — the account's active positions (`HoldingsTable`)
 *   Transactions   — the account's ledger rows (`LedgerTable`, account-filtered)
 *   Income         — the account's dividends + interest (`IncomeTable`,
 *                    account-filtered; includes closed positions)
 *   Realized Gains — the account's realized gains by year/term
 *                    (`RealizedGainsTable`, account-filtered)
 *
 * Pure presentational + local tab state. The parent owns all data (accounts,
 * ledger, income, prices, rollups) and the write handlers; this component
 * filters per-account views and lays out. The tables themselves are the shared
 * components the old flat layout used, so the real-money formatting gates hold
 * unchanged.
 */
"use client";

import { useMemo, useState, type ReactElement } from "react";
import { ArrowLeft, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AccountState, AssetClass, Holding } from "@/domain/portfolio/schema/portfolio-schema";
import type { LedgerRow } from "@/domain/portfolio/schema/ledger-schema";
import type { Quote } from "@/domain/portfolio/services/get-quotes";
import type { IncomeSummaryRow, RealizedGainRow } from "@/db/repository";
import { HoldingsTable } from "./holdings-table";
import { LedgerTable } from "./ledger-table";
import { IncomeTable } from "./income-table";
import { RealizedGainsTable } from "./realized-gains-table";
import { TYPE_LABELS } from "./account-card";
import type { TermLot } from "./holding-term";
import {
  DASH,
  formatMoney,
  formatSignedMoney,
  formatSignedPercent,
} from "./portfolio-format";

type AccountTab = "holdings" | "transactions" | "income" | "gains";

const TABS: { id: AccountTab; label: string }[] = [
  { id: "holdings", label: "Holdings" },
  { id: "transactions", label: "Transactions" },
  { id: "income", label: "Income" },
  { id: "gains", label: "Realized Gains" },
];

type AccountDetailProps = {
  account: AccountState;
  holdings: Holding[];
  /** The household's full ledger; filtered to this account here. */
  ledgerEvents: LedgerRow[];
  /** The household's full income summary; filtered to this account here. */
  income: IncomeSummaryRow[];
  /** The household's full realized-gains list; filtered to this account here. */
  realizedGains: RealizedGainRow[];
  prices: Map<string, Quote>;
  /** ticker (upper-case) → dividends earned in THIS account. */
  dividends: Map<string, number>;
  /** ticker (upper-case) → open FIFO lots in THIS account, for the term split. */
  lots: Map<string, TermLot[]>;
  accountValue: number | null;
  accountUpl: number | null;
  accountUplPct: number | null;
  /** Total dividends earned in this account per the ledger (incl. closed
   *  positions); `null` when none recorded. */
  accountDividends: number | null;
  /** Household tickers (upper-case) that have a standing thesis (FIX-760).
   *  Household × ticker, so the set is shared across every account. */
  thesisTickers: ReadonlySet<string>;
  /** Whether the household theses have finished loading; the per-holding thesis
   *  editor affordance is disabled until then so it can't blank-edit/overwrite
   *  an unloaded thesis (FIX-760). */
  thesisReady?: boolean;
  onBack: () => void;
  onDeleteHolding: (ticker: string) => void;
  onDeleteAccount: () => void;
  /** Open the thesis editor for one holding (the per-holding thesis affordance). */
  onEditThesis: (ticker: string) => void;
  /** Manually set a holding's allocation class (marks it a manual override). */
  onSetAssetClass: (ticker: string, assetClass: AssetClass) => void;
  /** Open the "resolve split" dialog for a flagged inconsistent-history holding
   *  (FIX-876). */
  onResolveSplit: (ticker: string) => void;
};

export function AccountDetail({
  account,
  holdings,
  ledgerEvents,
  income,
  realizedGains,
  prices,
  dividends,
  lots,
  accountValue,
  accountUpl,
  accountUplPct,
  accountDividends,
  thesisTickers,
  thesisReady = true,
  onBack,
  onDeleteHolding,
  onDeleteAccount,
  onEditThesis,
  onSetAssetClass,
  onResolveSplit,
}: AccountDetailProps): ReactElement {
  const [tab, setTab] = useState<AccountTab>("holdings");

  const accountLedger = useMemo(
    () => ledgerEvents.filter((e) => e.accountId === account.accountId),
    [ledgerEvents, account.accountId],
  );
  const accountIncome = useMemo(
    () => income.filter((r) => r.accountId === account.accountId),
    [income, account.accountId],
  );
  const accountRealizedGains = useMemo(
    () => realizedGains.filter((r) => r.accountId === account.accountId),
    [realizedGains, account.accountId],
  );
  const activeTickers = useMemo(
    () => new Set(holdings.map((h) => h.ticker)),
    [holdings],
  );
  const accountNames = useMemo(
    () => new Map([[account.accountId, account.name]]),
    [account.accountId, account.name],
  );

  const uplFmt = formatSignedMoney(accountUpl, account.currency);
  const uplPctFmt = formatSignedPercent(accountUplPct);

  return (
    <section className="rounded-lg border border-[color:var(--c-border)] bg-[color:var(--c-surface)]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[color:var(--c-border)] px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex h-6 items-center gap-1 rounded-md border border-[color:var(--c-border)] px-2 font-mono text-[10.5px] text-[color:var(--c-fg-muted)] hover:bg-[color:var(--c-surface-2)] hover:text-[color:var(--c-fg)]"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden /> Accounts
        </button>
        <h3 className="text-[13px] font-semibold text-[color:var(--c-fg)]">
          {account.name}
        </h3>
        <span className="rounded bg-[color:var(--c-surface-2)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[color:var(--c-fg-muted)]">
          {TYPE_LABELS[account.type]} · {account.currency}
        </span>
        <div className="ml-auto flex items-center gap-4 font-mono text-[11px] text-[color:var(--c-fg-muted)]">
          <span>
            cash{" "}
            <span className="text-[color:var(--c-fg)]">
              {formatMoney(account.cashBalance, account.currency)}
            </span>
          </span>
          <span>
            value{" "}
            <span className="text-[color:var(--c-fg)]">
              {accountValue === null ? DASH : formatMoney(accountValue, account.currency)}
            </span>
          </span>
          <span>
            uP/L{" "}
            <span
              style={{ color: uplFmt.direction === "down" ? "var(--c-warn)" : "var(--c-fg)" }}
            >
              {uplFmt.text}
              {uplPctFmt === DASH ? "" : ` (${uplPctFmt})`}
            </span>
          </span>
          <span>
            dividends{" "}
            <span className="text-[color:var(--c-fg)]">
              {formatMoney(accountDividends, account.currency)}
            </span>
          </span>
          <button
            type="button"
            onClick={onDeleteAccount}
            className="rounded p-1 text-[color:var(--c-fg-faint)] hover:bg-[color:var(--c-surface-2)] hover:text-[color:var(--c-warn)]"
            aria-label={`Delete account ${account.name}`}
            title={`Delete account ${account.name}`}
          >
            <Trash2 className="h-3 w-3" aria-hidden />
          </button>
        </div>
      </header>

      {/* Tab bar */}
      <div
        role="tablist"
        className="flex gap-1 border-b border-[color:var(--c-border)] px-3 pt-1.5"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-t-md border border-b-0 px-2.5 py-1 font-mono text-[10.5px] uppercase tracking-wider",
              tab === t.id
                ? "border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] text-[color:var(--c-fg)]"
                : "border-transparent text-[color:var(--c-fg-faint)] hover:text-[color:var(--c-fg-muted)]",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        {tab === "holdings" ? (
          <HoldingsTable
            holdings={holdings}
            prices={prices}
            dividends={dividends}
            lots={lots}
            currency={account.currency}
            accountTotal={accountValue}
            thesisTickers={thesisTickers}
            thesisReady={thesisReady}
            onDeleteHolding={onDeleteHolding}
            onEditThesis={onEditThesis}
            onSetAssetClass={onSetAssetClass}
            onResolveSplit={onResolveSplit}
          />
        ) : tab === "transactions" ? (
          <div className="p-2">
            <LedgerTable events={accountLedger} />
          </div>
        ) : tab === "income" ? (
          <div className="p-2">
            <IncomeTable
              income={accountIncome}
              accountNames={accountNames}
              activeTickers={activeTickers}
              currency={account.currency}
            />
          </div>
        ) : (
          <div className="p-2">
            <RealizedGainsTable
              realizedGains={accountRealizedGains}
              currency={account.currency}
            />
          </div>
        )}
      </div>

      {tab === "holdings" ? (
        <p className="border-t border-[color:var(--c-border)] px-3 py-1.5 text-[10px] text-[color:var(--c-fg-faint)]">
          Average cost is informational (not tax basis). Market value, weight, and
          unrealized P/L are display approximations from stored quantity/cost and a
          fetched price.
        </p>
      ) : null}
    </section>
  );
}
