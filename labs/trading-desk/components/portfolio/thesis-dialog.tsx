/**
 * ThesisDialog — native `<dialog class="td-sheet">` editor for one position's
 * standing thesis (FIX-760): entry rationale (required), invalidation
 * conditions, time horizon, target/stop price, and a minimal tripwire editor
 * (add/remove rows of {kind, note, level, byDate}).
 *
 * Mirrors `AddTransactionDialog`'s native-`<dialog>` idiom (imperative open/close
 * from `open`, the `td-sheet` bottom-sheet class, the shared field styling). The
 * load-bearing mapping (record → form, form → `saveThesis` payload) lives in the
 * tested pure helpers in `thesis-form.ts`; this component only holds raw input
 * state and renders. On save it calls the parent's `onSave` with the payload; on
 * delete it calls `onDelete`. The parent owns the action dispatch + refetch.
 *
 * Save is disabled while the entry rationale is empty (the one client gate — a
 * thesis with no "why" is meaningless; the server re-validates the rest).
 */
"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  ThesisInputFields,
  ThesisRecord,
  TimeHorizon,
  TripwireKind,
} from "@/domain/portfolio/schema/thesis-schema";
import {
  buildSaveThesisPayload,
  canSaveThesis,
  emptyThesisForm,
  thesisFormError,
  thesisRecordToForm,
  type ThesisFormState,
  type TripwireDraft,
} from "./thesis-form";

type ThesisDialogProps = {
  open: boolean;
  onClose: () => void;
  /** The holding the thesis is for (household × ticker key). */
  ticker: string;
  /** The existing thesis for this ticker, or null for a new one. Pre-fills. */
  existing: ThesisRecord | null;
  /** Persist the thesis. Parent dispatches `saveThesis` + refetches. */
  onSave: (payload: ThesisInputFields) => void;
  /** Delete the thesis. Parent dispatches `deleteThesis` + refetches. Only
   *  offered when an existing thesis is being edited. */
  onDelete: (ticker: string) => void;
};

const HORIZON_OPTIONS: ReadonlyArray<{ value: TimeHorizon; label: string }> = [
  { value: "days", label: "Days" },
  { value: "weeks", label: "Weeks" },
  { value: "months", label: "Months" },
  { value: "quarters", label: "Quarters" },
  { value: "years", label: "Years" },
];

const TRIPWIRE_KIND_OPTIONS: ReadonlyArray<{ value: TripwireKind; label: string }> = [
  { value: "price", label: "Price" },
  { value: "event", label: "Event" },
  { value: "date", label: "Date" },
];

const inputClass = cn(
  "h-7 w-full rounded-md border bg-[color:var(--c-surface-2)] px-2",
  "border-[color:var(--c-border)] font-mono text-[12px] text-[color:var(--c-fg)]",
  "focus:outline-none focus:border-[color:var(--c-accent)]",
);

const textareaClass = cn(
  "w-full rounded-md border bg-[color:var(--c-surface-2)] px-2 py-1.5",
  "border-[color:var(--c-border)] text-[12px] text-[color:var(--c-fg)]",
  "focus:outline-none focus:border-[color:var(--c-accent)]",
);

const labelTextClass =
  "font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]";

