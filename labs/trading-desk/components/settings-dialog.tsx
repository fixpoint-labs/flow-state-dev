/**
 * SettingsDialog — modal for editing the user-scoped special instructions
 * resource (one global block + one per-phase block × 5 phases).
 *
 * Reads the persisted state via `useResource` from the bound session's
 * snapshot and writes via the `setInstructions` flow action. Edits take
 * effect on the next analyze run.
 */
"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { useResource, type SessionView } from "@flow-state-dev/react";
import {
  EMPTY_INSTRUCTIONS,
  FIELD_CHAR_LIMIT,
  type SpecialInstructionsState,
} from "@/src/flows/analysis/special-instructions";
import { cn } from "@/lib/utils";

type SettingsDialogProps = {
  open: boolean;
  onClose: () => void;
  /** A session bound to the same user. `useResource` reads from this
   *  session's snapshot; pass the active or most-recent session. */
  session: SessionView;
};

const PHASES: ReadonlyArray<{
  key: keyof SpecialInstructionsState;
  label: string;
}> = [
  { key: "phase1", label: "Phase 1 — Analysts" },
  { key: "phase2", label: "Phase 2 — Bull / Bear / Manager" },
  { key: "phase3", label: "Phase 3 — Trader" },
  { key: "phase4", label: "Phase 4 — Risk personas" },
  { key: "phase5", label: "Phase 5 — Portfolio manager" },
];

export function SettingsDialog({
  open,
  onClose,
  session,
}: SettingsDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);

  const { clientData } = useResource(session, "specialInstructions");
  const persisted = useMemo<SpecialInstructionsState>(
    () =>
      (clientData as SpecialInstructionsState | null) ?? EMPTY_INSTRUCTIONS,
    [clientData],
  );

  const [draft, setDraft] = useState<SpecialInstructionsState>(persisted);
  const [saving, setSaving] = useState(false);

  // Reset the draft to the persisted state each time the dialog opens so
  // Cancel-then-reopen surfaces saved values, not whatever was last typed.
  useEffect(() => {
    if (open) {
      setDraft(persisted);
      setSaving(false);
    }
  }, [open, persisted]);

  // Drive the native <dialog> imperatively from the `open` prop. Using a
  // real <dialog> gets us focus trap, scrim, and Escape-to-close for free.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  const handleField = (
    key: keyof SpecialInstructionsState,
    value: string,
  ): void => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      await session.sendAction("setInstructions", draft);
      onClose();
    } catch (err) {
      console.error("[trading-desk] failed to save instructions", err);
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
            <h2 className="text-sm font-semibold">Custom instructions</h2>
            <p className="mt-0.5 text-xs text-[color:var(--c-fg-muted)]">
              Free-text guidance applied to every run for this user. Edits take
              effect on the next analysis.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "rounded px-2 py-1 text-xs",
              "hover:bg-[color:var(--c-surface-2)]",
            )}
            aria-label="Close settings"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <InstructionField
            label="Global"
            description="Applies to every phase."
            value={draft.global}
            onChange={(v) => handleField("global", v)}
          />
          {PHASES.map((p) => (
            <InstructionField
              key={p.key}
              label={p.label}
              description={`Applies only when ${p.label.split(" — ")[0]} is active.`}
              value={draft[p.key]}
              onChange={(v) => handleField(p.key, v)}
            />
          ))}
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
            disabled={saving}
            className={cn(
              "rounded border px-3 py-1 text-xs",
              "border-[color:var(--c-border)]",
              "hover:bg-[color:var(--c-surface-2)]",
              "disabled:opacity-50",
            )}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSave();
            }}
            disabled={saving}
            className={cn(
              "rounded px-3 py-1 text-xs",
              "bg-[color:var(--c-accent)] text-[color:var(--c-accent-fg)]",
              "hover:opacity-90 disabled:opacity-50",
            )}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </footer>
      </div>
    </dialog>
  );
}

type InstructionFieldProps = {
  label: string;
  description: string;
  value: string;
  onChange: (next: string) => void;
};

function InstructionField({
  label,
  description,
  value,
  onChange,
}: InstructionFieldProps): ReactElement {
  const nearLimit = value.length >= FIELD_CHAR_LIMIT;

  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium">{label}</span>
        <span
          className={cn(
            "font-mono text-[10.5px]",
            nearLimit
              ? "text-[color:var(--c-warn)]"
              : "text-[color:var(--c-fg-faint)]",
          )}
        >
          {value.length}/{FIELD_CHAR_LIMIT}
        </span>
      </div>
      <p className="mb-1 text-[10.5px] text-[color:var(--c-fg-muted)]">
        {description}
      </p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        maxLength={FIELD_CHAR_LIMIT}
        className={cn(
          "block w-full resize-y rounded border px-2 py-1 font-mono text-xs",
          "border-[color:var(--c-border)] bg-[color:var(--c-bg)]",
          "focus:outline-none focus:ring-1 focus:ring-[color:var(--c-accent)]",
        )}
      />
    </label>
  );
}
