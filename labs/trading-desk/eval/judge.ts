/**
 * LLM-judge layer (FIX-790) — scores the qualitative dimensions code can't check.
 *
 * Each rubric dimension (`rubrics.ts`) is graded by running the framework's
 * `utility.analyzer` block directly through `runAction` with the eval finding
 * schema — the same framework execution path `analyzerScorer` builds on, but
 * run directly so we keep the RAW findings array (per-criterion
 * score/assessment/evidence) for the sidecar (the public `ScoreResult`
 * collapses findings into a `reason` string).
 * The judge model is PINNED via `model` on the block config against an injected
 * `createModelResolver()`, distinct from the desk's generators (self-preference
 * warning when the family collides). It reads a BLINDED bundle, never re-running
 * the pipeline.
 *
 * Per repeat: a local timeout race (`--judge-timeout-ms`) so a hung provider
 * can't block the sweep; a failed / timed-out repeat records score 0 + a reason
 * (a failed judge is a failed score, never a crashed sweep). k repeats per
 * dimension → mean + std recorded; a budget cap stops launching further calls.
 */
import { defineFlow, utility, createModelResolver } from "@flow-state-dev/core";
import type { ModelResolver } from "@flow-state-dev/core";
import { createInMemoryStores, runAction } from "@flow-state-dev/engine";
import { z } from "zod";
import type { RunArtifactsBundle } from "../flows/analysis/run-artifacts";
import { blindBundle } from "./blinding";
import { RUBRICS, type RubricDimension } from "./rubrics";
import { meanStd } from "./stats";

// The eval finding schema (mirrors `analyzerScorer`'s private shape). Passing our
// own schema to `utility.analyzer` keeps the raw findings without touching the
// framework package.
const judgeFindingSchema = z.object({
  criterion: z.string(),
  score: z.number().min(0).max(1),
  assessment: z.string(),
  evidence: z.string().optional(),
});
const judgeOutputSchema = z.object({
  findings: z.array(judgeFindingSchema),
  overallAssessment: z.string().optional(),
});
export type JudgeFinding = z.infer<typeof judgeFindingSchema>;

/** One judge repeat's raw result — kept in full for the detail sidecar. */
export type JudgeRepeat = {
  /** 0–1 mean of the finding scores (0 on a failed / timed-out repeat). */
  score: number;
  findings: JudgeFinding[];
  status: "scored" | "failed" | "timeout";
  reason: string | null;
  costUsd: number | null;
};

/** One dimension's aggregated result over k repeats. */
export type JudgeDimensionResult = {
  key: string;
  kind: "graded" | "checklist";
  status: "scored" | "skipped";
  skipReason: string | null;
  mean: number | null;
  std: number | null;
  k: number;
  scores: number[];
  repeats: JudgeRepeat[];
  costUsd: number | null;
};

export type JudgeReport = {
  dimensions: JudgeDimensionResult[];
  judgeModel: string;
  warnings: string[];
  totalCostUsd: number | null;
};

/** One invocation-wide judge budget shared by every session evaluated by the
 * command. `remainingUsd` reaches zero when known spend exhausts the cap or a
 * failed call makes the remaining headroom unknowable. */
export type JudgeBudget = {
  limitUsd: number;
  remainingUsd: number;
  blockedReason: string | null;
};

export function createJudgeBudget(limitUsd: number): JudgeBudget {
  return { limitUsd, remainingUsd: limitUsd, blockedReason: null };
}

export type RunJudgesOptions = {
  judgeModel: string;
  /** Repeats per dimension (default 3). */
  k?: number;
  /** Per-repeat timeout in ms (default 120000). */
  timeoutMs?: number;
  /** Stop launching judge calls once cumulative cost exceeds this. */
  maxCostUsd?: number;
  /** Shared command budget. When present, it supersedes `maxCostUsd` and is
   * debited after this session so later sessions see the remaining headroom. */
  budget?: JudgeBudget;
  /** Injectable resolver (tests inject a mock; production uses the default). */
  modelResolver?: ModelResolver;
};

