/**
 * ImportCsvDialog — native `<dialog>` for importing holdings into a chosen
 * account from pasted text or an uploaded `.csv` file.
 *
 * The preview runs the PURE `parsePortfolioCsv` parser client-side (no server
 * round-trip) so the user sees the resolved column mapping, valid/error/warning
 * counts, and per-row errors before committing. On Import the parent dispatches
 * the `importHoldings` action, which RE-PARSES server-side (never trusts the
 * client preview) and returns the authoritative report.
 *
 * `replace-account` deletes every existing holding in the target account
 * (destructive, non-atomic — RISK-P6), so it requires a typed "REPLACE"
 * confirmation (spec §12.6 recommendation). `upsert` (default) is
 * non-destructive and needs no confirmation.
 */
"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import { parsePortfolioCsv } from "@/domain/portfolio/parsers/portfolio-csv";
import type {
  AccountState,
  ImportMode,
} from "@/domain/portfolio/schema/portfolio-schema";

type ImportSubmit = {
  accountId: string;
  csvText: string;
  mode: ImportMode;
  cashBalance: number | null;
};

type ImportCsvDialogProps = {
  open: boolean;
  onClose: () => void;
  accounts: AccountState[];
  /** The account selected by default (the currently-viewed account). */
  defaultAccountId: string | undefined;
  /** Persist the import. Parent dispatches `importHoldings` + refetches. */
  onSubmit: (submit: ImportSubmit) => void;
};

const MODE_OPTIONS = [
  { value: "upsert" as const, label: "Upsert", title: "Add/update; keep others" },
  {
    value: "replace-account" as const,
    label: "Replace account",
    title: "Delete all existing holdings, then import",
  },
];

const inputClass = cn(
  "h-7 w-full rounded-md border bg-[color:var(--c-surface-2)] px-2",
  "border-[color:var(--c-border)] font-mono text-[12px] text-[color:var(--c-fg)]",
  "focus:outline-none focus:border-[color:var(--c-accent)]",
);

