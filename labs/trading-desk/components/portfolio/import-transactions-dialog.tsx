/**
 * ImportTransactionsDialog — native `<dialog>` for importing a brokerage
 * transaction-history file (OFX family: `.ofx` / `.qfx` / `.qbo`) into a chosen
 * account's ledger (FIX-775).
 *
 * The preview runs the SAME pure parser the server uses
 * (`detectAndParseTransactionFile`) client-side, so the user sees the detected
 * format, how many events will land, which securities couldn't be resolved to a
 * ticker (CUSIP-only), and which corporate actions are skipped — before
 * committing. On Import the parent dispatches `importTransactions`, which
 * re-parses server-side (never trusts the client preview) and ingests through
 * the shared idempotent contract, so a re-import is a safe no-op.
 *
 * Parsing is async (the OFX tokenizer is), so the preview is computed in a file-
 * read handler and held in state — not a `useMemo` (BP-010: a `useMemo` can't
 * await). The `.csv` broker path is a follow-up (PR2); this dialog accepts OFX
 * files and reports a clear message for anything else.
 */
"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { cn } from "@/lib/utils";
import {
  detectAndParseTransactionFile,
  type TransactionFileParse,
} from "@/src/flows/portfolio/transaction-file";
import type { AccountState } from "@/src/flows/portfolio/portfolio-schema";

/** What the parent needs to dispatch `importTransactions`. */
export type TransactionImportSubmit = {
  accountId: string;
  content: string;
  filename: string | null;
};

type ImportTransactionsDialogProps = {
  open: boolean;
  onClose: () => void;
  accounts: AccountState[];
  /** The account selected by default (the currently-viewed account). */
  defaultAccountId: string | undefined;
  /** Persist the import. Parent dispatches `importTransactions` + refetches. */
  onSubmit: (submit: TransactionImportSubmit) => void;
};

const inputClass = cn(
  "h-7 w-full rounded-md border bg-[color:var(--c-surface-2)] px-2",
  "border-[color:var(--c-border)] font-mono text-[12px] text-[color:var(--c-fg)]",
  "focus:outline-none focus:border-[color:var(--c-accent)]",
);

export function ImportTransactionsDialog({
  open,
  onClose,
  accounts,
  defaultAccountId,
  onSubmit,
}: ImportTransactionsDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [accountId, setAccountId] = useState<string>("");
  const [content, setContent] = useState("");
  const [filename, setFilename] = useState<string | null>(null);
  const [preview, setPreview] = useState<TransactionFileParse | null>(null);

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
      setContent("");
      setFilename(null);
      setPreview(null);
    }
  }, [open, defaultAccountId, accounts]);

  // Reading + parsing a file is a genuine async side effect (not derived state),
  // so it runs in the file handler and the result is held in state (BP-010). A
  // read/parse failure surfaces as a preview error rather than a silent null.
  const handleFile = async (file: File): Promise<void> => {
    try {
      const text = await file.text();
      setContent(text);
      setFilename(file.name);
      setPreview(await detectAndParseTransactionFile(text, file.name));
    } catch (err) {
      setContent("");
      setFilename(file.name);
      setPreview({
        format: "unknown",
        events: [],
        diagnostics: {
          parseErrors: [
            { line: null, reason: err instanceof Error ? err.message : "Could not read the file." },
          ],
          warnings: [],
          unresolvedSecurities: [],
          skipped: [],
        },
      });
    }
  };

  const eventCount = preview?.events.length ?? 0;
  const canImport = accountId.length > 0 && eventCount > 0;

  const handleSubmit = (): void => {
    if (!canImport) return;
    onSubmit({ accountId, content, filename });
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
        "w-[min(640px,calc(100vw-32px))] max-h-[calc(100vh-64px)]",
      )}
    >
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b border-[color:var(--c-border)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Import transactions</h2>
            <p className="mt-0.5 text-xs text-[color:var(--c-fg-muted)]">
              Upload a brokerage transaction file (.ofx / .qfx / .qbo). Cost basis
              reconstructs from the imported trade history. Re-importing is safe.
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
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
              Target account
            </span>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.currentTarget.value)}
              className={cn(inputClass, "max-w-xs")}
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

          <div className="flex items-center gap-3">
            <label className="cursor-pointer rounded border border-[color:var(--c-border)] px-2 py-1 text-[11px] hover:bg-[color:var(--c-surface-2)]">
              Choose file
              <input
                type="file"
                accept=".ofx,.qfx,.qbo"
                className="hidden"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
            </label>
            <span className="font-mono text-[10.5px] text-[color:var(--c-fg-muted)]">
              {filename ?? "no file selected"}
            </span>
          </div>

          {preview ? (
            <div className="space-y-1.5 rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-3 py-2">
              <p className="font-mono text-[11px] text-[color:var(--c-fg)]">
                Detected {preview.format.toUpperCase()} ·{" "}
                {eventCount} event{eventCount === 1 ? "" : "s"} to import
                {preview.diagnostics.skipped.length > 0
                  ? ` · ${preview.diagnostics.skipped.length} skipped`
                  : ""}
              </p>
              {preview.diagnostics.parseErrors.map((err, i) => (
                <p
                  key={i}
                  className="font-mono text-[10.5px] text-[color:var(--c-warn)]"
                >
                  ⚠ {err.reason}
                </p>
              ))}
              {preview.diagnostics.unresolvedSecurities.length > 0 ? (
                <p className="font-mono text-[10.5px] text-[color:var(--c-fg-muted)]">
                  {preview.diagnostics.unresolvedSecurities.length} security(ies)
                  have no ticker (CUSIP-only) — imported keyed by CUSIP, map them
                  later:{" "}
                  {preview.diagnostics.unresolvedSecurities
                    .slice(0, 6)
                    .map((s) => s.cusip)
                    .join(", ")}
                </p>
              ) : null}
              {preview.diagnostics.skipped.slice(0, 6).map((s, i) => (
                <p
                  key={i}
                  className="font-mono text-[10.5px] text-[color:var(--c-fg-muted)]"
                >
                  • {s.reason}
                </p>
              ))}
              {preview.diagnostics.warnings.slice(0, 6).map((w, i) => (
                <p
                  key={i}
                  className="font-mono text-[10.5px] text-[color:var(--c-fg-muted)]"
                >
                  • {w}
                </p>
              ))}
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
            Import {eventCount > 0 ? eventCount : ""}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
