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
});

export type MemoState = z.infer<typeof memoStateSchema>;

export const memosCollection = defineResourceCollection({
  pattern: "memos/**",
  scope: "session",
  stateSchema: memoStateSchema,
  client: {
    content: { read: true, prefetch: true },
    state: { read: true },
    // Project the full memo state into `clientData` so the document area
    // renders structured body sections, the metrics row, and any error
    // message without round-tripping content fetches. Without this the
    // get-collection-item-state endpoint returns `{ topic }` only and the
    // theses pane has nothing to render. Body payload is structured prose
    // (not arbitrary content) so the projection size stays bounded.
    data: (state) => state,
  },
});

/** Shared resource registry for handlers that touch the memos collection. */
export const memoResources = {
  memos: memosCollection,
} as const;
