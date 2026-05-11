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
});

export type MemoState = z.infer<typeof memoStateSchema>;

export const memosCollection = defineResourceCollection({
  pattern: "memos/**",
  scope: "session",
  stateSchema: memoStateSchema,
  client: {
    // No projection declared — the renderer needs every field on the memo
    // state, so the identity default ships the whole state to the client.
  },
});

/** Shared resource registry for handlers that touch the memos collection. */
export const memoResources = {
  memos: memosCollection,
} as const;
