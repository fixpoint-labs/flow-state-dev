/**
 * ResolveSplitDialog — the one-click "resolve an inconsistent (over-sold)
 * holding" affordance (FIX-876). Opened from a ⚠ REVIEW holding row, whose
 * ledger over-sells because a stock split's pre/post-split trades live in
 * mismatched units. It pre-fills a DETECTED split ratio + date (the pure
 * `inferSplit` heuristic — price-cliff → snapped standard ratio, verified to
 * resolve the over-sell) and shows a LIVE preview of the position the ledger
 * WOULD derive once the split is recorded (`previewSplitResult`) — the "verify
 * the amount before you confirm" gate the user asked for. Editing the ratio or
 * date re-previews immediately; confirming records the split through the same
 * manual-ledger POST path as `AddTransactionDialog`, and the flagged row
 * self-heals on the parent's refetch.
 *
 * Detection is a heuristic (documented in `inferSplit`): a sparse or very
 * volatile history may not auto-detect, so the ratio/date stay editable and the
 * confirm button is gated on a candidate that actually resolves the position —
 * a ratio that leaves the over-sell can't be confirmed (it wouldn't heal the
 * row). Pure presentational + local draft state; the parent owns the ledger and
 * the write.
 */
"use client";

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { cn } from "@/lib/utils";
import type { LedgerRow } from "@/src/domain/portfolio/schema/ledger-schema";
import type { Quote } from "@/src/domain/portfolio/services/get-quotes";
import { inferSplit, previewSplitResult } from "@/src/domain/portfolio/math/lots";
import type { NewLedgerEvent } from "./add-transaction-dialog";
import { DASH, formatMoney, formatQuantity } from "./portfolio-format";

type ResolveSplitDialogProps = {
  open: boolean;
  onClose: () => void;
  /** The over-sold ticker being resolved (upper-case). */
  ticker: string;
  /** The account the flagged holding lives in — the split is recorded here. */
  accountId: string;
  currency: string;
  /** This account's ledger rows (for detection + the dry-run preview). Passing
   *  the whole account is fine — `deriveLots` derives each ticker independently. */
  events: LedgerRow[];
  /** Live quote for the ticker, if fetched — used only to show a market value
   *  in the preview. Absent → value shows "—" (no fabricated number). */
  quote?: Quote;
  /** Record the split. Parent POSTs to the ledger + refetches (self-heals the row). */
  onConfirm: (event: NewLedgerEvent) => void;
};

const inputClass = cn(
  "h-7 w-full rounded-md border bg-[color:var(--c-surface-2)] px-2",
  "border-[color:var(--c-border)] font-mono text-[12px] text-[color:var(--c-fg)]",
  "focus:outline-none focus:border-[color:var(--c-accent)]",
);

const labelTextClass =
  "font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]";

