/**
 * ImportPdfDialog — native `<dialog>` for importing holdings from a brokerage
 * statement PDF, broker-agnostically and SAFELY (real money).
 *
 * Flow (three phases, all in this dialog):
 *  1. PICK    — choose the target account + the statement PDF. On upload, the
 *               PDF bytes are base64-encoded and `extractHoldingsFromPdf` is
 *               dispatched with them. The SERVER extracts the PDF text (pdfjs in
 *               Node — see `extract-pdf-text.server.ts`; the browser worker that
 *               turbopack resolved unreliably is gone) and the LLM transcription
 *               writes the extracted rows to the session-scoped `pdfImport`
 *               resource. Uploading the bytes is no new privacy exposure: the
 *               extracted holdings already go to the server + the LLM.
 *  2. REVIEW  — after `session.refresh()`, the dialog reads `pdfImport` via
 *               `useResource`, runs the DETERMINISTIC `reconcile()` (pure, never
 *               the LLM) on the rows, and shows: the transcribed rows, the
 *               per-row `shares*price ~= value` check, the total `sum vs stated`
 *               check, and the rows that will be skipped (contra-CUSIP / cash /
 *               blank). Cost basis is shown as absent with a plain note.
 *  3. CONFIRM — the user must explicitly confirm. LLM output is NEVER
 *               auto-imported. On confirm, the importable rows are mapped to the
 *               canonical shape and serialized to the same CSV the EXISTING
 *               `importHoldings` action parses (reusing its validation + merge +
 *               keying). The parent persists it exactly like the CSV path.
 *
 * Mirrors `import-csv-dialog.tsx` for styling/ergonomics; the reconciliation
 * preview is the PDF-specific safety surface a CSV import doesn't need.
 */
"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import type { SessionView } from "@flow-state-dev/react";
import { useResource } from "@flow-state-dev/react";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import {
  canonicalRowsToCsv,
  reconcile,
  toCanonicalRows,
} from "@/src/flows/trading-desk/portfolio/portfolio-pdf";
import type { PdfImportState } from "@/src/flows/trading-desk/portfolio/portfolio-pdf-resource";
import type {
  AccountState,
  ImportMode,
} from "@/src/flows/trading-desk/portfolio/portfolio-schema";
import type { ImportSubmit } from "./import-csv-dialog";

/** Reject obviously-too-large uploads before encoding/sending. A text brokerage
 *  statement is well under this; the cap guards against a multi-hundred-MB file
 *  ballooning the base64 string and the request body. */
const MAX_PDF_BYTES = 20 * 1024 * 1024;

/** Base64-encode bytes in chunks. `btoa(String.fromCharCode(...bytes))` blows
 *  the call stack on large buffers (the spread passes every byte as an arg), so
 *  build the binary string in fixed-size slices first. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000; // 32KB per chunk — safely under the arg-count limit.
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

type ImportPdfDialogProps = {
  open: boolean;
  onClose: () => void;
  /** The bound session — used to dispatch the extract action and read the
   *  `pdfImport` resource. */
  session: SessionView;
  accounts: AccountState[];
  defaultAccountId: string | undefined;
  /** Persist the confirmed import. Parent dispatches the EXISTING
   *  `importHoldings` + refetches — the same handler the CSV path uses. */
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

