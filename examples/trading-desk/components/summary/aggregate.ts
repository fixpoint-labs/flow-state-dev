/**
 * Summary aggregate — the pure, UI-layer view model for the per-report Summary.
 *
 * `buildReportSummary` maps already-validated, already-stored memo + valuation-
 * spine state into a single `ReportSummary` that the Summary components render
 * dumbly. It is NOT a generator output and never reaches an LLM (BP-016 does not
 * apply); it derives nothing from thin air — every field traces to a named
 * stored field on `MemoState` / `ValuationSpineState`. Missing inputs collapse
 * to `null` here so the components never have to null-check the desk's state.
 *
 * This file is the one place null-handling and the stance→axis mapping live,
 * which keeps the real-money trust gate honest: there is exactly one mapping
 * from stored stance labels to the convergence axis, and it is unit-tested.
 */
import type { MemoState } from "@/src/flows/trading-desk/resources";
import type { ValuationSpineState } from "@/src/flows/trading-desk/valuation-spine-resource";
import {
  AGENTS,
  ALL_MEMO_KEYS,
  PHASE_1_MEMO_KEYS,
  type AgentName,
  type AnyMemoShortName,
} from "@/src/flows/trading-desk/agents";

/** One analyst's TLDR line for the Summary grid. */
export type AnalystTldr = {
  shortName: AnyMemoShortName;
  agent: AgentName;
  role: string; // AGENTS[agent].role
  glyph: string; // AGENTS[agent].glyph
  hue: number; // AGENTS[agent].hue (badge accent)
  headline: string | null; // memo.headline — the TLDR
  stance: "constructive" | "neutral" | "cautious" | null; // memo.rating
  dataQuality: "full" | "partial" | "unavailable" | null;
  topMetrics: Array<{ key: string; value: string }>; // first 2 entries of memo.metrics
  status: MemoState["status"] | null;
};

/** The PM decision block. Null until the PM memo publishes. */
export type DecisionSummary = {
  finalRating: MemoState["finalRating"]; // 5-tier
  modelImpliedRating: MemoState["modelImpliedRating"];
  ratingBand: MemoState["ratingBand"]; // { floor, ceiling }
  ratingClamped: boolean | null;
  decisionSummary: string | null;
  decisionConfidence: number | null;
  agreesWithTrader: boolean | null;
  primaryScenario: string | null;
} | null;

/** The trade levels (from the trader memo). Null when no trader memo. */
export type TradeLevels = {
  direction: "long" | "short" | "flat" | null;
  sizePct: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
  holdingPeriod: MemoState["holdingPeriod"];
  invalidationCriteria: string[] | null;
} | null;

/** One node in the convergence strip: a stance mapped to a -1..+1 axis. */
export type ConvictionNode = {
  agent: AgentName;
  role: string;
  glyph: string;
  hue: number;
  /** -1 (bearish/cautious/short/Sell) .. +1 (bullish/constructive/long/Buy).
   *  null when the participant has no published stance (hollow node). */
  axis: number | null;
  raw: string | null; // the original label, for the node title
  /** True for the PM node, so the strip can outline "the decision". */
  isDecision: boolean;
};

/** Numeric factor scores from the valuation spine, scaled 0..100. */
export type FactorScores = {
  value: number | null;
  quality: number | null;
  factor: number | null;
  momentum: number | null;
} | null;

export type ReportSummary = {
  ticker: string;
  date: string;
  analysts: AnalystTldr[]; // ordered by Phase 1 publish order
  decision: DecisionSummary;
  trade: TradeLevels;
  conviction: ConvictionNode[]; // analysts + RM + trader + PM in pipeline order
  rmStance: {
    stance: "bullish" | "bearish" | "neutral" | null;
    conviction: number | null;
  };
  factorScores: FactorScores;
  criticalRisks: Array<{
    description: string;
    severity: "high" | "medium" | "low";
    raisedBy: string;
  }>;
  keyDependencies: string[];
  scenarios: Array<{ name: string; probability: number; isPrimary: boolean }>;
  distribution: string | null;
  /** Labeled "Thesis alignment" in the UI — NOT portfolio fit (spec 06 §9.4). */
  thesisAlignment: { alignment: string | null; confidence: number | null };
};

