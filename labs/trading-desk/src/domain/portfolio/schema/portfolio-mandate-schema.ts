/**
 * Pure, browser-safe durable portfolio-mandate (Investment Policy Statement)
 * schema (FIX-761).
 *
 * A *portfolio mandate* is the household's durable statement of intent: what the
 * book is aiming for (objectives), what mix it targets (target allocation over
 * the existing `assetClass` buckets), the standing rules it must respect
 * (constraints), how far it lets things drift before rebalancing (bands), and
 * its time horizon. It is the classic IPS chain — objectives → constraints →
 * target allocation → rebalancing policy — modelled as the structured,
 * machine-usable part (governance prose is out of scope).
 *
 * It is the portfolio-level analog of the per-position thesis (FIX-760): a flat
 * household document — no FK/join/aggregation — so it lives in a user-scoped FSD
 * resource (`portfolioMandateResource`, `portfolio-resources.ts`), NOT a
 * relational table. This leaf is the shared shape the editor validates
 * client-side, the `savePortfolioMandate` action re-validates server-side, and
 * the resource stores as its state (BP-019: imports only `zod`, no
 * `@flow-state-dev/core`, so it stays bundle-safe).
 *
 * The per-run risk-appetite mandate (FIX-752) folds in as the `riskAppetite`
 * FACET — an opaque `MANDATE_PACK` id the analysis flow validates via
 * `resolveMandate` at seed — so there is ONE policy object, not two. Precedence
 * is `run override → account default → IPS household → null` (§4.2), purely
 * additive.
 *
 * These are NOT generator output schemas — `.default()` / `.nullable()` are fine
 * (BP-016 only constrains generator outputs); do not add them to
 * `output-schemas-strict.spec.ts` (the `thesis-schema.ts` / `accountStateSchema`
 * precedent).
 */
import { z } from "zod";

/** The allocation buckets ARE the existing holding asset classes (FIX-773) — so
 *  drift (FIX-762) groups on a field every holding already carries, with no
 *  parallel classification layer. */
export const mandateAssetClassSchema = z.enum([
  "equity",
  "fixed_income",
  "cash",
  "crypto",
  "alternative",
]);
export type MandateAssetClass = z.infer<typeof mandateAssetClassSchema>;

/** The stated objective posture — the retail conservative/moderate/aggressive
 *  shorthand (ability ∧ willingness, lower governs). Distinct from the FIX-752
 *  `riskAppetite` pack id that drives the hard gate; the appetite DEFAULTS 1:1
 *  from this via `toleranceToAppetite` when not explicitly set. */
export const riskToleranceSchema = z.enum(["conservative", "moderate", "aggressive"]);
export type RiskTolerance = z.infer<typeof riskToleranceSchema>;

/** How a rebalancing band is measured: `absolute` = percentage-POINT drift from
 *  target; `relative` = fraction OF the target weight. The two compute drift
 *  differently, so `bandType` is a first-class field, never silently blended. */
export const bandTypeSchema = z.enum(["absolute", "relative"]);
export type BandType = z.infer<typeof bandTypeSchema>;

/** Short / intermediate / long horizon category — DERIVED from `years` (never
 *  persisted), so a record can't carry an inconsistent years/category pair. */
export const timeHorizonCategorySchema = z.enum(["short", "intermediate", "long"]);
export type TimeHorizonCategory = z.infer<typeof timeHorizonCategorySchema>;

/**
 * One target-allocation bucket over an asset class, with an optional explicit
 * min/max corridor overriding the global band.
 *
 * UNITS: all weights are PERCENTAGE POINTS 0..100 — the SAME unit as the
 * existing sizing contract (`build-portfolio-context.ts` `weightPct =
 * marketValue/totalNav * 100`; the PM's `targetWeightPct` is e.g. `3.5` for
 * 3.5%). Do NOT use fractions 0..1, or the commit clamp `min(targetWeightPct,
 * cap)` would shrink sizes ~100×.
 */
export const allocationTargetSchema = z.object({
  assetClass: mandateAssetClassSchema,
  targetPct: z.number().min(0).max(100),
  minPct: z.number().min(0).max(100).nullable().default(null),
  maxPct: z.number().min(0).max(100).nullable().default(null),
});
export type AllocationTarget = z.infer<typeof allocationTargetSchema>;