export function ImportCsvDialog({
  open,
  onClose,
  accounts,
  defaultAccountId,
  onSubmit,
}: ImportCsvDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [accountId, setAccountId] = useState<string>("");
  const [mode, setMode] = useState<ImportMode>("upsert");
  const [cash, setCash] = useState("");
  const [csvText, setCsvText] = useState("");
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Reset on open. Default the account to the viewed one (or the first).
  useEffect(() => {
    if (open) {
      setAccountId(defaultAccountId ?? accounts[0]?.accountId ?? "");
      setMode("upsert");
      setCash("");
      setCsvText("");
      setConfirmText("");
    }
  }, [open, defaultAccountId, accounts]);

  // Live preview — derived state via useMemo (BP-010), not an effect. The pure
  // parser is cheap and deterministic, so recomputing on every keystroke is
  // fine and avoids an effect + extra state.
  const preview = useMemo(() => parsePortfolioCsv(csvText), [csvText]);
  const hasContent = csvText.trim().length > 0;

  const handleFile = async (file: File): Promise<void> => {
    const text = await file.text();
    setCsvText(text);
  };

  const replaceConfirmed =
    mode !== "replace-account" || confirmText.trim().toUpperCase() === "REPLACE";
  const canImport =
    accountId.length > 0 && preview.rows.length > 0 && replaceConfirmed;

  const handleSubmit = (): void => {
    if (!canImport) return;
    const cashNum =
      cash.trim().length === 0 ? null : Number(cash.replace(/[$,\s]/g, ""));
    onSubmit({
      accountId,
      csvText,
      mode,
      cashBalance: cashNum !== null && Number.isFinite(cashNum) ? cashNum : null,
    });
    onClose();
  };

  const mappingEntries = Object.entries(preview.mapping);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className={cn(
        "td-sheet m-auto rounded border p-0 backdrop:bg-black/40",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
        "text-[color:var(--c-fg)]",
        "w-[min(640px,calc(100vw-32px))] max-h-[calc(100vh-64px)]",
      )}
    >
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b border-[color:var(--c-border)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Import holdings</h2>
            <p className="mt-0.5 text-xs text-[color:var(--c-fg-muted)]">
              Paste a brokerage CSV or upload a file. Same ticker in two accounts
              is two distinct holdings.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs hover:bg-[color:var(--c-surface-2)]"
            aria-label="Close import"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex flex-1 flex-col gap-1">
              <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                Target account
              </span>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.currentTarget.value)}
                className={inputClass}
              >
                {accounts.length === 0 ? (
                  <option value="">No accounts — add one first</option>
                ) : null}
                {accounts.map((a) => (
                  <option key={a.accountId} value={a.accountId}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <Segmented
              label="mode"
              value={mode}
              options={MODE_OPTIONS}
              onChange={setMode}
            />
          </div>

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
              Cash balance (optional)
            </span>
            <input
              value={cash}
              onChange={(e) => setCash(e.currentTarget.value)}
              className={cn(inputClass, "w-40")}
              placeholder="leave blank to keep"
              inputMode="decimal"
            />
          </label>

          <div className="flex items-center gap-3">
            <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
              Paste CSV or
            </span>
            <label className="cursor-pointer rounded border border-[color:var(--c-border)] px-2 py-1 text-[11px] hover:bg-[color:var(--c-surface-2)]">
              Choose file
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
            </label>
          </div>

          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.currentTarget.value)}
            rows={6}
            spellCheck={false}
            placeholder={"ticker,quantity,costBasis,acquiredDate\nNVDA,12.5,118.40,2024-03-15"}
            className={cn(
              "w-full resize-y rounded-md border bg-[color:var(--c-surface-2)] px-2.5 py-1.5 font-mono text-[11px]",
              "border-[color:var(--c-border)] text-[color:var(--c-fg)]",
              "focus:outline-none focus:border-[color:var(--c-accent)]",
            )}
          />

          {hasContent ? (
            <div className="space-y-1.5 rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-3 py-2">
              <p className="font-mono text-[10.5px] text-[color:var(--c-fg-muted)]">
                Detected columns:{" "}
                {mappingEntries.length === 0
                  ? "none recognized"
                  : mappingEntries
                      .map(([header, field]) => `${header}→${field}`)
                      .join(", ")}
              </p>
              <p className="font-mono text-[11px] text-[color:var(--c-fg)]">
                Preview: {preview.rows.length} valid · {preview.errors.length}{" "}
                errors · {preview.warnings.length} warnings
              </p>
              {preview.errors.slice(0, 8).map((err) => (
                <p
                  key={err.rowNumber}
                  className="font-mono text-[10.5px] text-[color:var(--c-warn)]"
                >
                  ⚠ row {err.rowNumber}: {err.reason}
                </p>
              ))}
              {preview.warnings.slice(0, 6).map((w) => (
                <p
                  key={w}
                  className="font-mono text-[10.5px] text-[color:var(--c-fg-muted)]"
                >
                  • {w}
                </p>
              ))}
            </div>
          ) : null}

          {mode === "replace-account" ? (
            <div className="space-y-1 rounded-md border border-[color:var(--c-warn)]/50 px-3 py-2">
              <p className="text-[10.5px] text-[color:var(--c-warn)]">
                Replace deletes every existing holding in this account first
                (non-atomic — a crash mid-import can leave a partial account).
                Type REPLACE to confirm.
              </p>
              <input
                value={confirmText}
                onChange={(e) => setConfirmText(e.currentTarget.value)}
                className={cn(inputClass, "w-40")}
                placeholder="REPLACE"
                spellCheck={false}
                autoComplete="off"
              />
            </div>
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
            disabled={!canImport}
            className={cn(
              "rounded bg-[color:var(--c-accent)] px-3 py-1 text-xs font-medium text-white",
              "hover:opacity-90 disabled:opacity-50",
            )}
          >
            Import {preview.rows.length > 0 ? preview.rows.length : ""}
          </button>
        </footer>
      </div>
    </dialog>
  );
}

export type { ImportSubmit };