/** The desk's generators run through these families (intent ladder + gateway);
 *  a judge from one of them earns a self-preference caveat. */
const EXECUTOR_FAMILIES = ["openai", "google", "gemini", "xai"];

/** Approximate USD rates for the judge models this suite defaults to. Lab-local
 *  and best-effort — real cost/token accounting is FIX-792. */
const JUDGE_PRICE: Array<{ key: string; inPer1M: number; outPer1M: number }> = [
  { key: "gpt-5.4-mini", inPer1M: 0.2, outPer1M: 0.8 },
  { key: "gpt-5.4-nano", inPer1M: 0.05, outPer1M: 0.4 },
  { key: "claude-haiku", inPer1M: 0.8, outPer1M: 4.0 },
  { key: "gemini-3.5-flash", inPer1M: 0.3, outPer1M: 2.5 },
];

/** Conservative rate for a model NOT in the table — the most expensive entry, so
 *  an unpriced judge OVER-estimates and a `--max-cost-usd` cap still trips
 *  (fail-safe: stop early rather than overspend on an unknown model). */
const FALLBACK_RATE = JUDGE_PRICE.reduce((a, b) => (b.outPer1M > a.outPer1M ? b : a));

/** Whether the judge model is in the (approximate) price table. When it isn't,
 *  its spend is estimated conservatively (FALLBACK_RATE), so a `--max-cost-usd`
 *  cap may stop earlier than the true spend. */
function isJudgePriced(modelId: string): boolean {
  return JUDGE_PRICE.some((p) => modelId.includes(p.key));
}

function estimateJudgeCost(items: readonly unknown[]): number | null {
  let total = 0;
  let sawUsage = false;
  for (const item of items) {
    const trace = item as {
      type?: string;
      modelUsage?: { model: string; promptTokens: number; completionTokens: number };
    };
    if (trace.type !== "block_trace" || trace.modelUsage === undefined) continue;
    sawUsage = true;
    const usage = trace.modelUsage;
    // Unpriced model → conservative fallback, so the budget cap still enforces.
    const price = JUDGE_PRICE.find((p) => usage.model.includes(p.key)) ?? FALLBACK_RATE;
    total +=
      (usage.promptTokens / 1_000_000) * price.inPer1M +
      (usage.completionTokens / 1_000_000) * price.outPer1M;
  }
  return sawUsage ? total : null;
}

/** The judge model's provider family, for the self-preference check. */
function modelFamily(modelId: string): string {
  const segments = modelId.split("/");
  return segments.length >= 3 ? segments[1] : segments[0];
}

function meanOfFindings(
  findings: JudgeFinding[],
  dim: RubricDimension,
): number {
  // Checklist criteria are 0-or-1 (spec §4.5): a judge that returns a fractional
  // score is snapped to the nearest bound so the mean preserves binary semantics.
  const scoreOf = (f: JudgeFinding): number =>
    dim.kind === "checklist" ? (f.score >= 0.5 ? 1 : 0) : f.score;

  // Aggregate against the DECLARED rubric, not the number of rows the model
  // happened to return. Only the first exact match for each criterion counts;
  // duplicate and unknown rows are ignored, while omitted criteria contribute 0.
  // This prevents a judge from replacing three distinct checks with three copies
  // of one high-scoring finding and still earning a perfect dimension score.
  if (dim.criteria.length === 0) return 0;
  const expected = new Set(dim.criteria);
  const scores = new Map<string, number>();
  for (const finding of findings) {
    if (expected.has(finding.criterion) && !scores.has(finding.criterion)) {
      scores.set(finding.criterion, scoreOf(finding));
    }
  }
  return (
    dim.criteria.reduce((sum, criterion) => sum + (scores.get(criterion) ?? 0), 0) /
    dim.criteria.length
  );
}

/** Grade one dimension once. Never throws — a failure or timeout becomes a
 *  score-0 repeat with a reason. */
