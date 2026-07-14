/**
 * MandateDialog — native `<dialog class="td-sheet">` editor for the household's
 * durable portfolio mandate (IPS, FIX-761): objectives (risk tolerance + optional
 * return target), a target-allocation editor (add/remove asset-class rows with an
 * optional min/max corridor), standing constraints (max position weight, minimum
 * cash, exclusions), the rebalancing band, the risk-appetite override, and the
 * time horizon.
 *
 * Mirrors `ThesisDialog`'s native-`<dialog>` idiom (imperative open/close, the
 * `td-sheet` bottom-sheet class, the shared field styling). The load-bearing
 * mapping (record → form, form → `savePortfolioMandate` payload, client-side
 * validation) lives in the tested pure helpers in `mandate-form.ts`; this
 * component only holds raw input state and renders. The parent owns the dispatch.
 */
"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  MandateAssetClass,
  PortfolioMandate,
  RiskTolerance,
} from "@/domain/portfolio/schema/portfolio-mandate-schema";
import {
  APPETITE_OPTIONS,
  ASSET_CLASS_OPTIONS,
  buildSaveMandatePayload,
  emptyMandateForm,
  mandateFormError,
  mandateRecordToForm,
  type AllocationRowDraft,
  type MandateFormState,
  type MandateSavePayload,
} from "./mandate-form";

type MandateDialogProps = {
  open: boolean;
  onClose: () => void;
  /** The existing mandate, or null for a new one. Pre-fills. */
  existing: PortfolioMandate | null;
  /** Persist the mandate. Parent dispatches `savePortfolioMandate`. */
  onSave: (payload: MandateSavePayload) => void;
  /** Clear the mandate. Parent dispatches `clearPortfolioMandate`. Offered only
   *  when an existing mandate is being edited. */
  onClear: () => void;
};

const TOLERANCE_OPTIONS: ReadonlyArray<{ value: RiskTolerance; label: string }> = [
  { value: "conservative", label: "Conservative" },
  { value: "moderate", label: "Moderate" },
  { value: "aggressive", label: "Aggressive" },
];

const inputClass = cn(
  "h-7 w-full rounded-md border bg-[color:var(--c-surface-2)] px-2",
  "border-[color:var(--c-border)] font-mono text-[12px] text-[color:var(--c-fg)]",
  "focus:outline-none focus:border-[color:var(--c-accent)]",
);
const labelTextClass =
  "font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]";

