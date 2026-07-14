/**
 * AddAccountDialog — native `<dialog>` for creating an account (name, type,
 * currency, optional starting cash).
 *
 * Mirrors `SettingsDialog`'s native-`<dialog>` idiom (focus trap, scrim,
 * Escape-to-close driven imperatively from `open`). It calls the parent's
 * `onSubmit` with the validated fields; the parent owns the `saveAccount` action
 * dispatch and the collection refetch. Stateless about persistence.
 */
"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { cn } from "@/lib/utils";
import type {
  AccountType,
} from "@/src/domain/portfolio/schema/portfolio-schema";
import {
  MANDATE_PACK,
  type RiskMandateId,
} from "@/src/flows/analysis/lib/risk-mandate";

type NewAccountDraft = {
  name: string;
  type: AccountType;
  currency: string;
  cashBalance: number;
  // The account's default risk-appetite mandate (FIX-752), or null for no
  // default. Stored opaquely server-side; resolved by the analysis flow at seed.
  riskMandate: RiskMandateId | null;
};

type AddAccountDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Persist the account. Parent dispatches `saveAccount` + refetches. */
  onSubmit: (draft: NewAccountDraft) => void;
};

const TYPE_OPTIONS: ReadonlyArray<{ value: AccountType; label: string }> = [
  { value: "taxable", label: "Taxable" },
  { value: "IRA", label: "IRA" },
  { value: "Roth", label: "Roth" },
  { value: "401k", label: "401(k)" },
];

const inputClass = cn(
  "h-7 w-full rounded-md border bg-[color:var(--c-surface-2)] px-2",
  "border-[color:var(--c-border)] font-mono text-[12px] text-[color:var(--c-fg)]",
  "focus:outline-none focus:border-[color:var(--c-accent)]",
);

export function AddAccountDialog({
  open,
  onClose,
  onSubmit,
}: AddAccountDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("taxable");
  const [currency, setCurrency] = useState("USD");
  const [cash, setCash] = useState("");
  const [riskMandate, setRiskMandate] = useState<RiskMandateId | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  // Drive the native <dialog> imperatively from `open` (matches SettingsDialog).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Reset the draft on each open so a prior cancel doesn't leak stale text.
  useEffect(() => {
    if (open) {
      setName("");
      setType("taxable");
      setCurrency("USD");
      setCash("");
      setRiskMandate(null);
      setError(undefined);
    }
  }, [open]);

  const handleSubmit = (): void => {
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError("Account name is required");
      return;
    }
    if (!/^[A-Za-z]{3}$/.test(currency.trim())) {
      setError("Currency must be a 3-letter ISO code (e.g. USD)");
      return;
    }
    const cashNum = cash.trim().length === 0 ? 0 : Number(cash.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(cashNum)) {
      setError("Cash balance must be a number");
      return;
    }
    onSubmit({
      name: trimmedName,
      type,
      currency: currency.trim().toUpperCase(),
      cashBalance: cashNum,
      riskMandate,
    });
    onClose();
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className={cn(
        "td-sheet m-auto rounded border p-0 backdrop:bg-black/40",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
        "text-[color:var(--c-fg)]",
        "w-[min(440px,calc(100vw-32px))]",
      )}
    >
      <div className="flex flex-col">
        <header className="flex items-center justify-between border-b border-[color:var(--c-border)] px-4 py-3">
          <h2 className="text-sm font-semibold">Add account</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs hover:bg-[color:var(--c-surface-2)]"
            aria-label="Close add account"
          >
            ✕
          </button>
        </header>

        <div className="space-y-3 px-4 py-4">
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
              Name
            </span>
            <input
              value={name}
              onChange={(e) => setName(e.currentTarget.value)}
              className={inputClass}
              placeholder="My Roth IRA"
              autoComplete="off"
            />
          </label>

          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                Type
              </span>
              <select
                value={type}
                onChange={(e) => setType(e.currentTarget.value as AccountType)}
                className={inputClass}
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex w-24 flex-col gap-1">
              <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                Currency
              </span>
              <input
                value={currency}
                onChange={(e) => setCurrency(e.currentTarget.value.toUpperCase())}
                className={inputClass}
                maxLength={3}
                spellCheck={false}
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
              Starting cash (optional)
            </span>
            <input
              value={cash}
              onChange={(e) => setCash(e.currentTarget.value)}
              className={inputClass}
              placeholder="0"
              inputMode="decimal"
            />
          </label>

          {/* Default risk-appetite mandate (FIX-752). "No default" → null; a run
              against this book uses it as the seed default unless a per-run
              override is set. Same option set as the New Analysis selector. */}
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
              Default risk mandate (optional)
            </span>
            <select
              value={riskMandate ?? "__none"}
              onChange={(e) => {
                const v = e.currentTarget.value;
                setRiskMandate(v === "__none" ? null : (v as RiskMandateId));
              }}
              className={inputClass}
              aria-label="Default risk-appetite mandate"
            >
              <option value="__none">No default</option>
              {MANDATE_PACK.map((m) => (
                <option key={m.id} value={m.id} title={m.description}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>

          {error !== undefined ? (
            <p className="text-[10.5px] text-[color:var(--c-warn)]">⚠ {error}</p>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-[color:var(--c-border)] px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-[color:var(--c-border)] px-3 py-1 text-xs hover:bg-[color:var(--c-surface-2)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="rounded bg-[color:var(--c-accent)] px-3 py-1 text-xs font-medium text-white hover:opacity-90"
          >
            Add account
          </button>
        </footer>
      </div>
    </dialog>
  );
}

export type { NewAccountDraft };
