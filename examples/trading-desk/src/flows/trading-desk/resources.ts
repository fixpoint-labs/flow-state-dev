/**
 * Memo resource collection for the Trading Desk example.
 *
 * Each memo is a session-scoped resource keyed by `memos/{phase}/{shortName}`
 * (e.g. `memos/p1/fundamentals`). Memo body is part of resource state — not
 * lazy content — because the renderer needs structured sections, not a
 * markdown blob, and `client.data` projects a sidebar-friendly summary
 * without an extra fetch.
 */
import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

/** Memo lifecycle states. The Phase 1 sub-sequencer pre-creates each memo
 *  in `pending`, transitions to `writing` when the analyst generator starts,
 *  and lands in `published` (or `error`) when the generator finishes. */
export const memoStatusSchema = z.enum(["pending", "writing", "published", "error"]);

export type MemoStatus = z.infer<typeof memoStatusSchema>;

/** Shared `Thesis` body section shape — every analyst, bull/bear, and
 *  research-manager memo body is `Array<thesisSection>`. Exported so
 *  Phase 2 schemas (and any later phase) can reuse it instead of
 *  redeclaring the same union. */
// OpenAI strict structured-output requires every property to be in `required`.
// `.nullable()` keeps the key required but allows null; `.optional()` drops the
// key from `required` and trips the strict-mode schema check. At least one of
// `p` or `items` should be non-null per section — enforced via prompt, not
// schema.
export const thesisSection = z.object({
  h: z.string(),
  p: z.string().nullable(),
  items: z.array(z.string()).nullable(),
});

export type ThesisSection = z.infer<typeof thesisSection>;

/** Shared citation shape — kept in resources.ts (not the per-phase thesis
 *  schema) because the renderer reads citations off memo state, and memo
 *  state is the canonical persisted shape. Phase 1's thesis-schema
 *  re-exports its own `citation` for the LLM output contract; they agree. */
export const memoCitation = z.object({
  url: z.string(),
  title: z.string(),
});

export type MemoCitation = z.infer<typeof memoCitation>;

/** Structured memo body the renderer dispatches on. Mirrors the Claude Design
 *  handoff's `Thesis` shape so the same component renders fixture and live
 *  outputs identically. Fields are nullable while the memo is `pending` or
 *  `writing` and populated at the `published` transition. */