export const mandateConstraintsSchema = z.object({
  // Percentage points; HARD, at-purchase cap (the PM commit clamps size to it).
  maxPositionWeightPct: z.number().positive().max(100).nullable().default(null),
  // Percentage points; ADVISORY (a single-ticker run can't enforce a portfolio
  // cash floor — the PM narrates it, FIX-762 measures it).
  minCashPct: z.number().min(0).max(100).nullable().default(null),
  // Canonical upper-case tickers. The write action canonicalizes each entry
  // (`.trim().toUpperCase()`) so the hard exclusion gate's exact match can't miss
  // on `"nvda"` / `" NVDA "`. A non-ticker/sector string is INERT in v1 (no
  // sector classification; deferred with sector caps, §8) — kept as advisory
  // context, never a silent hard gate that fails to fire.
  exclusions: z.array(z.string()).max(200).default([]),
});
export type MandateConstraints = z.infer<typeof mandateConstraintsSchema>;

/**
 * The rebalancing-band policy. The correct default WIDTH depends on `bandType`
 * (0.2 for `relative` = ±20% of target; 5 for `absolute` = ±5pp) — a single
 * shared field default would silently mean ±0.2pp under `absolute` (FIX-762
 * would flag every move). So the default is applied in a `.transform` on the
 * OBJECT (which sees `bandType`), NOT as a field default — a caller may OMIT
 * `bandWidthPct` and still parse (the transform fills the unit-correct value)
 * rather than Zod rejecting before the action can normalize.
 *   `relative`: FRACTION of the bucket's target, (0, 1].
 *   `absolute`: PCT POINTS, (0, 100].
 */
export const rebalancingPolicySchema = z
  .object({
    bandType: bandTypeSchema.default("relative"),
    bandWidthPct: z.number().positive().optional(),
  })
  .transform((r) => ({
    ...r,
    bandWidthPct: r.bandWidthPct ?? (r.bandType === "absolute" ? 5 : 0.2),
  }));
export type RebalancingPolicy = z.infer<typeof rebalancingPolicySchema>;