function fmtNum(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function fmtMoney(n: number | null): string {
  if (n === null) return "—";
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function ImportPdfDialog({
  open,
  onClose,
  session,
  accounts,
  defaultAccountId,
  onSubmit,
}: ImportPdfDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [accountId, setAccountId] = useState<string>("");
  const [mode, setMode] = useState<ImportMode>("upsert");
  const [cash, setCash] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [phase, setPhase] = useState<"pick" | "extracting" | "review">("pick");
  const [error, setError] = useState<string | null>(null);
  // Bumped on each OPEN (a ref so a running extraction can read the latest
  // value after its await): the review only shows if the dialog wasn't
  // closed+reopened mid-extract, so a stale resource from a prior import in the
  // same session can't surface.
  const extractTokenRef = useRef(0);

  const { clientData: pdfData } = useResource(session, "pdfImport");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Reset ONLY when the dialog opens (open flips to true) — NOT when `accounts`
  // or `defaultAccountId` change reference during a long extraction. Those props
  // get a new reference on nearly every parent re-render; keying the reset on
  // them knocked `phase` back to "pick" mid-flight, so the review never showed.
  // The defaults are read from the current closure, which is correct because
  // accounts are loaded before the dialog is opened.
  useEffect(() => {
    if (!open) return;
    setAccountId(defaultAccountId ?? accounts[0]?.accountId ?? "");
    setMode("upsert");
    setCash("");
    setConfirmText("");
    setFileName(null);
    setPhase("pick");
    setError(null);
    extractTokenRef.current += 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const extraction = (pdfData as PdfImportState | null)?.extraction ?? null;

  // Deterministic reconciliation — pure, recomputed client-side from the
  // resource rows (BP-010: derived state via useMemo, never an effect). The LLM
  // never runs the arithmetic; this is the trust gate the user reviews.
  const recon = useMemo(
    () => (phase === "review" && extraction ? reconcile(extraction) : null),
    [phase, extraction],
  );

  const handleFile = async (file: File): Promise<void> => {
    setFileName(file.name);
    setError(null);
    if (file.size > MAX_PDF_BYTES) {
      setError("That PDF is too large (over 20 MB). A statement should be well under this.");
      setPhase("pick");
      return;
    }
    setPhase("extracting");
    const token = extractTokenRef.current;
    try {
      // Read the bytes and base64-encode them; the SERVER extracts the text now
      // (no browser pdfjs worker). Empty / scanned-image PDFs surface as an
      // error from the server-side decode step.
      const buffer = await file.arrayBuffer();
      const pdfBase64 = bytesToBase64(new Uint8Array(buffer));
      await session.sendAction("extractHoldingsFromPdf", { pdfBase64 });
      await session.refresh();
      // Show the review only if the dialog wasn't closed+reopened mid-extract.
      // The ref reads the LATEST token (a closed-over state value could not).
      if (token === extractTokenRef.current) setPhase("review");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to read the PDF.",
      );
      setPhase("pick");
    }
  };

  const replaceConfirmed =
    mode !== "replace-account" || confirmText.trim().toUpperCase() === "REPLACE";

  const canImport =
    phase === "review" &&
    recon !== null &&
    recon.importableCount > 0 &&
    accountId.length > 0 &&
    replaceConfirmed;

  const handleSubmit = (): void => {
    if (!canImport || extraction === null) return;
    const { rows } = toCanonicalRows(extraction);
    const csvText = canonicalRowsToCsv(rows);
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

  const mapping = extraction === null ? null : toCanonicalRows(extraction);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      className={cn(
        "rounded border p-0 backdrop:bg-black/40",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
        "text-[color:var(--c-fg)]",
        "w-[min(760px,calc(100vw-32px))] max-h-[calc(100vh-64px)]",
      )}
    >
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b border-[color:var(--c-border)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">Import holdings from PDF</h2>
            <p className="mt-0.5 text-xs text-[color:var(--c-fg-muted)]">
              Upload a brokerage statement. We read it, then you review and
              confirm before anything is saved.
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
            <label className="cursor-pointer rounded border border-[color:var(--c-border)] px-2 py-1 text-[11px] hover:bg-[color:var(--c-surface-2)]">
              {fileName ? "Choose a different PDF" : "Choose PDF"}
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.currentTarget.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
            </label>
            {fileName ? (
              <span className="font-mono text-[10.5px] text-[color:var(--c-fg-muted)]">
                {fileName}
              </span>
            ) : null}
          </div>

          {error ? (
            <p className="rounded-md border border-[color:var(--c-warn)]/50 px-3 py-2 text-[11px] text-[color:var(--c-warn)]">
              {error}
            </p>
          ) : null}

          {phase === "extracting" ? (
            <p className="font-mono text-[11px] text-[color:var(--c-fg-muted)]">
              Reading the statement… transcribing holdings.
            </p>
          ) : null}

          {phase === "review" && recon !== null ? (
            <div className="space-y-3">
              {/* Honesty banner — cost basis is absent in a snapshot. */}
              <p className="rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-3 py-2 text-[10.5px] text-[color:var(--c-fg-muted)]">
                A holdings statement shows what you own now, not what you paid.
                Cost basis is NOT in this statement, so it will be imported blank
                — add it manually later for P/L. Money figures here are read from
                the statement, not live quotes.
              </p>

              {/* Rollup */}
              <p className="font-mono text-[11px] text-[color:var(--c-fg)]">
                {recon.importableCount} importable ·{" "}
                {recon.skippedCount} skipped · {recon.mismatchCount} value
                mismatch{recon.mismatchCount === 1 ? "" : "es"}
              </p>

              {/* Total reconciliation */}
              <div
                className={cn(
                  "rounded-md border px-3 py-2 text-[10.5px]",
                  recon.total.status === "mismatch"
                    ? "border-[color:var(--c-warn)]/60 text-[color:var(--c-warn)]"
                    : "border-[color:var(--c-border)] text-[color:var(--c-fg-muted)]",
                )}
              >
                Total check: sum of values {fmtMoney(recon.total.sumOfValues)}{" "}
                vs stated total {fmtMoney(recon.total.statedTotal)} —{" "}
                {recon.total.status === "ok"
                  ? "matches"
                  : recon.total.status === "mismatch"
                    ? "DOES NOT MATCH (review before importing)"
                    : "no stated total to check against"}
                .
              </div>

              {/* Row table */}
              <div className="overflow-x-auto rounded-md border border-[color:var(--c-border)]">
                <table className="w-full border-collapse font-mono text-[10.5px]">
                  <thead>
                    <tr className="text-left text-[color:var(--c-fg-faint)]">
                      <th className="px-2 py-1">#</th>
                      <th className="px-2 py-1">Ticker</th>
                      <th className="px-2 py-1 text-right">Shares</th>
                      <th className="px-2 py-1 text-right">Price</th>
                      <th className="px-2 py-1 text-right">Value</th>
                      <th className="px-2 py-1 text-right">Check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recon.rows.map((row) => (
                      <tr
                        key={row.rowNumber}
                        className={cn(
                          "border-t border-[color:var(--c-border)]",
                          !row.importable && "opacity-50",
                        )}
                      >
                        <td className="px-2 py-1 text-[color:var(--c-fg-faint)]">
                          {row.rowNumber}
                        </td>
                        <td className="px-2 py-1">
                          {row.ticker ?? "—"}
                          {!row.importable ? (
                            <span className="ml-1 text-[color:var(--c-fg-faint)]">
                              (skip: {row.skipReason})
                            </span>
                          ) : null}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {fmtNum(row.quantity)}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {fmtMoney(row.price)}
                        </td>
                        <td className="px-2 py-1 text-right">
                          {fmtMoney(row.statedValue)}
                        </td>
                        <td
                          className={cn(
                            "px-2 py-1 text-right",
                            row.status === "mismatch" &&
                              "text-[color:var(--c-warn)]",
                          )}
                        >
                          {row.status === "ok"
                            ? "✓"
                            : row.status === "mismatch"
                              ? `≠ ${fmtMoney(row.computedValue)}`
                              : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {mapping !== null && mapping.skipped.length > 0 ? (
                <p className="font-mono text-[10px] text-[color:var(--c-fg-faint)]">
                  Skipped rows are not imported:{" "}
                  {mapping.skipped
                    .map((s) => `${s.ticker ?? `row ${s.rowNumber}`} (${s.reason})`)
                    .join("; ")}
                  .
                </p>
              ) : null}
            </div>
          ) : null}

          {mode === "replace-account" && phase === "review" ? (
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
            Confirm import{" "}
            {recon !== null && recon.importableCount > 0
              ? recon.importableCount
              : ""}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
