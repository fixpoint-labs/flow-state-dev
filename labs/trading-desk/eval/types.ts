/**
 * Shared types for the run-quality evaluation suite (FIX-790).
 *
 * The eval suite has two layers over a stored run's `RunArtifactsBundle`:
 *   - a DETERMINISTIC invariant layer (`invariants.ts`) that recomputes and
 *     cross-checks the recorded decision at zero model cost, and
 *   - an LLM-JUDGE layer (`judge.ts`) that scores the qualitative dimensions
 *     code can't check.
 *
 * Both feed one `QualityRecord` line on the JSONL scoreboard (`scoreboard.ts`).
 * The deterministic and judged results stay SEPARABLE — no composite score — so
 * a consumer can see exactly which layer moved (industry guidance, spec §3).
 *
 * Every check records `{id, severity, status, expected?, actual?, detail}` —
 * never a pre-aggregated number — so a failure is self-explaining.
 */
import { z } from "zod";
import { ratingSchema } from "../flows/analysis/lib/rating-engine";
import { runStatusSchema } from "../flows/analysis/run-summary";

/** The result of one deterministic invariant check. */
export type CheckResult = {
  /** Stable id, group-prefixed, e.g. `"rating-envelope/final-within-band"`. */
  id: string;
  /** `hard` = an internal contradiction (gates CLI exit code); `soft` = a
   *  flagged signal (never gates). */
  severity: "hard" | "soft";
  /** `flag` only ever appears on a soft check; `skipped` = the substrate the
   *  check needs is absent (n/a for this run), never a failure. */
  status: "pass" | "fail" | "flag" | "skipped";
  expected?: unknown;
  actual?: unknown;
  detail: string;
};

/** The full deterministic report over one run — a tally plus every check. */
export type InvariantReport = {
  hard: { passed: number; failed: number };
  soft: { passed: number; flagged: number };
  skipped: number;
  checks: CheckResult[];
};

// ── Scoreboard record (§4.6) ─────────────────────────────────────────────

/** One judged dimension's aggregated result on the scoreboard line. */
export const judgeDimensionRecordSchema = z.object({
  dimension: z.string(),
  kind: z.enum(["graded", "checklist"]),
  /** Per-dimension: a budget cap or missing substrate marks it `skipped`. */
  status: z.enum(["scored", "skipped"]),
  skipReason: z.string().nullable(),
  mean: z.number().nullable(),
  std: z.number().nullable(),
  k: z.number(),
  /** All 0–1 (§4.5); empty when skipped. */
  scores: z.array(z.number()),
  costUsd: z.number().nullable(),
});
export type JudgeDimensionRecord = z.infer<typeof judgeDimensionRecordSchema>;

/**
 * One JSONL line per evaluated run. Additive-only evolution keyed by
 * `evalVersion` (BP-030): FIX-791 (golden diffing) and FIX-792 (cost accounting)
 * consume and extend this shape. Deterministic + judged results stay separable
 * (no composite).
 */
export const qualityRecordSchema = z.object({
  evalVersion: z.literal(1),
  sessionId: z.string(),
  // Identity fields are nullable ONLY so a `runStatus: "error"` line can still
  // be appended when the `runArtifacts` read itself failed (eval mode has no
  // manifest to fill them from); sweep mode always fills them from the tuple.
  ticker: z.string().nullable(),
  date: z.string().nullable(),
  costPreset: z.enum(["fast", "full"]).nullable(),
  dataSource: z.enum(["fixture", "live", "record"]).nullable(),
  mandateId: z.string().nullable(),
  runStatus: runStatusSchema,
  // `ranAt` = when ANALYZE originally ran, never when the read action ran.
  ranAt: z.string().nullable(),
  evaluatedAt: z.string(),
  finalRating: ratingSchema.nullable(),
  decisionConfidence: z.number().nullable(),
  targetWeightPct: z.number().nullable(),
  invariants: z.object({
    hardPassed: z.number(),
    hardFailed: z.number(),
    softPassed: z.number(),
    softFlagged: z.number(),
    skipped: z.number(),
    // Hard failures only, inline, so the scoreboard line is self-diagnosing.
    failures: z.array(z.object({ id: z.string(), detail: z.string() })),
  }),
  // Null only when the whole judge layer was skipped (--no-judges / non-completed run).
  judges: z.array(judgeDimensionRecordSchema).nullable(),
  judgeModel: z.string().nullable(),
  // e.g. self-preference (judge family == executor family).
  warnings: z.array(z.string()),
  // Full CheckResult[] + raw judge findings/evidence per repeat live here.
  detailPath: z.string(),
});
export type QualityRecord = z.infer<typeof qualityRecordSchema>;