export const portfolioMandateSchema = z.object({
  /** Free-text label for the policy (e.g. "Household IPS 2026"). */
  label: z.string().min(1).max(120).default("Portfolio mandate"),
  objectives: z.object({
    riskTolerance: riskToleranceSchema,
    // Optional; but if a target IS set, `returnBasis` is REQUIRED (a bare "6%"
    // that could be nominal or real is ambiguous to the PM + FIX-762/763).
    // Enforced as a cross-field rule in `validatePortfolioMandate`, not the type.
    returnTargetPct: z.number().finite().min(-100).max(1000).nullable().default(null),
    returnBasis: z.enum(["nominal", "real"]).nullable().default(null),
  }),
  targetAllocation: z.array(allocationTargetSchema).max(5).default([]), // one per asset class
  constraints: mandateConstraintsSchema,
  rebalancing: rebalancingPolicySchema,
  timeHorizon: z.object({
    // Years is the stored primitive; the short/intermediate/long CATEGORY is
    // DERIVED (in the formatter + UI via `timeHorizonCategoryFor`), never
    // persisted — so a record can't carry an inconsistent years/category pair.
    years: z.number().positive().finite().max(100).nullable().default(null),
  }),
  /** The risk-appetite mandate id (FIX-752 MANDATE_PACK) this policy adopts as
   *  the household default. OPAQUE string (the `account.riskMandate` decoupling):
   *  the analysis flow validates via `resolveMandate` at seed. Null → no explicit
   *  household appetite; the seed DERIVES one 1:1 from `objectives.riskTolerance`
   *  via `toleranceToAppetite` so a normal IPS still steers the FIX-752 gate. A
   *  per-account default or per-run override still takes precedence. To stop the
   *  two axes from sending contradictory instructions, `validatePortfolioMandate`
   *  REJECTS an explicit appetite on the opposite extreme from the tolerance;
   *  an adjacent override is allowed. */
  riskAppetite: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PortfolioMandate = z.infer<typeof portfolioMandateSchema>;

/** Sums of percentage weights are compared with this epsilon (basis-point
 *  slack) so a decimal allocation that DISPLAYS as 100 but computes to
 *  `99.999…` is not rejected. */
const SUM_EPSILON = 0.05;

/**
 * Map a stated risk tolerance to the FIX-752 `MANDATE_PACK` appetite id it
 * implies 1:1 (conservative → conservative-income, moderate → balanced,
 * aggressive → aggressive-growth). Applied at SEED so a mandate that sets only
 * `riskTolerance` still resolves to a household appetite (a set tolerance never
 * silently resolves to a null appetite), and is overridable by an explicit
 * `riskAppetite`. Returns null for a null/undefined tolerance (mandate-blind
 * appetite). Returns an OPAQUE id string — `resolveMandate` is the arbiter, so
 * this leaf never imports the risk-mandate pack (stays decoupled + browser-safe).
 */
export function toleranceToAppetite(
  tolerance: RiskTolerance | null | undefined,
): string | null {
  if (tolerance == null) return null;
  const map: Record<RiskTolerance, string> = {
    conservative: "conservative-income",
    moderate: "balanced",
    aggressive: "aggressive-growth",
  };
  return map[tolerance];
}

/** Derive the short/intermediate/long horizon CATEGORY from the stored `years`
 *  primitive (< 3 short, 3–10 intermediate, > 10 long). Null when no horizon is
 *  set. Kept here so the formatter + UI derive it identically and never persist
 *  an inconsistent pair. */
export function timeHorizonCategoryFor(
  years: number | null | undefined,
): TimeHorizonCategory | null {
  if (years == null) return null;
  if (years < 3) return "short";
  if (years <= 10) return "intermediate";
  return "long";
}

/**
 * Non-throwing validation for the editor + the action boundary. Returns the list
 * of human-readable issues (empty = valid).
 *
 * Checks (§4.3):
 *  - EMPTY allocation (`[]`) means "no target-allocation policy" (constraints
 *    still apply) — the allocation-sum / drift rules below run only when ≥ 1 row
 *    exists.
 *  - each asset class appears at most once; `minPct ≤ targetPct ≤ maxPct` where set.
 *  - CASH REMAINDER RULE: with an explicit `cash` bucket the targets must sum to
 *    EXACTLY 100 (no ambiguous implicit remainder); with NO `cash` bucket they
 *    must sum to ≤ 100 and the remainder is the implicit cash target.
 *  - FEASIBLE CORRIDORS (aggregate): the minimum weights (non-cash mins + the
 *    cash floor `max(cashBucket.minPct, minCashPct)`) cannot sum above 100.
 *  - CASH FLOOR CONSISTENCY: the cash target (explicit, or the implicit
 *    remainder `100 − Σ non-cash targets`) must be `≥ minCashPct`.
 *  - band width: `> 0`; for `relative`, `≤ 1`; for `absolute`, `≤ 100`.
 *  - if `returnTargetPct` is set, `returnBasis` is required.
 *  - an explicit `riskAppetite` on the OPPOSITE EXTREME from `riskTolerance` is
 *    rejected (contradictory posture). The unknown-`riskAppetite`-id check is
 *    NOT here — it is a SAVE-ONLY guard in the action, because seed RE-RUNS this
 *    validator (§4.5) and a stale appetite id must degrade ONLY the appetite to
 *    null, never blank the whole IPS.
 *
 * Seed re-runs this before freezing (§4.5) — a business-invalid persisted record
 * degrades to mandate-blind. NOT a generator output — plain validation.
 */
export function validatePortfolioMandate(m: PortfolioMandate): string[] {
  const issues: string[] = [];
  const alloc = m.targetAllocation;

  // Duplicate bucket + per-bucket ordering.
  const seen = new Set<MandateAssetClass>();
  for (const row of alloc) {
    if (seen.has(row.assetClass)) {
      issues.push(`target allocation lists "${row.assetClass}" more than once`);
    }
    seen.add(row.assetClass);
    if (row.minPct != null && row.minPct > row.targetPct + SUM_EPSILON) {
      issues.push(`${row.assetClass}: minPct (${row.minPct}) exceeds targetPct (${row.targetPct})`);
    }
    if (row.maxPct != null && row.maxPct < row.targetPct - SUM_EPSILON) {
      issues.push(`${row.assetClass}: maxPct (${row.maxPct}) is below targetPct (${row.targetPct})`);
    }
    if (row.minPct != null && row.maxPct != null && row.minPct > row.maxPct + SUM_EPSILON) {
      issues.push(`${row.assetClass}: minPct (${row.minPct}) exceeds maxPct (${row.maxPct})`);
    }
  }

  const minCash = m.constraints.minCashPct;

  // Allocation-sum + cash-remainder + corridor feasibility, only when a policy
  // is actually declared (an empty allocation is "no allocation policy").
  if (alloc.length > 0) {
    const cashRow = alloc.find((r) => r.assetClass === "cash");
    const sumTargets = alloc.reduce((s, r) => s + r.targetPct, 0);
    const nonCashTargetSum = alloc
      .filter((r) => r.assetClass !== "cash")
      .reduce((s, r) => s + r.targetPct, 0);

    if (cashRow != null) {
      // Explicit cash → the targets fully partition the book; no implicit remainder.
      if (Math.abs(sumTargets - 100) > SUM_EPSILON) {
        issues.push(
          `target allocation includes an explicit cash bucket, so weights must sum to 100% (they sum to ${sumTargets.toFixed(2)}%)`,
        );
      }
    } else if (sumTargets > 100 + SUM_EPSILON) {
      issues.push(
        `target allocation weights sum above 100% (${sumTargets.toFixed(2)}%)`,
      );
    }

    // Aggregate corridor feasibility: the minimum weights can't require more than
    // the whole book. Cash's effective floor is the tighter of its bucket min and
    // the standing `minCashPct`.
    const nonCashMinSum = alloc
      .filter((r) => r.assetClass !== "cash")
      .reduce((s, r) => s + (r.minPct ?? 0), 0);
    const cashFloor = Math.max(cashRow?.minPct ?? 0, minCash ?? 0);
    if (nonCashMinSum + cashFloor > 100 + SUM_EPSILON) {
      issues.push(
        `target allocation corridors are infeasible: minimum weights sum to ${(nonCashMinSum + cashFloor).toFixed(2)}% (> 100%)`,
      );
    }

    // Cash floor consistency: the cash target (explicit, or the implicit
    // remainder) must respect the standing minimum-cash constraint.
    if (minCash != null) {
      const cashTarget = cashRow != null ? cashRow.targetPct : 100 - nonCashTargetSum;
      if (cashTarget < minCash - SUM_EPSILON) {
        issues.push(
          `the cash target (${cashTarget.toFixed(2)}%) is below the minimum-cash constraint (${minCash}%)`,
        );
      }
    }
  }

  // Rebalancing band width, per band type (the transform guarantees a value).
  const { bandType, bandWidthPct } = m.rebalancing;
  if (!(bandWidthPct > 0)) {
    issues.push("rebalancing band width must be greater than 0");
  } else if (bandType === "relative" && bandWidthPct > 1) {
    issues.push("a relative rebalancing band is a fraction of the target and must be ≤ 1 (e.g. 0.2 = ±20%)");
  } else if (bandType === "absolute" && bandWidthPct > 100) {
    issues.push("an absolute rebalancing band is in percentage points and must be ≤ 100");
  }

  // Return objective: a target with no basis is ambiguous downstream.
  if (m.objectives.returnTargetPct != null && m.objectives.returnBasis == null) {
    issues.push("a return target requires a return basis (nominal or real)");
  }

  // Appetite ↔ tolerance contradiction (only when appetite is explicitly set to a
  // KNOWN extreme opposite the tolerance; unknown ids are the action's concern).
  if (m.riskAppetite != null) {
    if (m.objectives.riskTolerance === "conservative" && m.riskAppetite === "aggressive-growth") {
      issues.push("a conservative risk tolerance cannot adopt the aggressive-growth appetite");
    }
    if (m.objectives.riskTolerance === "aggressive" && m.riskAppetite === "conservative-income") {
      issues.push("an aggressive risk tolerance cannot adopt the conservative-income appetite");
    }
  }

  return issues;
}
