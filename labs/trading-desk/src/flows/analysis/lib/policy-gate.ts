/**
 * The pure, deterministic portfolio-mandate size gate (FIX-761).
 *
 * Extracted into `lib/` (not inlined as a ninth job in the ~403-line PM
 * `writer.ts`) following that file's own `clampRatingToBand`-in-`lib/`
 * precedent — so the clamp matrix is unit-testable in isolation and the writer
 * boundary just applies the returned weight + echo.
 *
 * What it enforces (the two single-name HARD clamps; min-cash + allocation drift
 * are ADVISORY — surfaced to the PM as context, never clamped here):
 *   - EXCLUSION — the analyzed name is on the mandate's exclusion list: a hard
 *     no-add to the current household position (`min(target, householdWeight)`).
 *   - MAX POSITION WEIGHT — an AT-PURCHASE cap: never force a TRIM of an
 *     already-over-cap holding (the single-ticker run can't rebalance), so the cap
 *     floors at the household weight (`max(cap, householdWeight)`).
 *
 * UNITS: everything is PERCENTAGE POINTS 0..100 (matching `targetWeightPct` and
 * `weightPct`). `householdWeightPct` is the analyzed ticker's weight in the FULL
 * book (frozen at seed from the pre-scoping accounts), NOT the scoped
 * `currentWeightPct` — a household cap is a household reference.
 *
 * REAL-MONEY DISCIPLINE: `householdWeightPct` is `null` when a held name can't be
 * priced. NEVER coerce that to 0 — a `?? 0` would turn an exclusion's no-add into
 * a fabricated full EXIT and a cap floor into a forced trim (a real-money
 * violation, BP-020). On the null branch the gate clamps nothing, reports
 * `householdWeightKnown: false`, and leaves the PM to narrate that the cap
 * couldn't be enforced without a price.
 *
 * All effects are downward-only — the gate never inflates size and never touches
 * the rating (the FIX-715 / FIX-752 orthogonality).
 *
 * Pure leaf (BP-019): imports only the mandate schema TYPE, no runtime.
 */
import type { PortfolioMandate } from "../../portfolio/portfolio-mandate-schema";

/** The single-name policy outcome for the analyzed ticker. `unenforced` means a
 *  hard constraint (a position cap) applied but could NOT be evaluated because
 *  the held name's household weight was unknown (unpriced) — so the run makes NO
 *  claim of compliance (never a false "within-policy"). */
export type PolicyVerdict =
  | "within-policy"
  | "capped"
  | "excluded"
  | "unenforced"
  | "no-mandate";

export type PolicyGateInput = {
  /** The frozen, validated household mandate, or null on a mandate-blind run. */
  mandate: PortfolioMandate | null;
  /** The analyzed ticker (canonicalized here for the exclusion match). */
  ticker: string;
  /** The size entering the gate (percentage points) — after the FIX-752 clamp. */
  targetWeightPct: number;
  /** The analyzed ticker's HOUSEHOLD weight (pct points): 0 = not held, a
   *  positive number = held+priced, null = held but unpriced (unknown). */
  householdWeightPct: number | null;
};

export type PolicyGateResult = {
  /** The (possibly downward-clamped) target weight. */
  targetWeightPct: number;
  /** The analyzed name is on the exclusion list. */
  excluded: boolean;
  /** The size was reduced to the `maxPositionWeightPct` cap floor. */
  positionCapClamped: boolean;
  /** The single-name verdict for the echo + snapshot + run summary. */
  policyVerdict: PolicyVerdict;
  /** False when a held name couldn't be priced, so the clamp was SKIPPED (not
   *  satisfied) — the writer boundary distinguishes the two. */
  householdWeightKnown: boolean;
};

/**
 * Compute the deterministic single-name policy gate for the analyzed ticker.
 * Downward-only; never throws; idempotent.
 */
export function computePolicyGate(input: PolicyGateInput): PolicyGateResult {
  const { mandate, ticker, householdWeightPct } = input;
  const present = mandate != null && typeof mandate.createdAt === "string";

  // No mandate → no clamp, no verdict beyond "no-mandate".
  if (!present) {
    return {
      targetWeightPct: input.targetWeightPct,
      excluded: false,
      positionCapClamped: false,
      policyVerdict: "no-mandate",
      householdWeightKnown: householdWeightPct != null,
    };
  }

  const tickerUpper = ticker.trim().toUpperCase();
  // Exclusions are canonicalized at write, but a fixture/manual record may not be
  // — canonicalize both sides so the hard gate can't miss on casing/whitespace.
  const excluded = mandate.constraints.exclusions.some(
    (e) => e.trim().toUpperCase() === tickerUpper,
  );
  const cap = mandate.constraints.maxPositionWeightPct; // a HOUSEHOLD cap

  // Held-but-unpriced → the household weight is UNKNOWN: clamp nothing (never
  // fabricate a weight), flag it. The verdict still reflects the exclusion (a
  // no-add is a stance, not a number). But an unevaluated CAP must NOT read as
  // "within-policy" — that would advertise compliance the run never checked. Use
  // "unenforced" so the memo / run summary are honest; "within-policy" is
  // reserved for the no-hard-constraint case.
  if (householdWeightPct == null) {
    const policyVerdict: PolicyVerdict = excluded
      ? "excluded"
      : cap != null
        ? "unenforced"
        : "within-policy";
    return {
      targetWeightPct: input.targetWeightPct,
      excluded,
      positionCapClamped: false,
      policyVerdict,
      householdWeightKnown: false,
    };
  }

  // AT-PURCHASE cap: never force a trim of an already-over-cap hold — floor the
  // cap at the household weight.
  const capFloor = cap != null ? Math.max(cap, householdWeightPct) : null;
  // Exclusion (a full no-add) SUBSUMES the cap — don't also flag a cap clamp on an
  // excluded run (the echo would double-report). Gate the cap flag on !excluded.
  const positionCapClamped =
    !excluded && capFloor != null && input.targetWeightPct > capFloor;

  let targetWeightPct = input.targetWeightPct;
  if (excluded) {
    // No-add to the current household position.
    targetWeightPct = Math.min(targetWeightPct, householdWeightPct);
  }
  if (capFloor != null) {
    // No-add beyond the cap floor.
    targetWeightPct = Math.min(targetWeightPct, capFloor);
  }

  const policyVerdict: PolicyVerdict = excluded
    ? "excluded"
    : positionCapClamped
      ? "capped"
      : "within-policy";

  return {
    targetWeightPct,
    excluded,
    positionCapClamped,
    policyVerdict,
    householdWeightKnown: true,
  };
}
