/**
 * AccountCard — one account's clickable summary in the Portfolio card grid.
 * Shows the rollup a glance needs (value, cash, unrealized P/L as $ and %,
 * position count); clicking opens the account detail view (holdings /
 * transactions / income tabs in `AccountDetail`).
 *
 * Pure presentational. The parent computes the rollups; this component only
 * formats. Real-money gates hold: a value that depends on a missing price
 * renders "—", never a fabricated number.
 */
"use client";

import type { ReactElement } from "react";
import { ChevronRight } from "lucide-react";
import type { AccountState } from "@/src/domain/portfolio/schema/portfolio-schema";
import type { RealizedGainTotal } from "./realized-gains-row-model";
import { RealizedStat } from "./realized-stat";
import {
  DASH,
  formatMoney,
  formatSignedMoney,
  formatSignedPercent,
} from "./portfolio-format";

/** Account-type display labels (moved from the retired AccountSection). */
export const TYPE_LABELS: Record<AccountState["type"], string> = {
  taxable: "Taxable",
  IRA: "IRA",
  Roth: "Roth",
  "401k": "401(k)",
};

type AccountCardProps = {
  account: AccountState;
  /** Number of active holdings in the account. */
  holdingsCount: number;
  /** Account market value incl. cash; `null` while prices load. */
  accountValue: number | null;
  /** Unrealized P/L across the account's holdings; `null` if none computable. */
  accountUpl: number | null;
  /** Unrealized P/L as a fraction of the computable cost base; `null` when
   *  there is no cost base to compute against. */
  accountUplPct: number | null;
  /** Total dividends earned in this account per the ledger (incl. closed
   *  positions); `null` when none recorded — renders "—", not $0. */
  accountDividends: number | null;
  /** Lifetime net realized gain/loss for this account (all years), honest about
   *  basis-unknown rows; `null` when the account has no realized history. */
  accountRealized: RealizedGainTotal | null;
  onOpen: () => void;
};

export function AccountCard({
  account,
  holdingsCount,
  accountValue,
  accountUpl,
  accountUplPct,
  accountDividends,
  accountRealized,
  onOpen,
}: AccountCardProps): ReactElement {
  const uplFmt = formatSignedMoney(accountUpl, account.currency);
  const uplPctFmt = formatSignedPercent(accountUplPct);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-full flex-col gap-2 rounded-lg border border-[color:var(--c-border)] bg-[color:var(--c-surface)] p-3 text-left hover:border-[color:var(--c-fg-faint)] hover:bg-[color:var(--c-surface-2)]"
    >
      <div className="flex items-center gap-2">
        <h3 className="text-[13px] font-semibold text-[color:var(--c-fg)]">
          {account.name}
        </h3>
        <span className="rounded bg-[color:var(--c-surface-2)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[color:var(--c-fg-muted)]">
          {TYPE_LABELS[account.type]} · {account.currency}
        </span>
        <ChevronRight
          className="ml-auto h-3.5 w-3.5 text-[color:var(--c-fg-faint)] group-hover:text-[color:var(--c-fg)]"
          aria-hidden
        />
      </div>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-mono text-[11px] text-[color:var(--c-fg-muted)]">
        <span>
          value{" "}
          <span className="text-[color:var(--c-fg)]">
            {accountValue === null ? DASH : formatMoney(accountValue, account.currency)}
          </span>
        </span>
        <span>
          cash{" "}
          <span className="text-[color:var(--c-fg)]">
            {formatMoney(account.cashBalance, account.currency)}
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
        <span>
          realized <RealizedStat total={accountRealized} currency={account.currency} />
        </span>
        <span>
          {holdingsCount} {holdingsCount === 1 ? "position" : "positions"}
        </span>
      </div>
    </button>
  );
}
