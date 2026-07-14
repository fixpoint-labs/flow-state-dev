/**
 * TaxProfileDialog — native `<dialog class="td-sheet">` editor for the
 * household's tax profile (FIX-874): filing status, marginal ordinary rate,
 * long-term capital-gains rate, and an optional flat state rate.
 *
 * Mirrors `AddTransactionDialog`'s native-`<dialog>` idiom (imperative
 * open/close from `open`, the `td-sheet` bottom-sheet class, the shared field
 * styling). Unlike the ledger dialogs it owns its own write: on save it PUTs
 * `/api/portfolio/tax-profile` and calls `onSaved` so the parent refetches the
 * estimate. Rates are validated 0–100 client-side (the same bound the route's
 * zod schema enforces) so an invalid save surfaces inline instead of a silent
 * 400.
 */
"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { cn } from "@/lib/utils";
import { apiMutate } from "@/lib/use-api-query";
import type { TaxProfileRow } from "@/src/db/repository";
import type { FilingStatus } from "@/src/domain/portfolio/schema/tax-schema";

type TaxProfileDialogProps = {
  open: boolean;
  onClose: () => void;
  /** Household key the profile is saved under. */
  userId: string;
  /** The existing profile, or null for a first-time setup. Pre-fills. */
  profile: TaxProfileRow | null;
  /** Called after a successful save. Parent refetches the tax read. */
  onSaved: () => void;
};

const FILING_STATUS_OPTIONS: ReadonlyArray<{ value: FilingStatus; label: string }> = [
  { value: "single", label: "Single" },
  { value: "mfj", label: "Married filing jointly" },
  { value: "hoh", label: "Head of household" },
  { value: "mfs", label: "Married filing separately" },
];

const inputClass = cn(
  "h-7 w-full rounded-md border bg-[color:var(--c-surface-2)] px-2",
  "border-[color:var(--c-border)] font-mono text-[12px] text-[color:var(--c-fg)]",
  "focus:outline-none focus:border-[color:var(--c-accent)]",
);

const labelTextClass =
  "font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]";

/** Parse a required rate string as a percent in 0..100; returns a message on a
 *  bad value. Blank counts as missing for a required field. */
function parseRequiredRate(raw: string, label: string): { value: number } | { error: string } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { error: `${label} is required` };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { error: `${label} must be a number` };
  if (n < 0 || n > 100) return { error: `${label} must be between 0 and 100` };
  return { value: n };
}

export function TaxProfileDialog({
  open,
  onClose,
  userId,
  profile,
  onSaved,
}: TaxProfileDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [filingStatus, setFilingStatus] = useState<FilingStatus>("single");
  const [ordinaryRate, setOrdinaryRate] = useState("");
  const [ltcgRate, setLtcgRate] = useState("");
  const [stateRate, setStateRate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Drive the native <dialog> imperatively from `open` (matches the other dialogs).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Reset/pre-fill the draft on each open so a prior cancel doesn't leak stale
  // text, and an edit pre-fills from the existing profile.
  useEffect(() => {
    if (open) {
      setFilingStatus(profile?.filingStatus ?? "single");
      setOrdinaryRate(profile ? String(profile.marginalOrdinaryRatePct) : "");
      setLtcgRate(profile ? String(profile.ltcgRatePct) : "");
      setStateRate(
        profile?.stateRatePct != null ? String(profile.stateRatePct) : "",
      );
      setError(null);
      setSaving(false);
    }
  }, [open, profile]);

  const handleSave = async (): Promise<void> => {
    const ordinary = parseRequiredRate(ordinaryRate, "Marginal ordinary rate");
    if ("error" in ordinary) {
      setError(ordinary.error);
      return;
    }
    const ltcg = parseRequiredRate(ltcgRate, "Long-term capital-gains rate");
    if ("error" in ltcg) {
      setError(ltcg.error);
      return;
    }
    // State rate is optional — blank → null (federal-only), otherwise validated.
    let stateRatePct: number | null = null;
    const trimmedState = stateRate.trim();
    if (trimmedState.length > 0) {
      const n = Number(trimmedState);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        setError("State rate must be between 0 and 100");
        return;
      }
      stateRatePct = n;
    }

    setSaving(true);
    setError(null);
    try {
      await apiMutate("/api/portfolio/tax-profile", "PUT", {
        userId,
        filingStatus,
        marginalOrdinaryRatePct: ordinary.value,
        ltcgRatePct: ltcg.value,
        stateRatePct,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save tax profile");
      setSaving(false);
    }
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
          <h2 className="text-sm font-semibold">Tax profile</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs hover:bg-[color:var(--c-surface-2)]"
            aria-label="Close tax profile"
          >
            ✕
          </button>
        </header>

        <div className="space-y-3 px-4 py-4">
          <label className="flex flex-col gap-1">
            <span className={labelTextClass}>Filing status</span>
            <select
              value={filingStatus}
              onChange={(e) => setFilingStatus(e.currentTarget.value as FilingStatus)}
              className={inputClass}
            >
              {FILING_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelTextClass}>
              Marginal ordinary rate % (short-term gains + interest)
            </span>
            <input
              value={ordinaryRate}
              onChange={(e) => setOrdinaryRate(e.currentTarget.value)}
              className={inputClass}
              placeholder="32"
              inputMode="decimal"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelTextClass}>
              Long-term capital-gains rate % (long-term gains + qualified dividends)
            </span>
            <input
              value={ltcgRate}
              onChange={(e) => setLtcgRate(e.currentTarget.value)}
              className={inputClass}
              placeholder="15"
              inputMode="decimal"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelTextClass}>State rate % (optional)</span>
            <input
              value={stateRate}
              onChange={(e) => setStateRate(e.currentTarget.value)}
              className={inputClass}
              placeholder="Leave blank for federal-only"
              inputMode="decimal"
            />
          </label>

          {error !== null ? (
            <p role="alert" className="text-[10.5px] text-[color:var(--c-warn)]">
              ⚠ {error}
            </p>
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
            onClick={() => void handleSave()}
            disabled={saving}
            className={cn(
              "rounded px-3 py-1 text-xs font-medium text-white",
              saving
                ? "cursor-not-allowed bg-[color:var(--c-accent)] opacity-50"
                : "bg-[color:var(--c-accent)] hover:opacity-90",
            )}
          >
            {saving ? "Saving…" : "Save profile"}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
