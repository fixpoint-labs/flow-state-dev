/**
 * Which coding harnesses can run on this machine, as one *Harnesses* pill: a
 * status dot and name per harness (green ready, amber not ready, grey for a
 * check that got no answer), a *Sign in* on one that can't run that shows what
 * to do, and a refresh icon that reads them again.
 *
 * Teammates' own drawing of the rows harness-manager's readiness view answers.
 * The registry's chips (`flow-state/harness-readiness.tsx`, a byte copy) stay
 * as they are; this takes the same rows and the same `recheck`.
 */
import { RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import type { HarnessReadinessChipRow, HarnessReadinessProps } from "./flow-state/harness-readiness";

/** Where a harness's dot sits on the scale: ready, not ready, or no answer to the check. */
const DOT = { true: "bg-success", false: "bg-warning", unknown: "bg-presence-idle" } as const;

/** One harness in the pill: its dot and name, and for one that can't run, a Sign in that shows what to do. */
function HarnessEntry({ row }: { row: HarnessReadinessChipRow }) {
  const [shown, setShown] = useState(false);
  const state = row.ready ? "true" : row.unanswered ? "unknown" : "false";
  const why = [row.reason, row.remedy].filter(Boolean).join(". ");
  return (
    <span
      data-harness={row.harness}
      data-ready={state}
      title={row.ready ? `${row.label} is ready` : row.unanswered ? `${row.label}: the check got no answer` : why}
      className="relative inline-flex items-center gap-1.5 px-2 text-xs"
    >
      <span aria-hidden className={["size-1.5 shrink-0 rounded-full", DOT[state]].join(" ")} />
      <span className="text-foreground">{row.label}</span>
      {/* The remedy stays in the text for a screen reader; Sign in shows it to everyone else. */}
      {row.ready ? null : <span className="sr-only">: {why || (row.unanswered ? "the check got no answer" : "not ready")}</span>}
      {row.ready || row.unanswered || why === "" ? null : (
        <button type="button" aria-expanded={shown} onClick={() => setShown((v) => !v)} className={LINK}>
          Sign in
        </button>
      )}
      {shown ? (
        <span role="note" className="absolute top-full left-0 z-20 mt-1.5 w-max max-w-72 rounded-sm border border-border-strong bg-popover px-2.5 py-1.5 text-xs text-text-2 shadow-lg">
          {why}
        </span>
      ) : null}
    </span>
  );
}

const LINK = "rounded-sm font-medium text-brand hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const ICON_BUTTON =
  "ml-0.5 inline-flex size-6 items-center justify-center rounded-sm text-text-3 hover:bg-surface-raised hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** The pill: *Harnesses*, then each harness with a thin divider between, then Re-check as a refresh icon. */
export function HarnessesPill({ rows, recheck, className }: HarnessReadinessProps) {
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
    <div className={["flex flex-wrap items-center gap-2", className].filter(Boolean).join(" ")}>
      <div role="group" aria-label="Coding harnesses" className="inline-flex h-7 items-center rounded-sm border border-border bg-surface pl-2.5 pr-1">
        <span className="pr-1 text-xs text-text-3">Harnesses</span>
        {rows === undefined ? (
          <span className="px-2 text-xs text-text-2">Checking…</span>
        ) : (
          rows.map((row, i) => (
            <span key={row.harness} className="inline-flex items-center">
              {i === 0 ? null : <span aria-hidden className="h-3 w-px bg-border-strong" />}
              <HarnessEntry row={row} />
            </span>
          ))
        )}
        {recheck === undefined ? null : (
          <button type="button" aria-label="Re-check harnesses" title="Re-check harnesses" className={ICON_BUTTON} disabled={busy || rows === undefined} onClick={() => void press()}>
            <RefreshCwIcon aria-hidden className={["size-3.5", busy ? "animate-spin" : ""].join(" ")} />
          </button>
        )}
      </div>
      {error === undefined ? null : (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
