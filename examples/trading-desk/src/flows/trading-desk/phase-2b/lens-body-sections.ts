/**
 * Section headers for the synthesized lens-memo body.
 *
 * SINGLE SOURCE OF TRUTH for the `ThesisSection.h` titles that `lensBody`
 * (`phase-2b/writer.ts`) writes, and that two readers recover by exact-string
 * match: `computeAndStoreConvergence` (same file) and `buildLensCardModel`
 * (`components/theses/lens-card.tsx`). The verdict schema carries no `body`
 * field by design, so the body is the only carrier for `keyDriver` / `dataGap`
 * downstream — and the readers find their sections by header text. Without this
 * shared constant a renamed writer header would make both readers fall back to
 * `""` / `[]` silently, dropping `keyDriver` / `dataGap` from the convergence
 * record and the LensCard with no compile-time or runtime error.
 *
 * Pure leaf (BP-019): no imports, safe for both the server flow and the client card.
 */
export const LENS_BODY_SECTION = {
  verdict: "Verdict",
  keyDriver: "Key driver",
  disqualifier: "What would flip this",
  dataGaps: "Data gaps (honesty)",
} as const;