export function ResolveSplitDialog({
  open,
  onClose,
  ticker,
  accountId,
  currency,
  events,
  quote,
  onConfirm,
}: ResolveSplitDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [numerator, setNumerator] = useState("");
  const [denominator, setDenominator] = useState("1");
  const [tradeDate, setTradeDate] = useState("");

  // The auto-detected best guess (pure). Recomputed only when the inputs change,
  // so the draft-reset effect below picks it up on open.
  const detected = useMemo(
    () => (open ? inferSplit(events, ticker) : null),
    [open, events, ticker],
  );

  // Pre-fill the draft from the detection on each open (or blank when nothing was
  // detected — the user enters the ratio by hand, still previewed live).
  useEffect(() => {
    if (!open) return;
    setNumerator(detected ? String(detected.numerator) : "");
    setDenominator(detected ? String(detected.denominator) : "1");
    setTradeDate(detected ? detected.tradeDate : "");
  }, [open, detected]);

  // Drive the native <dialog> imperatively from `open` (the app's dialog idiom).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // The current candidate split, or null when the draft isn't a valid ratio+date.
  const candidate = useMemo(() => {
    const num = Number(numerator.trim());
    const den = Number(denominator.trim());
    if (!Number.isInteger(num) || num <= 0) return null;
    if (!Number.isInteger(den) || den <= 0) return null;
    if (tradeDate.trim().length === 0) return null;
    return { numerator: num, denominator: den, tradeDate: tradeDate.trim() };
  }, [numerator, denominator, tradeDate]);

  // The position the ledger WOULD derive with this split recorded — the live
  // "verify the amount" preview. Null when the candidate still leaves the
  // over-sell (the ratio is too small), which also gates the confirm button.
  const preview = useMemo(
    () => (candidate ? previewSplitResult(events, ticker, candidate) : null),
    [candidate, events, ticker],
  );

  const previewValue =
    preview && quote?.price != null ? preview.quantity * quote.price : null;

  const handleConfirm = (): void => {
    if (!candidate || !preview) return;
    onConfirm({
      accountId,
      type: "split",
      tradeDate: candidate.tradeDate,
      amount: 0,
      ticker,
      quantity: null,
      unitPrice: null,
      description: "Split (resolved from inconsistent history)",
      basisUnknown: null,
      attributes: { numerator: candidate.numerator, denominator: candidate.denominator },
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
        "w-[min(460px,calc(100vw-32px))]",
      )}
    >
      <div className="flex flex-col">
        <header className="flex items-center justify-between border-b border-[color:var(--c-border)] px-4 py-3">
          <h2 className="text-sm font-semibold">Resolve split · {ticker}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs hover:bg-[color:var(--c-surface-2)]"
            aria-label="Close resolve split"
          >
            ✕
          </button>
        </header>

        <div className="space-y-3 px-4 py-4">
          <p className="text-[11px] leading-relaxed text-[color:var(--c-fg-muted)]">
            {ticker}&apos;s transactions over-sell — its sells exceed everything ever
            held, the signature of an unrecorded stock split. Recording the split
            rebases the pre-split lots so the position reconciles.{" "}
            {detected ? (
              <span className="text-[color:var(--c-fg)]">
                A {detected.numerator}-for-{detected.denominator} split was detected
                from the price history — verify the resulting position below before
                confirming.
              </span>
            ) : (
              <span className="text-[color:var(--c-warn)]">
                Couldn&apos;t auto-detect the ratio from the price history — enter it
                below (the preview updates as you type).
              </span>
            )}
          </p>

          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelTextClass}>New shares (numerator)</span>
              <input
                value={numerator}
                onChange={(e) => setNumerator(e.currentTarget.value)}
                className={inputClass}
                placeholder="10"
                inputMode="numeric"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelTextClass}>Per (denominator)</span>
              <input
                value={denominator}
                onChange={(e) => setDenominator(e.currentTarget.value)}
                className={inputClass}
                placeholder="1"
                inputMode="numeric"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelTextClass}>Split date</span>
              <input
                type="date"
                value={tradeDate}
                onChange={(e) => setTradeDate(e.currentTarget.value)}
                className={inputClass}
              />
            </label>
          </div>

          {/* The post-calculation preview: the position the ledger derives once
              this split is recorded. This is what the user verifies. */}
          <div className="rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-surface-2)] px-3 py-2">
            <p className={cn(labelTextClass, "mb-1.5")}>Resulting position</p>
            {candidate === null ? (
              <p className="text-[11px] text-[color:var(--c-fg-muted)]">
                Enter a positive whole-number ratio and a date to preview.
              </p>
            ) : preview === null ? (
              <p className="text-[11px] text-[color:var(--c-warn)]">
                ⚠ This ratio still leaves the position over-sold — it won&apos;t
                resolve the history. Try a larger ratio.
              </p>
            ) : (
              <dl className="grid grid-cols-3 gap-x-4">
                <PreviewStat label="Shares" value={formatQuantity(preview.quantity)} />
                <PreviewStat
                  label="Avg cost"
                  value={preview.avgCost === null ? DASH : formatMoney(preview.avgCost, currency)}
                />
                <PreviewStat
                  label="Market value"
                  value={previewValue === null ? DASH : formatMoney(previewValue, currency)}
                />
              </dl>
            )}
          </div>
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
            onClick={handleConfirm}
            disabled={preview === null}
            className={cn(
              "rounded px-3 py-1 text-xs font-medium text-white",
              preview === null
                ? "cursor-not-allowed bg-[color:var(--c-accent)] opacity-50"
                : "bg-[color:var(--c-accent)] hover:opacity-90",
            )}
            title={
              preview === null
                ? "Enter a ratio that resolves the over-sell to confirm"
                : "Record this split"
            }
          >
            Record split
          </button>
        </footer>
      </div>
    </dialog>
  );
}

/** One label/value pair in the resulting-position preview grid. */
function PreviewStat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="font-mono text-[9px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
        {label}
      </dt>
      <dd className="font-mono text-[13px] tabular-nums text-[color:var(--c-fg)]">
        {value}
      </dd>
    </div>
  );
}