export function ThesisDialog({
  open,
  onClose,
  ticker,
  existing,
  onSave,
  onDelete,
}: ThesisDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<ThesisFormState>(emptyThesisForm());
  // Server-schema validation error surfaced on a save attempt (a nonpositive
  // price, >20 tripwires) — keeps the editor open so the draft isn't lost.
  const [error, setError] = useState<string | null>(null);

  // Drive the native <dialog> imperatively from `open` (matches the other dialogs).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Reset/pre-fill the draft on each open so a prior cancel doesn't leak stale
  // text, and an edit pre-fills from the existing record. Also clears any prior
  // validation error so a fresh open never opens showing a stale message.
  useEffect(() => {
    if (open) {
      setForm(existing !== null ? thesisRecordToForm(existing) : emptyThesisForm());
      setError(null);
    }
  }, [open, existing]);

  const set = <K extends keyof ThesisFormState>(key: K, value: ThesisFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const updateTripwire = (index: number, patch: Partial<TripwireDraft>) =>
    setForm((prev) => ({
      ...prev,
      tripwires: prev.tripwires.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    }));

  const addTripwire = () =>
    setForm((prev) => ({
      ...prev,
      tripwires: [...prev.tripwires, { kind: "price", note: "", level: "", byDate: "" }],
    }));

  const removeTripwire = (index: number) =>
    setForm((prev) => ({
      ...prev,
      tripwires: prev.tripwires.filter((_, i) => i !== index),
    }));

  const canSave = canSaveThesis(form);

  const handleSave = (): void => {
    if (!canSave) return;
    const sourceSessionId = existing?.sourceSessionId ?? null;
    // Validate client-side against the same schema the action re-validates. A
    // dispatch resolves at stream-attach, before a server rejection surfaces, so
    // an invalid save would close the editor and silently drop the draft; block
    // here and keep the dialog open with the reason instead.
    const validationError = thesisFormError(ticker, form, sourceSessionId);
    if (validationError !== null) {
      setError(validationError);
      return;
    }
    // Carry the existing report link through an edit so a Portfolio edit of an
    // adopted thesis doesn't erase its originating `sourceSessionId`.
    onSave(buildSaveThesisPayload(ticker, form, sourceSessionId));
    onClose();
  };

  const handleDelete = (): void => {
    onDelete(ticker.trim().toUpperCase());
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
        "w-[min(480px,calc(100vw-32px))]",
      )}
    >
      <div className="flex flex-col">
        <header className="flex items-center justify-between border-b border-[color:var(--c-border)] px-4 py-3">
          <h2 className="text-sm font-semibold">
            {existing !== null ? "Edit thesis" : "Add thesis"} ·{" "}
            <span className="font-mono">{ticker.toUpperCase()}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs hover:bg-[color:var(--c-surface-2)]"
            aria-label="Close thesis editor"
          >
            ✕
          </button>
        </header>

        <div className="max-h-[60svh] space-y-3 overflow-y-auto px-4 py-4">
          <label className="flex flex-col gap-1">
            <span className={labelTextClass}>Entry rationale (required)</span>
            <textarea
              value={form.entryRationale}
              onChange={(e) => set("entryRationale", e.currentTarget.value)}
              className={textareaClass}
              rows={3}
              placeholder="Why you hold this position — the thesis."
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelTextClass}>Invalidation conditions (optional)</span>
            <textarea
              value={form.invalidationConditions}
              onChange={(e) => set("invalidationConditions", e.currentTarget.value)}
              className={textareaClass}
              rows={2}
              placeholder="What would prove this wrong."
            />
          </label>

          <div className="flex gap-3">
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelTextClass}>Time horizon</span>
              <select
                value={form.timeHorizon}
                onChange={(e) =>
                  set("timeHorizon", e.currentTarget.value as TimeHorizon | "")
                }
                className={inputClass}
              >
                <option value="">—</option>
                {HORIZON_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelTextClass}>Target price</span>
              <input
                value={form.targetPrice}
                onChange={(e) => set("targetPrice", e.currentTarget.value)}
                className={inputClass}
                placeholder="200"
                inputMode="decimal"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className={labelTextClass}>Stop price</span>
              <input
                value={form.stopPrice}
                onChange={(e) => set("stopPrice", e.currentTarget.value)}
                className={inputClass}
                placeholder="90"
                inputMode="decimal"
              />
            </label>
          </div>

          {/* Tripwire editor: the optional structured falsifiers (a price level,
              a dated event) the review loop can check mechanically. A note-less
              row is dropped on save (see thesis-form.ts). */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className={labelTextClass}>Tripwires (optional)</span>
              <button
                type="button"
                onClick={addTripwire}
                className="inline-flex items-center gap-1 rounded-md border border-[color:var(--c-border)] px-2 py-0.5 text-[10.5px] hover:bg-[color:var(--c-surface-2)]"
              >
                <Plus className="h-3 w-3" aria-hidden /> Add tripwire
              </button>
            </div>
            {form.tripwires.length === 0 ? (
              <p className="text-[10.5px] text-[color:var(--c-fg-faint)]">
                No tripwires. Add an observable falsifier (a price level or a
                dated event) the review loop can check.
              </p>
            ) : (
              form.tripwires.map((t, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-end gap-2 rounded-md border border-[color:var(--c-border)] p-2"
                >
                  <label className="flex w-20 flex-col gap-1">
                    <span className={labelTextClass}>Kind</span>
                    <select
                      value={t.kind}
                      onChange={(e) =>
                        updateTripwire(i, {
                          kind: e.currentTarget.value as TripwireKind,
                        })
                      }
                      className={inputClass}
                    >
                      {TRIPWIRE_KIND_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex min-w-[120px] flex-1 flex-col gap-1">
                    <span className={labelTextClass}>Note</span>
                    <input
                      value={t.note}
                      onChange={(e) => updateTripwire(i, { note: e.currentTarget.value })}
                      className={inputClass}
                      placeholder="Q3 ARPU prints below $8"
                      autoComplete="off"
                    />
                  </label>
                  <label className="flex w-24 flex-col gap-1">
                    <span className={labelTextClass}>Level</span>
                    <input
                      value={t.level}
                      onChange={(e) => updateTripwire(i, { level: e.currentTarget.value })}
                      className={inputClass}
                      placeholder="90"
                      inputMode="decimal"
                    />
                  </label>
                  <label className="flex w-32 flex-col gap-1">
                    <span className={labelTextClass}>By date</span>
                    <input
                      type="date"
                      value={t.byDate}
                      onChange={(e) => updateTripwire(i, { byDate: e.currentTarget.value })}
                      className={inputClass}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => removeTripwire(i)}
                    className="rounded p-1.5 text-[color:var(--c-fg-faint)] hover:bg-[color:var(--c-surface-2)] hover:text-[color:var(--c-warn)]"
                    aria-label="Remove tripwire"
                    title="Remove tripwire"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {error !== null ? (
          <p
            role="alert"
            className="border-t border-[color:var(--c-warn)]/40 bg-[color:var(--c-warn)]/10 px-4 py-2 text-[11px] text-[color:var(--c-warn)]"
          >
            {error}
          </p>
        ) : null}

        <footer className="flex items-center gap-2 border-t border-[color:var(--c-border)] px-4 py-3">
          {existing !== null ? (
            <button
              type="button"
              onClick={handleDelete}
              className="rounded border border-[color:var(--c-warn)]/40 px-3 py-1 text-xs text-[color:var(--c-warn)] hover:bg-[color:var(--c-warn)]/10"
            >
              Delete
            </button>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-[color:var(--c-border)] px-3 py-1 text-xs hover:bg-[color:var(--c-surface-2)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className={cn(
                "rounded px-3 py-1 text-xs font-medium text-white",
                canSave
                  ? "bg-[color:var(--c-accent)] hover:opacity-90"
                  : "cursor-not-allowed bg-[color:var(--c-accent)] opacity-50",
              )}
            >
              {existing !== null ? "Save thesis" : "Add thesis"}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
