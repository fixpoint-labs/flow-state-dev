/**
 * ImportMenu — a small dropdown grouping the three portfolio import paths
 * (holdings CSV, statement PDF, transaction file) under one "Import" button, so
 * the Accounts action bar isn't a row of near-identical buttons (FIX-885
 * follow-up). Not a general menu primitive — the app has none and three items
 * don't warrant one (BP-038); this is scoped to the import trio.
 *
 * Opens on click, closes on item select, outside pointer-down, or Escape. Items
 * are plain buttons (native keyboard reachability); the PDF item can be disabled
 * on its own (it needs a session for the AI extraction pass) while CSV and the
 * transaction import stay enabled.
 */
"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { ChevronDown, FileText, FileUp, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

type ImportMenuProps = {
  /** No accounts yet — the whole menu is disabled (nothing to import into). */
  disabled: boolean;
  /** PDF import needs a bound session; when false, only that item is disabled. */
  pdfEnabled: boolean;
  onImportCsv: () => void;
  onImportPdf: () => void;
  onImportTransactions: () => void;
};

const triggerClass =
  "inline-flex h-7 items-center gap-1 rounded-md border border-[color:var(--c-border)] px-2.5 text-[11.5px] font-medium";

const itemClass =
  "flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11.5px] hover:bg-[color:var(--c-surface-2)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";

export function ImportMenu({
  disabled,
  pdfEnabled,
  onImportCsv,
  onImportPdf,
  onImportTransactions,
}: ImportMenuProps): ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on an outside pointer-down or Escape. Bound only while open — no
  // listener churn when the menu is closed (the common case).
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function choose(action: () => void) {
    setOpen(false);
    action();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        title={disabled ? "Add an account first" : "Import holdings or transactions"}
        className={cn(
          triggerClass,
          disabled
            ? "cursor-not-allowed opacity-50"
            : "hover:bg-[color:var(--c-surface-2)]",
        )}
      >
        <Upload className="h-3 w-3" aria-hidden /> Import
        <ChevronDown className="h-3 w-3 text-[color:var(--c-fg-faint)]" aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute left-0 z-20 mt-1 w-52 overflow-hidden rounded-md border border-[color:var(--c-border)] bg-[color:var(--c-surface)] py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => choose(onImportCsv)}
            className={itemClass}
          >
            <Upload className="h-3 w-3" aria-hidden /> Holdings CSV
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!pdfEnabled}
            title={
              pdfEnabled
                ? "Import holdings from a statement PDF"
                : "PDF import uses an AI extraction pass — run an analysis first to start a session"
            }
            onClick={() => choose(onImportPdf)}
            className={itemClass}
          >
            <FileText className="h-3 w-3" aria-hidden /> Statement PDF
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => choose(onImportTransactions)}
            className={itemClass}
          >
            <FileUp className="h-3 w-3" aria-hidden /> Transaction file (OFX/QFX/QBO)
          </button>
        </div>
      ) : null}
    </div>
  );
}
