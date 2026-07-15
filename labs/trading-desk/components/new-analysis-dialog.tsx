/**
 * NewAnalysisDialog — native `<dialog>` that owns the entire run-input surface:
 * ticker, date, cost preset, data source, and the two optional thesis fields.
 *
 * Controlled and stateless about persistence: the parent (`TradingDeskApp`)
 * owns every field value + change handler because it derives the session tuple,
 * the matched session, and the active-session sync off them. The dialog only
 * adds local client-side validation (non-empty ticker, `YYYY-MM-DD` date) and a
 * disabled "Portfolio (coming soon)" mount point reserved for a later slice. On
 * a valid submit it calls the parent's `onSubmit` (the existing `handleRun`
 * resolve-or-create + `pendingDispatch` handshake) and closes — it never
 * reimplements the dispatch.
 *
 * The sub-20-char thesis gate is authoritative server-side in `seedSession`; the
 * dialog only surfaces a UX hint about the threshold. A sub-threshold thesis is
 * treated as no thesis (Phase 6 skipped + `userThesisWarning` surfaced by the
 * status bar), unchanged by this component.
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
import type { CostPreset, DataSourceMode } from "@/components/topbar";
import {
  MANDATE_PACK,
  type RiskMandateId,
} from "@/flows/analysis/lib/risk-mandate";
import { cn } from "@/lib/utils";

/** Cost-preset toggle options. Lives here because the dialog is now the only
 *  consumer (moved out of `topbar.tsx` when the inline form was removed). */
const COST_PRESET_OPTIONS = [
  { value: "fast" as const, label: "fast", title: "Cheap utility models" },
  { value: "full" as const, label: "full", title: "Higher-tier chat models" },
];

/** Data-source toggle options. Single consumer — see `COST_PRESET_OPTIONS`. */
const DATA_SOURCE_OPTIONS = [  
  {
    value: "live" as const,
    label: "live",
    title:
      "Live data — Yahoo for prices/fundamentals (no key); FINNHUB_API_KEY required for news",
  },
  {
    value: "record" as const,
    label: "live + record",
    title:
      "Live data, and write every tool response to the fixture corpus so this run can be replayed offline (needs the live API keys)",
  },
  { value: "fixture" as const, label: "fixture", title: "Hand-curated JSON" },
];

/** The minimum thesis length the server treats as auditable. Mirrors the
 *  `seedSession` gate purely for the UX hint; the server stays authoritative. */
const THESIS_MIN_CHARS = 20;

/** Inline, modal-local validation errors. Single consumer — kept here (no lift,
 *  BP-018 / simplicity rule). Mirrors the server schema's hard requirements
 *  plus a date-format nicety the schema does not enforce. */
type DraftErrors = {
  ticker?: string;
  date?: string;
};

/** Pure validator for the identity tuple. Block submit on any error. Exported
 *  for the logic-level test (the harness is node-env, no DOM). */
export function validateAnalyzeDraft(draft: {
  ticker: string;
  date: string;
}): DraftErrors {
  const errors: DraftErrors = {};
  if (draft.ticker.trim().length === 0) {
    errors.ticker = "Ticker is required";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
    errors.date = "Use YYYY-MM-DD";
  }
  return errors;
}

type NewAnalysisDialogProps = {
  open: boolean;
  onClose: () => void;

  // Identity tuple (controlled by parent).
  ticker: string;
  date: string;
  costPreset: CostPreset;
  dataSource: DataSourceMode;
  onTickerChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onCostPresetChange: (value: CostPreset) => void;
  onDataSourceChange: (value: DataSourceMode) => void;

  // Optional per-run risk-appetite mandate override (FIX-752). `null` = house
  // default (fall back to the selected accounts' default at seed). A refinement,
  // NOT a tuple field — changing it does not key a new report.
  riskMandate: RiskMandateId | null;
  onRiskMandateChange: (value: RiskMandateId | null) => void;

  // Optional thesis (controlled by parent).
  userThesis: string;
  userThesisRationale: string;
  onUserThesisChange: (value: string) => void;
  onUserThesisRationaleChange: (value: string) => void;

  /** Parent's `handleRun`. The dialog validates, then calls this and closes;
   *  the parent owns the resolve-or-create + dispatch handshake. */
  onSubmit: () => void;
  /** True while the matched session is streaming — labels the submit button. */
  isRunning: boolean;
  /** Whether the current tuple maps to an existing run (Re-run vs Run label). */
  isExistingSession: boolean;
};