/**
 * Stance → conviction-axis mapping. One label set per participant kind, all
 * collapsed to the shared -1..+1 axis. Unknown / unpublished labels map to
 * `null` (rendered as a hollow node), never to a fabricated 0.
 */
const STANCE_AXIS: Record<string, number> = {
  // Phase 1 analyst ratings.
  constructive: 1,
  neutral: 0,
  cautious: -1,
  // Phase 2 research-manager / Phase 3 trader.
  bullish: 1,
  bearish: -1,
  long: 1,
  short: -1,
  flat: 0,
  // Phase 5 PM five-tier rating.
  Buy: 1,
  Overweight: 0.5,
  Hold: 0,
  Underweight: -0.5,
  Sell: -1,
};

/** Map a stored stance label to the convergence axis. Null for unknown/absent. */
export function stanceToAxis(label: string | null | undefined): number | null {
  if (label === null || label === undefined || label === "") return null;
  return label in STANCE_AXIS ? STANCE_AXIS[label] : null;
}

/** First N entries of a memo's `metrics` record, as ordered key/value pairs. */
function topMetrics(
  metrics: MemoState["metrics"],
  n: number,
): Array<{ key: string; value: string }> {
  if (metrics === null || metrics === undefined) return [];
  return Object.entries(metrics)
    .slice(0, n)
    .map(([key, value]) => ({ key, value }));
}

/** Phase 1 analyst short names in publish order. Drives both grid + conviction. */
const PHASE_1_ORDER = Object.keys(
  PHASE_1_MEMO_KEYS,
) as Array<keyof typeof PHASE_1_MEMO_KEYS>;

/** Conviction strip order: analysts → research manager → trader → PM. */
const CONVICTION_ORDER: ReadonlyArray<AnyMemoShortName> = [
  ...PHASE_1_ORDER,
  "researchManager",
  "trader",
  "portfolioManager",
];

/**
 * Build the Summary view model from stored state.
 *
 * @param memosByKey  short-name → MemoState (or null when that memo is absent /
 *                    unpublished). The caller maps `item.topic` back to a short
 *                    name; absent keys are simply missing from the map.
 * @param spine       the valuation-spine resource, or null when not computed.
 */
