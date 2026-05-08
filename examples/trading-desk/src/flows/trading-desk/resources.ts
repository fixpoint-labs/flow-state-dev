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

const thesisSection = z.union([
  z.object({
    h: z.string(),
    p: z.string(),
    items: z.array(z.string()).optional(),
  }),
  z.object({
    h: z.string(),
    items: z.array(z.string()),
    p: z.string().optional(),
  }),
]);

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
});

export type MemoState = z.infer<typeof memoStateSchema>;

export const memosCollection = defineResourceCollection({
  pattern: "memos/**",
  scope: "session",
  stateSchema: memoStateSchema,
  client: {
    // Project the full memo state so the document area renders structured
    // body sections, the metrics row, and any error message without
    // round-tripping content fetches. The body payload is structured prose
    // (not arbitrary content) so the projection size stays bounded.
    data: (state) => ({
      status: state.status,
      agentName: state.agentName,
      agentTeam: state.agentTeam,
      phaseId: state.phaseId,
      ticker: state.ticker,
      date: state.date,
      label: state.label,
      headline: state.headline,
      rating: state.rating,
      body: state.body,
      metrics: state.metrics,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      errorMessage: state.errorMessage,
      stance: state.stance,
      conviction: state.conviction,
      keyRisks: state.keyRisks,
      keyOpportunities: state.keyOpportunities,
      unresolvedDisagreements: state.unresolvedDisagreements,
    }),
  },
});

/** Shared resource registry for handlers that touch the memos collection. */
export const memoResources = {
  memos: memosCollection,
} as const;