export const memoStateSchema = z.object({
  status: memoStatusSchema,
  agentName: z.string(),
  agentTeam: z.enum(["analyst", "research", "trade", "risk", "pm"]),
  ticker: z.string(),
  date: z.string(),
  phaseId: z.string(),
  label: z.string().nullable().default(null),
  headline: z.string().nullable().default(null),
  rating: z.string().nullable().default(null),
  body: z.array(thesisSection).nullable().default(null),
  metrics: z.record(z.string(), z.string()).nullable().default(null),
  startedAt: z.string().nullable().default(null),
  completedAt: z.string().nullable().default(null),
  errorMessage: z.string().nullable().default(null),
  /** Phase 1 investigative citations (FIX-612). Populated by analyst
   *  generators when they invoke `fetch` on a discovery URL; null on the
   *  cheap preset and on memos that never investigated. Renderer shows a
   *  "Sources" footer when non-empty. */
  citations: z.array(memoCitation).nullable().default(null),
  // Phase 2 InvestmentThesis extension. Only the research-manager memo
  // (`memos/p2/research-manager`) populates these; all other memos leave
  // them `null`. Read by Phase 3+ to reason about the debate's outcome.
  stance: z.enum(["bullish", "bearish", "neutral"]).nullable().default(null),
  conviction: z.number().min(0).max(1).nullable().default(null),
  keyRisks: z.array(z.string()).nullable().default(null),
  keyOpportunities: z.array(z.string()).nullable().default(null),
  unresolvedDisagreements: z.array(z.string()).nullable().default(null),
  // Phase 3 TradeProposal extension. Only the trader memo
  // (`memos/p3/trader`) populates these; all other memos leave them `null`.
  // Read by Phase 4+ to reason about the proposed trade.
  direction: z.enum(["long", "short", "flat"]).nullable().default(null),
  sizePct: z.number().nullable().default(null),
  stopPrice: z.number().nullable().default(null),
  targetPrice: z.number().nullable().default(null),
  holdingPeriod: z
    .enum(["days", "weeks", "months", "quarters"])
    .nullable()
    .default(null),
  invalidationCriteria: z.array(z.string()).nullable().default(null),
  dependsOn: z.array(z.string()).nullable().default(null),
  // Phase 4 RiskCritique / RiskAssessment extension. Persona memos populate
  // posture, raisedRisks, proposedAdjustments. The neutralRisk memo also
  // populates dismissedRisks. The riskAssessment memo populates the
  // criticalRisks / recommendedAdjustments / confidenceCalibration trio
  // plus dismissedRisks. Other memos leave all of these `null`.
  posture: z
    .enum(["aggressive", "conservative", "neutral"])
    .nullable()
    .default(null),
  raisedRisks: z
    .array(
      z.object({
        description: z.string(),
        severity: z.enum(["high", "medium", "low"]),
      }),
    )
    .nullable()
    .default(null),
  proposedAdjustments: z
    .object({
      sizing: z.enum(["larger", "smaller", "unchanged"]).nullable(),
      holdingPeriod: z.enum(["longer", "shorter", "unchanged"]).nullable(),
      invalidation: z.enum(["tighter", "looser", "unchanged"]).nullable(),
    })
    .nullable()
    .default(null),
  dismissedRisks: z
    .array(
      z.object({
        description: z.string(),
        reason: z.string(),
      }),
    )
    .nullable()
    .default(null),
  criticalRisks: z
    .array(
      z.object({
        description: z.string(),
        raisedBy: z.enum(["aggressive", "conservative"]),
        severity: z.enum(["high", "medium", "low"]),
      }),
    )
    .nullable()
    .default(null),
  recommendedAdjustments: z
    .object({
      sizing: z
        .object({
          direction: z.enum(["larger", "smaller", "unchanged"]),
          rationale: z.string(),
          attributedTo: z.enum(["aggressive", "conservative", "neutral"]),
        })
        .nullable(),
      holdingPeriod: z
        .object({
          direction: z.enum(["longer", "shorter", "unchanged"]),
          rationale: z.string(),
          attributedTo: z.enum(["aggressive", "conservative", "neutral"]),
        })
        .nullable(),
      invalidation: z
        .object({
          direction: z.enum(["tighter", "looser", "unchanged"]),
          rationale: z.string(),
          attributedTo: z.enum(["aggressive", "conservative", "neutral"]),
        })
        .nullable(),
    })
    .nullable()
    .default(null),
  confidenceCalibration: z
    .enum(["overconfident", "calibrated", "underconfident"])
    .nullable()
    .default(null),
  calibrationRationale: z.string().nullable().default(null),
  // Phase 5 PortfolioDecision extension. Only the portfolioManager memo
  // (`memos/p5/portfolio-manager`) populates these; all other memos leave
  // them `null`. `finalRating` is the design-mandated 5-tier scale, stored
  // separately from `rating` (which carries free-form header chip text).
  // `agreesWithTrader` is computed at commit time from `finalRating` direction
  // vs `trader.direction` — it's a derived field, not part of the LLM output.
  decisionSummary: z.string().nullable().default(null),
  finalRating: z
    .enum(["Sell", "Underweight", "Hold", "Overweight", "Buy"])
    .nullable()
    .default(null),
  decisionConfidence: z.number().min(0).max(1).nullable().default(null),
  acceptedAdjustments: z
    .object({
      sizing: z.object({ applied: z.boolean(), reasoning: z.string() }),
      holdingPeriod: z.object({ applied: z.boolean(), reasoning: z.string() }),
      invalidation: z.object({ applied: z.boolean(), reasoning: z.string() }),
    })
    .nullable()
    .default(null),
  keyDependencies: z.array(z.string()).nullable().default(null),
  upstreamReferences: z
    .object({
      analystMemos: z.array(z.string()),
      thesis: z.string(),
      tradeProposal: z.string(),
      riskAssessment: z.string(),
    })
    .nullable()
    .default(null),
  agreesWithTrader: z.boolean().nullable().default(null),
});

export type MemoState = z.infer<typeof memoStateSchema>;

export const memosCollection = defineResourceCollection({
  pattern: "memos/**",
  scope: "session",
  stateSchema: memoStateSchema,
  client: {
    // No projection declared — the renderer needs every field on the memo
    // state, so the identity default ships the whole state to the client.
    state: { read: true },
  },
});

/** Shared resource registry for handlers that touch the memos collection. */
export const memoResources = {
  memos: memosCollection,
} as const;
