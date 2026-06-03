/**
 * Pure assembly of the `analyze` action payload from the four-field identity
 * tuple plus the two optional thesis fields. Browser-safe (zod + types only,
 * no React, no transport) so both the run path in `app/page.tsx` and the
 * node-env test suite can share one definition of "what a run dispatches."
 *
 * The thesis-freeze rule lives here: an all-whitespace or empty thesis (or
 * rationale) becomes `null`. The sub-20-char gate and the
 * null-rationale-when-thesis-null collapse are NOT applied here — both stay
 * authoritative server-side in `seedSession`; this only normalizes empties,
 * exactly as the legacy header-form dispatch did.
 */
import type { AnalyzeInput } from "./flow-schema";

/** The four user-visible inputs that identify one analysis run. */
export type AnalyzeTuple = {
  ticker: string;
  date: string;
  costPreset: "fast" | "full";
  dataSource: "fixture" | "live";
};

/** Build the `analyze` action payload. `ticker`/`date` pass through as-is
 *  (already normalized by the input fields); each thesis field is frozen with
 *  the empty→null rule so a blank textarea never gates Phase 6. The returned
 *  shape is exactly what `session.sendAction("analyze", ...)` dispatches, so the
 *  modal and the legacy header form provably build the same input. */
export function buildAnalyzeInput(
  tuple: AnalyzeTuple,
  rawThesis: string,
  rawRationale: string,
): Pick<
  AnalyzeInput,
  "ticker" | "date" | "costPreset" | "dataSource" | "userThesis" | "userThesisRationale"
> {
  const thesis = rawThesis.trim();
  const rationale = rawRationale.trim();
  return {
    ...tuple,
    userThesis: thesis.length > 0 ? thesis : null,
    userThesisRationale: rationale.length > 0 ? rationale : null,
  };
}