export function buildReportSummary(
  memosByKey: Map<AnyMemoShortName, MemoState | null>,
  spine: ValuationSpineState | null,
): ReportSummary {
  const get = (key: AnyMemoShortName): MemoState | null =>
    memosByKey.get(key) ?? null;

  // Identity — read from any present memo (they all carry ticker/date).
  let ticker = "";
  let date = "";
  for (const memo of memosByKey.values()) {
    if (memo !== null) {
      ticker = memo.ticker;
      date = memo.date;
      break;
    }
  }

  // Analyst TLDR grid (Phase 1, publish order).
  const analysts: AnalystTldr[] = PHASE_1_ORDER.map((shortName) => {
    const agent = ALL_MEMO_KEYS[shortName].agentName;
    const meta = AGENTS[agent];
    const memo = get(shortName);
    return {
      shortName,
      agent,
      role: meta.role,
      glyph: meta.glyph,
      hue: meta.hue,
      headline: memo?.headline ?? null,
      stance: (memo?.rating ?? null) as AnalystTldr["stance"],
      dataQuality: memo?.dataQuality ?? null,
      topMetrics: topMetrics(memo?.metrics ?? null, 2),
      status: memo?.status ?? null,
    };
  });

  // PM decision.
  const pm = get("portfolioManager");
  const decision: DecisionSummary =
    pm !== null && pm.finalRating !== null
      ? {
          finalRating: pm.finalRating,
          modelImpliedRating: pm.modelImpliedRating,
          ratingBand: pm.ratingBand,
          ratingClamped: pm.ratingClamped,
          decisionSummary: pm.decisionSummary,
          decisionConfidence: pm.decisionConfidence,
          agreesWithTrader: pm.agreesWithTrader,
          primaryScenario:
            pm.primaryScenario !== null && pm.primaryScenario !== ""
              ? pm.primaryScenario
              : null,
        }
      : null;

  // Trade levels (trader memo).
  const trader = get("trader");
  const trade: TradeLevels =
    trader !== null
      ? {
          direction: trader.direction,
          sizePct: trader.sizePct,
          stopPrice: trader.stopPrice,
          targetPrice: trader.targetPrice,
          holdingPeriod: trader.holdingPeriod,
          invalidationCriteria: trader.invalidationCriteria,
        }
      : null;

  // Conviction strip — one node per participant, stance mapped to the axis.
  const conviction: ConvictionNode[] = CONVICTION_ORDER.map((shortName) => {
    const agent = ALL_MEMO_KEYS[shortName].agentName;
    const meta = AGENTS[agent];
    const memo = get(shortName);
    const raw = stanceLabelForMemo(shortName, memo);
    return {
      agent,
      role: meta.role,
      glyph: meta.glyph,
      hue: meta.hue,
      axis: stanceToAxis(raw),
      raw,
      isDecision: shortName === "portfolioManager",
    };
  });

  // Research-manager stance summary.
  const rm = get("researchManager");
  const rmStance = {
    stance: (rm?.stance ?? null) as ReportSummary["rmStance"]["stance"],
    conviction: rm?.conviction ?? null,
  };

  // Factor scores (valuation spine). The spine's component scores are ~0..100.
  const factorScores: FactorScores =
    spine !== null
      ? {
          value: spine.setupScore.value,
          quality: spine.setupScore.quality,
          factor: spine.setupScore.factor,
          momentum: spine.setupScore.momentum,
        }
      : null;

  // Risk & dependencies.
  const risk = get("riskAssessment");
  const criticalRisks = (risk?.criticalRisks ?? []).map((r) => ({
    description: r.description,
    severity: r.severity,
    raisedBy: r.raisedBy,
  }));
  const keyDependencies = pm?.keyDependencies ?? [];

  // Scenario distribution.
  const scenarioMemo = get("scenarioForecast");
  const primaryScenarioName = decision?.primaryScenario ?? null;
  const scenarios = (scenarioMemo?.scenarios ?? []).map((s) => ({
    name: s.name,
    probability: s.probability,
    isPrimary: primaryScenarioName !== null && s.name === primaryScenarioName,
  }));
  const distribution = scenarioMemo?.distribution ?? null;

  // Phase 6 thesis alignment (NOT portfolio fit).
  const align = get("thesisAlignment");
  const thesisAlignment = {
    alignment: align?.alignment ?? null,
    confidence: align?.alignmentConfidence ?? null,
  };

  return {
    ticker,
    date,
    analysts,
    decision,
    trade,
    conviction,
    rmStance,
    factorScores,
    criticalRisks,
    keyDependencies,
    scenarios,
    distribution,
    thesisAlignment,
  };
}

/**
 * Resolve the stance label a participant published, by participant kind:
 *   - Phase 1 analysts → `rating` (constructive/neutral/cautious)
 *   - research manager → `stance` (bullish/bearish/neutral)
 *   - trader           → `direction` (long/short/flat)
 *   - portfolio manager→ `finalRating` (5-tier)
 * Returns null when the memo is absent or the relevant field is unpublished.
 */
function stanceLabelForMemo(
  shortName: AnyMemoShortName,
  memo: MemoState | null,
): string | null {
  if (memo === null) return null;
  if (shortName === "researchManager") return memo.stance;
  if (shortName === "trader") return memo.direction;
  if (shortName === "portfolioManager") return memo.finalRating;
  return memo.rating;
}
