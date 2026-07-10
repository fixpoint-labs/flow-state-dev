/**
 * AccountsActionsBar — the account-management actions for the Portfolio pane's
 * Accounts perspective (FIX-885 follow-up). These used to live on the pane's
 * always-visible toolbar; they only apply to accounts, so they moved into the
 * Accounts perspective (they're irrelevant on Gains & Taxes). The three import
 * paths are grouped under an `ImportMenu` so a growing action row stays tidy.
 *
 * Shown above the account-card grid (and the empty state — "Add account" is the
 * cold-start affordance); hidden while an account's detail view is open, which
 * has its own header. Refresh prices stays on the pinned pane toolbar: it drives
 * the always-visible totals, so it belongs with them, not here.
 *
 * Pure presentational — the pane owns the dialogs these buttons open and the
 * write handlers; this just renders the triggers.
 */
"use client";

import { type ReactElement } from "react";
import { Plus, Receipt, Split } from "lucide-react";
import { cn } from "@/lib/utils";
import { ImportMenu } from "./import-menu";

type AccountsActionsBarProps = {
  /** Whether any accounts exist — gates import / add-transaction / backfill. */
  hasAccounts: boolean;
  /** Whether a session is bound (PDF import needs one for AI extraction). */
  hasSession: boolean;
  /** Whether the ledger has events to backfill splits against. */
  canBackfill: boolean;
  /** Whether a split backfill is currently running. */
  backfillRunning: boolean;
  /** A transient note from the last backfill (e.g. "3 splits applied"). */
  backfillNote: string | null;
  onAddAccount: () => void;
  onImportCsv: () => void;
  onImportPdf: () => void;
  onImportTransactions: () => void;
  onAddTransaction: () => void;
  onBackfillSplits: () => void;
};

const buttonClass =
  "inline-flex h-7 items-center gap-1 rounded-md border border-[color:var(--c-border)] px-2.5 text-[11.5px] font-medium";

export function AccountsActionsBar({
  hasAccounts,
  hasSession,
  canBackfill,
  backfillRunning,
  backfillNote,
  onAddAccount,
  onImportCsv,
  onImportPdf,
  onImportTransactions,
  onAddTransaction,
  onBackfillSplits,
}: AccountsActionsBarProps): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={onAddAccount}
        className={cn(buttonClass, "hover:bg-[color:var(--c-surface-2)]")}
      >
        <Plus className="h-3 w-3" aria-hidden /> Add account
      </button>
      <ImportMenu
        disabled={!hasAccounts}
        pdfEnabled={hasSession}
        onImportCsv={onImportCsv}
        onImportPdf={onImportPdf}
        onImportTransactions={onImportTransactions}
      />
      <button
        type="button"
        onClick={onAddTransaction}
        disabled={!hasAccounts}
        title={hasAccounts ? "Record a manual transaction" : "Add an account first"}
        className={cn(
          buttonClass,
          hasAccounts
            ? "hover:bg-[color:var(--c-surface-2)]"
            : "cursor-not-allowed opacity-50",
        )}
      >
        <Receipt className="h-3 w-3" aria-hidden /> Add transaction
      </button>
      <button
        type="button"
        onClick={onBackfillSplits}
        disabled={!canBackfill || backfillRunning}
        title="Fetch stock splits from market data so realized gains re-derive correctly (fixes split-mangled cost basis)"
        className={cn(
          "inline-flex h-7 items-center gap-1 rounded-md border border-[color:var(--c-border)] px-2.5 text-[11.5px]",
          !canBackfill || backfillRunning
            ? "cursor-not-allowed opacity-50"
            : "hover:bg-[color:var(--c-surface-2)]",
        )}
      >
        <Split
          className={cn("h-3 w-3", backfillRunning && "animate-pulse")}
          aria-hidden
        />
        {backfillRunning ? "Backfilling…" : "Backfill splits"}
      </button>
      {backfillNote ? (
        <span className="text-[10.5px] text-[color:var(--c-fg-muted)]">
          {backfillNote}
        </span>
      ) : null}
    </div>
  );
}