async function judgeOnce(
  dim: RubricDimension,
  inputString: string,
  resolver: ModelResolver,
  judgeModel: string,
  timeoutMs: number,
): Promise<JudgeRepeat> {
  const block = utility.analyzer({
    name: `eval-judge-${dim.key}`,
    model: judgeModel,
    criteria: dim.criteria,
    outputSchema: judgeOutputSchema,
  });
  const flow = defineFlow({
    kind: `eval-judge-${dim.key}`,
    actions: { judge: { block } },
  })();

  const abortController = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("judge timeout");
      abortController.abort(error);
      reject(error);
    }, timeoutMs);
  });

  const actionPromise = runAction({
    flow,
    actionName: "judge",
    input: inputString,
    userId: "eval-judge",
    stores: createInMemoryStores(),
    signal: abortController.signal,
    runtimeConfig: { modelResolver: resolver },
  });
  // The timeout aborts the framework action and its provider request. Keep a
  // terminal handler because the timeout promise may win the race first.
  actionPromise.catch(() => {});

  try {
    const result = await Promise.race([actionPromise, timeout]);
    if (result.error) {
      const isTimeout = abortController.signal.aborted;
      return {
        score: 0,
        findings: [],
        status: isTimeout ? "timeout" : "failed",
        reason: isTimeout ? "judge timeout" : result.error.message,
        costUsd: isTimeout ? null : estimateJudgeCost(result.items),
      };
    }
    const output = result.output as z.infer<typeof judgeOutputSchema>;
    return {
      score: meanOfFindings(output.findings, dim),
      findings: output.findings,
      status: "scored",
      reason: null,
      costUsd: estimateJudgeCost(result.items),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout = message === "judge timeout";
    return { score: 0, findings: [], status: isTimeout ? "timeout" : "failed", reason: message, costUsd: null };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Run every rubric dimension over a stored run's bundle. Returns `null` when the
 * whole judge layer is skipped (a non-completed run) — the deterministic layer
 * still records. Otherwise every dimension is either `scored` (k repeats) or
 * `skipped` (missing substrate or a tripped budget cap).
 */
export async function runJudges(
  bundle: RunArtifactsBundle,
  opts: RunJudgesOptions,
): Promise<JudgeReport | null> {
  // Judges only grade a completed run — the deterministic layer covers the rest.
  if (bundle.summary.status !== "completed") return null;

  const k = opts.k ?? 3;
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const resolver = opts.modelResolver ?? createModelResolver();
  const maxCostUsd = opts.budget?.remainingUsd ?? opts.maxCostUsd;
  const budgetLabelUsd = opts.budget?.limitUsd ?? opts.maxCostUsd;

  const warnings: string[] = [];
  if (EXECUTOR_FAMILIES.includes(modelFamily(opts.judgeModel))) {
    warnings.push(
      `Judge model "${opts.judgeModel}" shares a provider family with the desk's generators: ` +
        `self-preference bias is possible. Scores are recorded with this caveat.`,
    );
  }
  // An unpriced judge model is costed at the conservative FALLBACK_RATE so the cap
  // still enforces (fail-safe), but the estimate is a rough upper bound — warn so
  // the caller knows the cap may stop earlier than the true spend.
  if (maxCostUsd !== undefined && !isJudgePriced(opts.judgeModel)) {
    warnings.push(
      `judge model "${opts.judgeModel}" is not in the price table, so --max-cost-usd is ` +
        `enforced against a conservative (upper-bound) cost estimate and may stop earlier than the true spend.`,
    );
  }

  const blinded = blindBundle(bundle);
  const dimensions: JudgeDimensionResult[] = [];
  let cumulativeCost = 0;
  let hasUnknownCost = false;
  let budgetBlockedReason: string | null = opts.budget?.blockedReason ?? null;

  for (const dim of RUBRICS) {
    if (!dim.needs(bundle)) {
      dimensions.push({
        key: dim.key,
        kind: dim.kind,
        status: "skipped",
        skipReason: `substrate absent for ${dim.key}`,
        mean: null,
        std: null,
        k: 0,
        scores: [],
        repeats: [],
        costUsd: null,
      });
      continue;
    }
    if (
      budgetBlockedReason !== null ||
      (maxCostUsd !== undefined && cumulativeCost >= maxCostUsd)
    ) {
      dimensions.push({
        key: dim.key,
        kind: dim.kind,
        status: "skipped",
        skipReason:
          budgetBlockedReason ??
          `command budget cap ($${budgetLabelUsd}) reached before this dimension`,
        mean: null,
        std: null,
        k: 0,
        scores: [],
        repeats: [],
        costUsd: null,
      });
      continue;
    }

    const inputString = [
      dim.preamble,
      "",
      "## Artifact to evaluate",
      JSON.stringify(dim.input(blinded), null, 2),
    ].join("\n");

    const repeats: JudgeRepeat[] = [];
    for (let i = 0; i < k; i++) {
      // Enforce the budget BETWEEN repeats too, not just between dimensions — an
      // early repeat can cross the cap mid-dimension.
      if (maxCostUsd !== undefined && cumulativeCost >= maxCostUsd) break;
      const repeat = await judgeOnce(dim, inputString, resolver, opts.judgeModel, timeoutMs);
      repeats.push(repeat);
      if (repeat.costUsd != null) {
        cumulativeCost += repeat.costUsd;
      } else {
        hasUnknownCost = true;
        // A thrown/timed-out provider call may already have consumed tokens but
        // exposes no usage trace. With a budget configured, fail CLOSED: stop
        // launching calls because the remaining headroom is unknowable.
        if (maxCostUsd !== undefined) {
          budgetBlockedReason =
            `judge spend became unknown after ${dim.key} repeat ${i + 1}; ` +
            `stopped further calls to preserve the $${budgetLabelUsd} command budget cap`;
          break;
        }
      }
    }

    // Budget hit before this dimension's first repeat → skipped, not a 0-repeat score.
    if (repeats.length === 0) {
      dimensions.push({
        key: dim.key,
        kind: dim.kind,
        status: "skipped",
        skipReason: `command budget cap ($${budgetLabelUsd}) reached before this dimension`,
        mean: null,
        std: null,
        k: 0,
        scores: [],
        repeats: [],
        costUsd: null,
      });
      continue;
    }
    if (repeats.length < k) {
      warnings.push(
        budgetBlockedReason ??
          `${dim.key}: budget cap reached — ${repeats.length}/${k} repeats ran`,
      );
    }

    const scores = repeats.map((r) => r.score);
    const { mean, std } = meanStd(scores);
    const dimCosts = repeats.map((r) => r.costUsd).filter((c): c is number => c != null);
    dimensions.push({
      key: dim.key,
      kind: dim.kind,
      status: "scored",
      skipReason: null,
      mean,
      std,
      // Record the repeats that actually ran, not the requested k.
      k: repeats.length,
      scores,
      repeats,
      costUsd: dimCosts.length > 0 ? dimCosts.reduce((a, b) => a + b, 0) : null,
    });
  }

  const allCosts = dimensions.flatMap((d) => (d.costUsd != null ? [d.costUsd] : []));
  if (opts.budget !== undefined) {
    if (hasUnknownCost) {
      opts.budget.remainingUsd = 0;
      opts.budget.blockedReason = budgetBlockedReason;
    } else {
      opts.budget.remainingUsd = Math.max(0, opts.budget.remainingUsd - cumulativeCost);
    }
  }
  return {
    dimensions,
    judgeModel: opts.judgeModel,
    warnings,
    // Any timeout/throw without a usage trace makes the true total unknowable;
    // never report a known-cost subtotal as though it were the total.
    totalCostUsd:
      hasUnknownCost || allCosts.length === 0
        ? null
        : allCosts.reduce((a, b) => a + b, 0),
  };
}
