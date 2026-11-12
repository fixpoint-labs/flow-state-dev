"use client";

/**
 * Which coding harnesses can run on this machine: one chip per harness,
 * `✓ Cursor`, `✗ Codex` with what to run, `? Claude Code` for a check that got
 * no answer, and a Re-check that reads them again.
 *
 * Takes plain data: the rows harness-manager's readiness view answers
 * (`harnessReadinessView`, one row per harness), and a `recheck` that reads the
 * same view with `{ refresh: true }` and resolves to its rows. While the
 * first read is out, `rows` is `undefined` and the chips say so; a failed
 * Re-check keeps the rows it had and shows the error beside the button.
 */

import { useState } from "react";

/** One harness's readiness, as harness-manager's `HarnessReadinessView` has it. */
export type HarnessReadinessChipRow = {
  harness: string;
  label: string;
  ready: boolean;
  reason: string | null;
  remedy: string | null;
  unanswered: boolean;
};

export interface HarnessReadinessProps {
  /** The rows, or `undefined` while the first read is out. */
  rows: readonly HarnessReadinessChipRow[] | undefined;
  /** Read again with `{ refresh: true }`. Rejects with the action's words. Absent: no Re-check. */
  recheck?: () => Promise<unknown>;
  className?: string;
}

/** What one chip says beside its mark: the label, then the remedy (or the reason when none is named). */
export function readinessChipText(row: HarnessReadinessChipRow): string {
  if (row.ready) return row.label;
  const why = row.remedy ?? row.reason;
  return why === null ? row.label : `${row.label}: ${why}`;
}

const CHIP = "inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 font-mono text-[11px]";
const BUTTON =
  "rounded-md border border-border px-2 py-0.5 text-[11px] hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** The chips and Re-check. */
export function HarnessReadiness({ rows, recheck, className }: HarnessReadinessProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const press = async () => {
    if (recheck === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      await recheck();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div role="group" aria-label="Coding harnesses" className={["flex flex-wrap items-center gap-1.5", className].filter(Boolean).join(" ")}>
      {rows === undefined ? (
        <span className="text-[11px] text-muted-foreground">Checking the coding harnesses…</span>
      ) : (
        rows.map((row) => (
          <span
            key={row.harness}
            data-harness={row.harness}
            data-ready={row.ready ? "true" : row.unanswered ? "unknown" : "false"}
            title={row.ready ? `${row.label} is ready` : [row.reason, row.remedy].filter(Boolean).join(". ")}
            className={[CHIP, row.ready ? "text-success" : row.unanswered ? "text-muted-foreground" : "text-destructive"].join(" ")}
          >
            <span aria-hidden>{row.ready ? "✓" : row.unanswered ? "?" : "✗"}</span>
            <span className="text-foreground">{readinessChipText(row)}</span>
          </span>
        ))
      )}
      {recheck === undefined ? null : (
        <button type="button" className={BUTTON} disabled={busy || rows === undefined} onClick={() => void press()}>
          {busy ? "Checking…" : "Re-check"}
        </button>
      )}
      {error === undefined ? null : (
        <span role="alert" className="text-[11px] text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
