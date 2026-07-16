// ---------------------------------------------------------------------------
// Conversation contexts (FIX-897): durable topic grouping for MCP captures.
//
// A context is opened explicitly via `createContext` (short description + id)
// or lazily when `logActivity` references an unknown id. Inbox rows carry
// `contextId`; the MCP transport maps that id to framework `sessionId` so
// related captures share one session across stateless tools/call invocations.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { defineResourceCollection } from "@flow-state-dev/core";
import { getPatternPrefix } from "@flow-state-dev/core/types";

export const contextRecordSchema = z.object({
  /** Short topic label from create_context; null when lazy-opened at capture time. */
  description: z.string().nullable().default(null),
  openedAt: z.string(),
  lazyOpened: z.boolean().default(false),
});
export type ContextRecord = z.infer<typeof contextRecordSchema>;

export const contextsCollection = defineResourceCollection({
  pattern: "contexts/**",
  scope: "user",
  flowIsolation: false,
  stateSchema: contextRecordSchema,
  prefetchMode: "lazy",
  llmReadable: true,
  llmWritable: false,
});

export const CONTEXTS_PREFIX = getPatternPrefix(contextsCollection.pattern);

/** Bare storage key for a context id (pattern prefix is injected on create). */
export function contextKey(contextId: string): string {
  return contextId;
}

export function contextIdFromPath(path: string, prefix: string = CONTEXTS_PREFIX): string {
  const lead = `${prefix}/`;
  return path.startsWith(lead) ? path.slice(lead.length) : path;
}
