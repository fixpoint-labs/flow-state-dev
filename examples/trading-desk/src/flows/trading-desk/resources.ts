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
  label: z.string().nullable(),
  headline: z.string().nullable(),
  rating: z.string().nullable(),
  body: z.array(thesisSection).nullable(),
  metrics: z.record(z.string(), z.string()).nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  errorMessage: z.string().nullable(),
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