/** The New Analysis modal. Mirrors `SettingsDialog`'s native-`<dialog>` idiom
 *  (focus trap, scrim, Escape-to-close driven imperatively from `open`). */
export function NewAnalysisDialog({
  open,
  onClose,
  ticker,
  date,
  costPreset,
  dataSource,
  onTickerChange,
  onDateChange,
  onCostPresetChange,
  onDataSourceChange,
  riskMandate,
  onRiskMandateChange,
  userThesis,
  userThesisRationale,
  onUserThesisChange,
  onUserThesisRationaleChange,
  onSubmit,
  isRunning,
  isExistingSession,
}: NewAnalysisDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Errors are only shown after a submit attempt, so a fresh open doesn't
  // flash "Ticker is required" before the user has touched anything.
  const [errors, setErrors] = useState<DraftErrors>({});

  // Drive the native <dialog> imperatively from the `open` prop. Using a real
  // <dialog> gets us focus trap, scrim, and Escape-to-close for free. Matches
  // SettingsDialog exactly (conformance over taste).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  // Clear stale validation errors when the dialog reopens, so a prior failed
  // attempt's markers don't greet the next open.
  useEffect(() => {
    if (open) setErrors({});
  }, [open]);

  // Derived: in fixture mode the date is recorded but the loader reads the
  // pinned snapshot — surface that honestly rather than implying a fetch.
  const fixtureDateNote = useMemo(
    () => dataSource === "fixture",
    [dataSource],
  );

  const handleSubmit = (): void => {
    const next = validateAnalyzeDraft({ ticker, date });
    if (next.ticker !== undefined || next.date !== undefined) {
      setErrors(next);
      return;
    }
    setErrors({});
    onSubmit();
    onClose();
  };

  const submitLabel = isRunning
    ? "running…"
    : isExistingSession
      ? "Re-run analysis"
      : "Run analysis";

  const inputClass = cn(
    "h-7 rounded-md border bg-[color:var(--c-surface-2)] px-2",
    "border-[color:var(--c-border)] font-mono text-[12px] text-[color:var(--c-fg)]",
    "focus:outline-none focus:border-[color:var(--c-accent)]",
  );
  const textareaClass = cn(
    "w-full resize-none rounded-md border bg-[color:var(--c-surface-2)] px-2.5 py-1.5",
    "border-[color:var(--c-border)] text-[12px] text-[color:var(--c-fg)]",
    "focus:outline-none focus:border-[color:var(--c-accent)]",
  );

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
        <header
          className={cn(
            "flex items-center justify-between border-b px-4 py-3",
            "border-[color:var(--c-border)]",
          )}
        >
          <div>
            <h2 className="text-sm font-semibold">New analysis</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-[color:var(--c-fg-muted)]">
              Configure a run. Sessions are keyed by ticker · date · preset ·
              source — re-running the same four resolves the existing report
              instead of creating a new one.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "rounded px-2 py-1 text-xs",
              "hover:bg-[color:var(--c-surface-2)]",
            )}
            aria-label="Close new analysis"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div className="flex gap-4">
            <label className="flex flex-1 flex-col gap-1">
              <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                Ticker
              </span>
              <input
                value={ticker}
                onChange={(e) =>
                  onTickerChange(e.currentTarget.value.toUpperCase())
                }
                className={inputClass}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={errors.ticker !== undefined}
              />
              {errors.ticker !== undefined ? (
                <span className="text-[10.5px] text-[color:var(--c-warn)]">
                  ⚠ {errors.ticker}
                </span>
              ) : null}
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                Date
              </span>
              <input
                value={date}
                onChange={(e) => onDateChange(e.currentTarget.value)}
                className={inputClass}
                spellCheck={false}
                autoComplete="off"
                placeholder="YYYY-MM-DD"
                aria-invalid={errors.date !== undefined}
              />
              {errors.date !== undefined ? (
                <span className="text-[10.5px] text-[color:var(--c-warn)]">
                  ⚠ {errors.date}
                </span>
              ) : fixtureDateNote ? (
                <span className="text-[10.5px] text-[color:var(--c-fg-muted)]">
                  Fixture mode uses the pinned snapshot; date is recorded but
                  not fetched.
                </span>
              ) : null}
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <Segmented
              label="preset"
              value={costPreset}
              options={COST_PRESET_OPTIONS}
              onChange={onCostPresetChange}
            />
            <Segmented
              label="source"
              value={dataSource}
              options={DATA_SOURCE_OPTIONS}
              onChange={onDataSourceChange}
            />
          </div>

          {/* Risk-appetite mandate override (FIX-752). "Default (house)" → null,
              which falls back to the selected accounts' default at seed; an
              explicit pick overrides it for this run only. Not a tuple field —
              re-running with a different mandate refines the same report. */}
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
              Risk mandate
            </span>
            <select
              value={riskMandate ?? "__default"}
              onChange={(e) => {
                const v = e.currentTarget.value;
                onRiskMandateChange(v === "__default" ? null : (v as RiskMandateId));
              }}
              className={inputClass}
              aria-label="Risk-appetite mandate"
            >
              <option value="__default">Default (house)</option>
              {MANDATE_PACK.map((m) => (
                <option key={m.id} value={m.id} title={m.description}>
                  {m.label}
                </option>
              ))}
            </select>
            <span className="text-[10.5px] leading-relaxed text-[color:var(--c-fg-muted)]">
              The variable risk standard the PM sizes against. Default falls back
              to your account's mandate; the run is mandate-blind if none is set.
            </span>
          </label>

          {/* Portfolio (coming soon) — a reserved, visibly-disabled mount point
              for the later Portfolio slice. No logic, no state, no scoping. */}
          <fieldset
            disabled
            aria-label="Portfolio (coming soon)"
            className={cn(
              "rounded-lg border border-dashed p-3 opacity-60",
              "border-[color:var(--c-border)] bg-[color:var(--c-surface-2)]",
            )}
          >
            <legend className="px-1 font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
              Portfolio (coming soon)
            </legend>
            <p className="text-[11px] leading-relaxed text-[color:var(--c-fg-muted)]">
              Run against portfolio: account / holdings selection lands here in a
              later release. Disabled placeholder — no run is scoped to a
              portfolio yet.
            </p>
          </fieldset>

          <div className="flex flex-col gap-3 border-t border-[color:var(--c-border)] pt-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-[12px] font-semibold text-[color:var(--c-fg)]">
                Your thesis (optional)
              </span>
              <span className="text-[10.5px] leading-relaxed text-[color:var(--c-fg-muted)]">
                We analyze the ticker blind to this, then test our findings
                against it. ≥ {THESIS_MIN_CHARS} chars to run the thesis audit
                (Phase 6).
              </span>
            </div>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                Thesis
              </span>
              <textarea
                value={userThesis}
                onChange={(e) => onUserThesisChange(e.currentTarget.value)}
                rows={3}
                maxLength={1500}
                placeholder="e.g. NVDA's data-center growth decelerates faster than consensus expects in H2"
                className={textareaClass}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                Why (optional)
              </span>
              <textarea
                value={userThesisRationale}
                onChange={(e) =>
                  onUserThesisRationaleChange(e.currentTarget.value)
                }
                rows={2}
                maxLength={1500}
                placeholder="What's the reasoning behind it?"
                className={textareaClass}
              />
            </label>
          </div>
        </div>

        <footer
          className={cn(
            "flex items-center justify-end gap-2 border-t px-4 py-3",
            "border-[color:var(--c-border)]",
          )}
        >
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "rounded border px-3 py-1 text-xs",
              "border-[color:var(--c-border)]",
              "hover:bg-[color:var(--c-surface-2)]",
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isRunning}
            className={cn(
              "rounded px-3 py-1 text-xs font-medium",
              "bg-[color:var(--c-accent)] text-white",
              "hover:opacity-90 disabled:opacity-50",
            )}
          >
            {submitLabel}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
