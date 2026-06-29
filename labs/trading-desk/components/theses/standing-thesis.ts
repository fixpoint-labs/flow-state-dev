/**
 * Pure view-model builder for the report's standing-thesis card (FIX-760).
 *
 * The report's PM hero shows the standing thesis for the analyzed ticker when one
 * exists (recorded via "Adopt as thesis" or hand-written in the portfolio view).
 * This is the load-bearing mapping — picking the household's thesis for a ticker
 * out of the list and shaping it for display — extracted into a tested pure
 * function (the `aggregate.ts` / `lens-card` precedent: logic in node-testable
 * helpers, the component only renders).
 *
 * Real-money discipline: missing optional fields stay null so the card omits them
 * (the `—`-for-missing gate), never a fabricated value. "Recorded as of" is the
 * record's `updatedAt`, surfaced so a stale thesis reads as such.
 */
import type { ThesisRecord, Tripwire } from "@/src/flows/portfolio/thesis-schema";

/** Render-ready standing-thesis view model, or `null` when the household has no
 *  thesis for the ticker (the card omits cleanly). */
export type StandingThesisModel = {
  ticker: string;
  entryRationale: string;
  invalidationConditions: string | null;
  timeHorizon: string | null;
  tripwires: ReadonlyArray<Tripwire>;
  /** The record's `updatedAt` ISO timestamp — the "recorded as of" line. */
  recordedAsOf: string;
  /** Whether this thesis was adopted from an analysis report (has a source). */
  fromReport: boolean;
};

/**
 * Find the household's thesis for `ticker` (case-insensitive household × ticker
 * key) and shape it for the card. Returns `null` when no ticker is known, or
 * when no thesis exists for it — the consumer omits the card in that case.
 */
export function buildStandingThesisModel(
  ticker: string | null,
  theses: ReadonlyArray<ThesisRecord>,
): StandingThesisModel | null {
  if (ticker === null || ticker.trim() === "") return null;
  const upper = ticker.trim().toUpperCase();
  const record = theses.find((t) => t.ticker.toUpperCase() === upper);
  if (record === undefined) return null;
  return {
    ticker: record.ticker.toUpperCase(),
    entryRationale: record.entryRationale,
    invalidationConditions: record.invalidationConditions,
    timeHorizon: record.timeHorizon,
    tripwires: record.tripwires,
    recordedAsOf: record.updatedAt,
    fromReport: record.sourceSessionId !== null,
  };
}
