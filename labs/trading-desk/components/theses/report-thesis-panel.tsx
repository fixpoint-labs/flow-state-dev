/**
 * ReportThesisPanel — the report's per-position thesis affordances (FIX-760):
 * an "Adopt as thesis" button on a finished report, and a standing-thesis card
 * when the household already has a thesis for the analyzed ticker.
 *
 * Reads the household theses via `useTheses` (the same read hook the portfolio
 * pane uses) filtered to the report's ticker through the pure
 * `buildStandingThesisModel`. Dispatches `adoptThesis` (input `{}`, derive-only)
 * on the ANALYSIS session — the action reads that session's stored decision
 * snapshot and writes the thesis with the report link. After adopting it refetches
 * and shows an inline "Adopted ✓" confirmation.
 *
 * The button only renders on a finished report (`runComplete` — the same gate the
 * Summary uses); a stopped / in-progress run has no decision to adopt. The
 * standing-thesis card omits cleanly when no thesis exists.
 */
"use client";

import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { NotebookPen } from "lucide-react";
import type { SessionView } from "@flow-state-dev/react";
import { useTheses } from "@/components/portfolio/use-theses";
import { cn } from "@/lib/utils";
import { buildStandingThesisModel } from "./standing-thesis";

type ReportThesisPanelProps = {
  session: SessionView;
  /** The analyzed ticker (from the PM memo), or null when not yet known. */
  ticker: string | null;
  /** Whether the report is finished (the adopt gate — no decision before then). */
  runComplete: boolean;
};

export function ReportThesisPanel({
  session,
  ticker,
  runComplete,
}: ReportThesisPanelProps): ReactElement | null {
  const { theses, loading, refetch } = useTheses(session);
  const [adopting, setAdopting] = useState(false);
  const [adopted, setAdopted] = useState(false);

  // Reset the "Adopted ✓" confirmation whenever the target report changes
  // (the pane swaps session/ticker without remounting this panel), so a stale
  // confirmation from a previous ticker can't leak into a new, un-adopted one.
  useEffect(() => {
    setAdopted(false);
  }, [ticker, session]);

  const standing = useMemo(
    () => buildStandingThesisModel(ticker, theses),
    [ticker, theses],
  );

  const handleAdopt = useCallback(async () => {
    setAdopting(true);
    try {
      // Derive-only: the action reads the stored decision snapshot — no input.
      await session.sendAction("adoptThesis", {});
      // sendAction resolves before the write commits; refetch for the new record.
      refetch();
      setAdopted(true);
    } catch (err) {
      console.error("[trading-desk] adoptThesis failed", err);
    } finally {
      setAdopting(false);
    }
  }, [session, refetch]);

  // Adoption needs the theses read to have landed (`loading === false`), so a
  // user can't click Adopt before an existing standing thesis is known and
  // overwrite it on a slow `/api/portfolio/theses` response. Until then, treat
  // adoption as unavailable.
  const canAdopt = runComplete && !loading;

  // Nothing to show yet: no standing thesis to display AND adoption unavailable
  // (run not finished, or the theses read still in flight).
  if (standing === null && !canAdopt) return null;

  return (
    <section
      className={cn(
        "flex flex-col gap-2 rounded-md border p-3",
        "border-[color:var(--c-border)] bg-[color:var(--c-surface)]",
      )}
      aria-label="Position thesis"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
          position thesis
        </span>
        {canAdopt ? (
          adopted ? (
            <span className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-live)]">
              Adopted ✓
            </span>
          ) : (
            <button
              type="button"
              onClick={() => void handleAdopt()}
              disabled={adopting}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] font-medium",
                "border-[color:var(--c-border)]",
                adopting
                  ? "cursor-not-allowed opacity-50"
                  : "hover:bg-[color:var(--c-surface-2)]",
              )}
              title="Record this decision as the standing thesis for the position"
            >
              <NotebookPen className="h-3 w-3" aria-hidden />
              {standing !== null ? "Re-adopt as thesis" : "Adopt as thesis"}
            </button>
          )
        ) : null}
      </div>

      {standing !== null ? (
        <dl className="flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            <dt className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
              entry rationale
            </dt>
            <dd className="text-[12.5px] leading-snug text-[color:var(--c-fg)]">
              {standing.entryRationale}
            </dd>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11.5px] text-[color:var(--c-fg-muted)]">
            <span>
              <span className="font-mono uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                horizon
              </span>{" "}
              {standing.timeHorizon ?? "—"}
            </span>
          </div>

          {standing.invalidationConditions !== null ? (
            <div className="flex flex-col gap-0.5">
              <dt className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                invalidation
              </dt>
              <dd className="text-[12px] leading-snug text-[color:var(--c-fg-muted)]">
                {standing.invalidationConditions}
              </dd>
            </div>
          ) : null}

          {standing.tripwires.length > 0 ? (
            <div className="flex flex-col gap-0.5">
              <dt className="font-mono text-[9.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                tripwires
              </dt>
              <dd>
                <ul className="ml-3 list-disc text-[12px] leading-relaxed text-[color:var(--c-fg-muted)]">
                  {standing.tripwires.map((t, i) => (
                    <li key={i}>
                      <span className="font-mono text-[10.5px] uppercase tracking-wider text-[color:var(--c-fg-faint)]">
                        {t.kind}
                      </span>{" "}
                      {t.note}
                      {t.level !== null ? ` @ ${t.level}` : ""}
                      {t.byDate !== null ? ` by ${t.byDate}` : ""}
                    </li>
                  ))}
                </ul>
              </dd>
            </div>
          ) : null}

          <p className="text-[10px] text-[color:var(--c-fg-faint)]">
            Recorded as of {standing.recordedAsOf.slice(0, 10)}
            {standing.fromReport ? " · adopted from an analysis report" : ""}. Edit
            in the Portfolio view.
          </p>
        </dl>
      ) : null}
    </section>
  );
}