export function MandateDialog({
  open,
  onClose,
  existing,
  onSave,
  onClear,
}: MandateDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [form, setForm] = useState<MandateFormState>(emptyMandateForm());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (open) {
      setForm(existing !== null ? mandateRecordToForm(existing) : emptyMandateForm());
      setError(null);
    }
  }, [open, existing]);

  const set = <K extends keyof MandateFormState>(key: K, value: MandateFormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const updateRow = (index: number, patch: Partial<AllocationRowDraft>) =>
    setForm((prev) => ({
      ...prev,
      targetAllocation: prev.targetAllocation.map((r, i) =>
        i === index ? { ...r, ...patch } : r,
      ),
    }));

  const addRow = () =>
    setForm((prev) => {
      // Offer the first asset class not yet used, so a fresh row rarely collides.
      const used = new Set(prev.targetAllocation.map((r) => r.assetClass));
      const next = ASSET_CLASS_OPTIONS.find((c) => !used.has(c)) ?? "equity";
      return {
        ...prev,
        targetAllocation: [
          ...prev.targetAllocation,
          { assetClass: next, targetPct: "", minPct: "", maxPct: "" },
        ],
      };
    });

  const removeRow = (index: number) =>
    setForm((prev) => ({
      ...prev,
      targetAllocation: prev.targetAllocation.filter((_, i) => i !== index),
    }));

  const handleSave = (): void => {
    const validationError = mandateFormError(form);
    if (validationError !== null) {
      setError(validationError);
      return;
    }
    onSave(buildSaveMandatePayload(form));
    onClose();
  };

  const handleClear = (): void => {
    onClear();
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
        "w-[min(560px,calc(100vw-32px))]",
      )}
    >
      <div className="flex flex-col">
        <header className="flex items-center justify-between border-b border-[color:var(--c-border)] px-4 py-3">
          <h2 className="text-sm font-semibold">
            {existing !== null ? "Edit portfolio mandate" : "Set portfolio mandate"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs hover:bg-[color:var(--c-surface-2)]"
            aria-label="Close mandate editor"
          >
            ✕
          </button>
        </header>

        <div className="max-h-[62svh] space-y-4 overflow-y-auto px-4 py-4">
          <label className="flex flex-col gap-1">
            <span className={labelTextClass}>Label</span>
            <input
              value={form.label}
              onChange={(e) => set("label", e.currentTarget.value)}
              className={inputClass}
              placeholder="Household IPS 2026"
            />
          </label>

          {/* Objectives */}
          <fieldset className="flex flex-col gap-2 rounded-md border border-[color:var(--c-border)] p-3">
            <legend className={labelTextClass}>Objectives</legend>
            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1">
                <span className={labelTextClass}>Risk tolerance</span>
                <select
                  value={form.riskTolerance}
                  onChange={(e) =>
                    set("riskTolerance", e.currentTarget.value as RiskTolerance)
                  }
                  className={inputClass}
                >
                  {TOLERANCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className={labelTextClass}>Return target %</span>
                <input
                  value={form.returnTargetPct}
                  onChange={(e) => set("returnTargetPct", e.currentTarget.value)}
                  className={inputClass}
                  placeholder="7"
                  inputMode="decimal"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className={labelTextClass}>Basis</span>
                <select
                  value={form.returnBasis}
                  onChange={(e) =>
                    set("returnBasis", e.currentTarget.value as MandateFormState["returnBasis"])
                  }
                  className={inputClass}
                >
                  <option value="">—</option>
                  <option value="nominal">Nominal</option>
                  <option value="real">Real</option>
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className={labelTextClass}>Risk-appetite override</span>
              <select
                value={form.riskAppetite}
                onChange={(e) => set("riskAppetite", e.currentTarget.value)}
                className={inputClass}
              >
                {APPETITE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          {/* Target allocation */}
          <fieldset className="flex flex-col gap-2 rounded-md border border-[color:var(--c-border)] p-3">
            <div className="flex items-center justify-between">
              <legend className={labelTextClass}>Target allocation</legend>
              <button
                type="button"
                onClick={addRow}
                className="inline-flex items-center gap-1 rounded-md border border-[color:var(--c-border)] px-2 py-0.5 text-[10.5px] hover:bg-[color:var(--c-surface-2)]"
              >
                <Plus className="h-3 w-3" aria-hidden /> Add class
              </button>
            </div>
            {form.targetAllocation.length === 0 ? (
              <p className="text-[10.5px] text-[color:var(--c-fg-faint)]">
                No target allocation. Add asset-class targets (equity, fixed income,
                cash…). With no explicit cash bucket, the remainder to 100% is the
                implicit cash target.
              </p>
            ) : (
              form.targetAllocation.map((r, i) => (
                <div
                  key={i}
                  className="flex flex-wrap items-end gap-2 rounded-md border border-[color:var(--c-border)] p-2"
                >
                  <label className="flex w-32 flex-col gap-1">
                    <span className={labelTextClass}>Asset class</span>
                    <select
                      value={r.assetClass}
                      onChange={(e) =>
                        updateRow(i, { assetClass: e.currentTarget.value as MandateAssetClass })
                      }
                      className={inputClass}
                    >
                      {ASSET_CLASS_OPTIONS.map((c) => (
                        <option key={c} value={c}>
                          {c.replace(/_/g, " ")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex w-20 flex-col gap-1">
                    <span className={labelTextClass}>Target %</span>
                    <input
                      value={r.targetPct}
                      onChange={(e) => updateRow(i, { targetPct: e.currentTarget.value })}
                      className={inputClass}
                      placeholder="60"
                      inputMode="decimal"
                    />
                  </label>
                  <label className="flex w-16 flex-col gap-1">
                    <span className={labelTextClass}>Min %</span>
                    <input
                      value={r.minPct}
                      onChange={(e) => updateRow(i, { minPct: e.currentTarget.value })}
                      className={inputClass}
                      placeholder="—"
                      inputMode="decimal"
                    />
                  </label>
                  <label className="flex w-16 flex-col gap-1">
                    <span className={labelTextClass}>Max %</span>
                    <input
                      value={r.maxPct}
                      onChange={(e) => updateRow(i, { maxPct: e.currentTarget.value })}
                      className={inputClass}
                      placeholder="—"
                      inputMode="decimal"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => removeRow(i)}
                    className="rounded p-1.5 text-[color:var(--c-fg-faint)] hover:bg-[color:var(--c-surface-2)] hover:text-[color:var(--c-warn)]"
                    aria-label="Remove allocation row"
                    title="Remove allocation row"
                  >
                    <Trash2 className="h-3 w-3" aria-hidden />
                  </button>
                </div>
              ))
            )}
            <div className="flex items-end gap-3">
              <label className="flex w-32 flex-col gap-1">
                <span className={labelTextClass}>Rebalancing band</span>
                <select
                  value={form.bandType}
                  onChange={(e) =>
                    set("bandType", e.currentTarget.value as MandateFormState["bandType"])
                  }
                  className={inputClass}
                >
                  <option value="relative">Relative (% of target)</option>
                  <option value="absolute">Absolute (pp)</option>
                </select>
              </label>
              <label className="flex w-24 flex-col gap-1">
                <span className={labelTextClass}>
                  {form.bandType === "relative" ? "Width (0–1)" : "Width (pp)"}
                </span>
                <input
                  value={form.bandWidthPct}
                  onChange={(e) => set("bandWidthPct", e.currentTarget.value)}
                  className={inputClass}
                  placeholder={form.bandType === "relative" ? "0.2" : "5"}
                  inputMode="decimal"
                />
              </label>
            </div>
          </fieldset>

          {/* Constraints */}
          <fieldset className="flex flex-col gap-2 rounded-md border border-[color:var(--c-border)] p-3">
            <legend className={labelTextClass}>Standing constraints</legend>
            <div className="flex gap-3">
              <label className="flex flex-1 flex-col gap-1">
                <span className={labelTextClass}>Max position %</span>
                <input
                  value={form.maxPositionWeightPct}
                  onChange={(e) => set("maxPositionWeightPct", e.currentTarget.value)}
                  className={inputClass}
                  placeholder="5"
                  inputMode="decimal"
                />
              </label>
              <label className="flex flex-1 flex-col gap-1">
                <span className={labelTextClass}>Min cash %</span>
                <input
                  value={form.minCashPct}
                  onChange={(e) => set("minCashPct", e.currentTarget.value)}
                  className={inputClass}
                  placeholder="10"
                  inputMode="decimal"
                />
              </label>
            </div>
            <label className="flex flex-col gap-1">
              <span className={labelTextClass}>Exclusions (never add)</span>
              <input
                value={form.exclusions}
                onChange={(e) => set("exclusions", e.currentTarget.value)}
                className={inputClass}
                placeholder="NVDA, TSLA"
                autoComplete="off"
              />
            </label>
          </fieldset>

          {/* Horizon */}
          <label className="flex w-40 flex-col gap-1">
            <span className={labelTextClass}>Time horizon (years)</span>
            <input
              value={form.horizonYears}
              onChange={(e) => set("horizonYears", e.currentTarget.value)}
              className={inputClass}
              placeholder="10"
              inputMode="decimal"
            />
          </label>

          <p className="text-[10.5px] text-[color:var(--c-fg-faint)]">
            A documented, user-set policy — not financial advice. The max-position
            cap and exclusions are enforced at analysis time; the target allocation
            and minimum cash are advisory context for the desk.
          </p>
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
              onClick={handleClear}
              className="rounded border border-[color:var(--c-warn)]/40 px-3 py-1 text-xs text-[color:var(--c-warn)] hover:bg-[color:var(--c-warn)]/10"
            >
              Clear mandate
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
              className="rounded bg-[color:var(--c-accent)] px-3 py-1 text-xs font-medium text-white hover:opacity-90"
            >
              {existing !== null ? "Save mandate" : "Set mandate"}
            </button>
          </div>
        </footer>
      </div>
    </dialog>
  );
}
