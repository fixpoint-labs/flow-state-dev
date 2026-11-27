/**
 * Which coding harnesses can run on this machine, as the list the header's
 * *N of M harnesses* control opens: a status dot, name and state per harness
 * (green ready, red not ready, grey for a check that got no answer), a *How
 * to fix* on one that can't run that shows what to do, and Re-check, which
 * reads them again.
 *
 * Teammates' own drawing of the rows harness-manager's readiness view answers.
 * The registry's chips (`flow-state/harness-readiness.tsx`, a byte copy) stay
 * as they are; this takes the same rows and the same `recheck`.
 */
import { RefreshCwIcon } from "lucide-react";
import { Popover } from "radix-ui";
import { useState } from "react";
import { HARNESS_DOT, HARNESS_STATUS_WORDS, harnessState } from "../lib/harness";
import type { HarnessReadinessChipRow, HarnessReadinessProps } from "./flow-state/harness-readiness";

/** The `data-ready` value each state is marked with. */
const READY_MARK = { ready: "true", "not-ready": "false", unknown: "unknown" } as const;

/** One harness in the pill: its dot and name, and for one that can't run, a How to fix that shows what to do. It is named for what it does: it shows the remedy, it signs in to nothing. */
function HarnessEntry({ row }: { row: HarnessReadinessChipRow }) {
  const state = harnessState(row);
  const why = [row.reason, row.remedy].filter(Boolean).join(". ");
  return (
    <span
      data-harness={row.harness}
      data-ready={READY_MARK[state]}
      title={row.ready ? `${row.label} is ready` : row.unanswered ? `${row.label}: the check got no answer` : why}
      className="relative flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
    >
      <span aria-hidden className={["size-1.5 shrink-0 rounded-full", HARNESS_DOT[state]].join(" ")} />
      <span className="text-foreground">{row.label}</span>
      <span aria-hidden className="ml-auto text-text-3">
        {HARNESS_STATUS_WORDS[state]}
      </span>
      {/* The remedy stays in the text for a screen reader; How to fix shows it to everyone else. */}
      {row.ready ? null : <span className="sr-only">: {why || (row.unanswered ? "the check got no answer" : "not ready")}</span>}
      {/* A popover: How to fix again, Escape, or a click outside closes it, and focus goes back to How to fix. */}
      {row.ready || row.unanswered || why === "" ? null : (
        <Popover.Root>
          <Popover.Trigger className={LINK}>How to fix</Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              side="bottom"
              align="start"
              sideOffset={6}
              aria-label={`How to fix ${row.label}`}
              className="z-50 w-max max-w-72 rounded-sm border border-border-strong bg-popover px-2.5 py-1.5 text-xs text-text-2 shadow-lg"
            >
              {why}
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </span>
  );
}

const LINK = "rounded-sm font-medium text-brand hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";
const RECHECK =
  "mt-1 flex w-full items-center gap-2 rounded-md border-t border-border px-2 py-1.5 text-xs text-text-2 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring";

/** The list: each harness on its own line, then Re-check. */
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
    <div className={["flex flex-col", className].filter(Boolean).join(" ")}>
      <div role="group" aria-label="Coding harnesses" className="flex flex-col">
        {rows === undefined ? (
          <span className="px-2 py-1.5 text-xs text-text-2">Checking…</span>
        ) : (
          rows.map((row) => <HarnessEntry key={row.harness} row={row} />)
        )}
        {recheck === undefined ? null : (
          <button type="button" aria-label="Re-check harnesses" className={RECHECK} disabled={busy || rows === undefined} onClick={() => void press()}>
            <RefreshCwIcon aria-hidden className={["size-3.5", busy ? "animate-spin" : ""].join(" ")} />
            Re-check
          </button>
        )}
      </div>
      {error === undefined ? null : (
        <span role="alert" className="px-2 py-1 text-xs text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
