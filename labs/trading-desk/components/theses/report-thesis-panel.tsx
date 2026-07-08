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
  const [adoptAttempted, setAdoptAttempted] = useState(false);
  // The record's `recordedAsOf` (updatedAt) captured at click time, so a re-adopt
  // confirms only once the live record actually advances past it. null when no
  // thesis existed at click (a first adopt).
  const [adoptBaseline, setAdoptBaseline] = useState<string | null>(null);

  // Reset the attempt state whenever the target report changes (the pane swaps
  // session/ticker without remounting this panel), so a stale confirmation from
  // a previous ticker can't leak into a new, un-adopted one. Key on the STABLE
  // `session.sessionId` string, not the `session` object: `useSession` returns a
  // fresh `SessionView` on every snapshot/stream update — and the adopt's own
  // resource/request updates are such updates — so depending on the object would
  // re-run this reset mid-adopt and clear the confirmation that just landed.
  useEffect(() => {
    setAdoptAttempted(false);
    setAdoptBaseline(null);
  }, [ticker, session.sessionId]);

  const standing = useMemo(
    () => buildStandingThesisModel(ticker, theses),
    [ticker, theses],
  );

  // Confirm "Adopted ✓" only once the live record reflects THIS adopt. `sendAction`
  // resolves at stream-attach, before the handler commits and before a
  // no-decision / stale-decision failure surfaces, so an optimistic confirm would
  // show a false success. A first adopt is safe on `standing !== null` alone (there
  // was no record before). A RE-adopt is not: `standing` is already non-null, so we
  // also require the record to be report-derived AND its `recordedAsOf` to have
  // advanced past the value captured at click time — a failed re-adopt leaves the
  // old record (and its timestamp) untouched, so it never confirms.
  const adopted =
    adoptAttempted &&
    standing !== null &&
    standing.fromReport &&
    standing.recordedAsOf !== adoptBaseline;

  const handleAdopt = useCallback(async () => {
    setAdopting(true);
    // Capture the pre-adopt record identity so the confirm above can tell a
    // committed (re-)adopt from a no-op failure that left the old record in place.
    setAdoptBaseline(standing?.recordedAsOf ?? null);
    try {
      // Derive-only: the action reads the stored decision snapshot — no input.
      await session.sendAction("adoptThesis", {});
      // sendAction resolves before the write commits; refetch as a backstop to the
      // live stream. The confirmation gates on the live record advancing.
      refetch();
      setAdoptAttempted(true);
    } catch (err) {
      console.error("[trading-desk] adoptThesis failed", err);
    } finally {
      setAdopting(false);
    }
  }, [session, refetch, standing]);

  // Adoption needs: the run finished (`runComplete` flips only after the PM
  // commits a decision), the theses read to have landed (so an existing thesis is
  // known and not overwritten), and a known `ticker` — when the ticker hasn't
  // loaded, `standing` is forced null and the panel could otherwise offer Adopt
  // for an unknown name, overwriting a thesis it couldn't match.
  const canAdopt = runComplete && !loading && ticker !== null;

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
