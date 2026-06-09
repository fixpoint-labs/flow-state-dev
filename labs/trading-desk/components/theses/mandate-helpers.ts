/**
 * Shared formatting helpers for the risk-appetite mandate UI (FIX-752).
 *
 * One source of truth for the verdict pill color and the signed-percent / dash
 * formatter, used by the shared `MandatePanel` (`components/theses/mandate-panel.tsx`)
 * that both the report view (`pm-hero.tsx`) and the Summary (`report-summary.tsx`)
 * render. Typed on the primitive inputs so it does not couple to the panel's
 * `MandateDecision` view type.
 */

/** Mandate verdict → classification-pill color. `clears` reads positive (live);
 *  `fails` reads cautionary (warn). Mirrors the lens classification-pill idiom. */
export function verdictColor(verdict: "clears" | "fails"): string {
  return verdict === "clears" ? "var(--c-live)" : "var(--c-warn)";
}

/** Format a signed percentage figure, or `—` when the number is absent. The
 *  real-money gate: a missing reward-to-risk input is never fabricated. */
export function pctOrDash(value: number | null, signed = false): string {
  if (value === null) return "—";
  const sign = signed && value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}
