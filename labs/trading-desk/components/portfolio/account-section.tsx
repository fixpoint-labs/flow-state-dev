/**
 * AccountSection — one account's header (name, type chip, cash, account value)
 * plus its holdings table.
 *
 * Pure presentational. The parent groups holdings by account and computes the
 * account total; this component formats and lays out. Average cost is labeled
 * "informational" here once per account (the real-money tax-accuracy gate) so
 * the table cells stay terse.
 */
"use client";

import type { ReactElement } from "react";
import { Trash2 } from "lucide-react";
import type {
  AccountState,
  Holding,
} from "@/src/flows/portfolio/portfolio-schema";
import type { Quote } from "@/src/flows/portfolio/get-quotes";
import { HoldingsTable } from "./holdings-table";
import { DASH, formatMoney, formatSignedMoney } from "./portfolio-format";

type AccountSectionProps = {
  account: AccountState;
  holdings: Holding[];
  prices: Map<string, Quote>;
  /** Sum of holding market values for this account; `null` while prices load
   *  or when no holding has a known price. */
  accountValue: number | null;
  /** Sum of unrealized P/L across this account's holdings; `null` if none
   *  computable. */
  accountUpl: number | null;
  /** Household tickers (upper-case) with a standing thesis (FIX-760). */
  thesisTickers: ReadonlySet<string>;
  /** Whether the household theses have finished loading; the thesis editor
   *  affordance is disabled until then so it can't blank-edit/overwrite an
   *  unloaded thesis (FIX-760). */
  thesisReady?: boolean;
  onDeleteHolding: (ticker: string) => void;
  onDeleteAccount: () => void;
  /** Open the thesis editor for one holding. */
  onEditThesis: (ticker: string) => void;
};

const TYPE_LABELS: Record<AccountState["type"], string> = {
  taxable: "Taxable",
  IRA: "IRA",
  Roth: "Roth",
  "401k": "401(k)",
};

export function AccountSection({
  account,
  holdings,
  prices,
  accountValue,
  accountUpl,
  thesisTickers,
  thesisReady = true,
  onDeleteHolding,
  onDeleteAccount,
  onEditThesis,
}: AccountSectionProps): ReactElement {
  const uplFmt = formatSignedMoney(accountUpl, account.currency);
  return (
    <section className="rounded-lg border border-[color:var(--c-border)] bg-[color:var(--c-surface)]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[color:var(--c-border)] px-3 py-2">
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
              {accountValue === null
                ? DASH
                : formatMoney(accountValue, account.currency)}
            </span>
          </span>
          <span>
            uP/L{" "}
            <span style={{ color: uplFmt.direction === "down" ? "var(--c-warn)" : "var(--c-fg)" }}>
              {uplFmt.text}
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
      <div className="overflow-x-auto">
        <HoldingsTable
          holdings={holdings}
          prices={prices}
          currency={account.currency}
          accountTotal={accountValue}
          thesisTickers={thesisTickers}
          thesisReady={thesisReady}
          onDeleteHolding={onDeleteHolding}
          onEditThesis={onEditThesis}
        />
      </div>
      <p className="border-t border-[color:var(--c-border)] px-3 py-1.5 text-[10px] text-[color:var(--c-fg-faint)]">
        Average cost is informational (not tax basis). Market value, weight, and
        unrealized P/L are display approximations from stored quantity/cost and a
        fetched price.
      </p>
    </section>
  );
}

export { TYPE_LABELS };
