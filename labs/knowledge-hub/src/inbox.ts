// ---------------------------------------------------------------------------
// The inbox: a user-scoped staging collection for captured mental activity
// (FIX-882).
//
// Every `logActivity` capture lands here first — typed, dated, and
// context-tagged — before the FIX-883 sweeper reviews it in batches and files
// it into long-term memory. This is deliberately NOT `@flow-state-dev/memory`:
// that package's working-memory tier is session-scoped (invisible to a cron
// sweeper in another process), decays/evicts over a turn counter, and captures
// via an LLM. A sweep-later inbox must be durable, wall-clock aged, and never
// silently drop a pending item — so it is a plain lab-local resource collection.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { defineResourceCollection } from "@flow-state-dev/core";
import { getPatternPrefix } from "@flow-state-dev/core/types";

/**
 * What sort of mental activity was captured. A caller-supplied hint, not a
 * durable classification — the FIX-883 sweeper re-classifies with batch
 * context, so a wrong guess here is cheap.
 */
export const activityKindSchema = z.enum([
  "thought", // something came to mind
  "journal", // a journal fragment / diary-style entry
  "task", // something to do
  "memory", // something to remember (happened in the past)
  "goal", // an aspiration / outcome to work toward
  "decision", // something was decided
  "topic", // a subject / area of interest to follow or come back to
]);
export type ActivityKind = z.infer<typeof activityKindSchema>;

/** State shape for one inbox record. */
export const inboxRecordSchema = z.object({
  kind: activityKindSchema,
  /**
   * Verbatim capture — never mutated, so the sweeper's re-classification can
   * never destroy information. Normalization exists only inside the
   * fingerprint (see mailroom.ts).
   */
  content: z.string(),
  /**
   * Required: the situation the activity arose in (what conversation, task, or
   * trigger). The calling LLM is the only party with the conversational
   * context, so it is contractually the context source.
   */
  context: z.string(),
  /** Server-stamped ISO wall-clock capture time (mailroom). */
  capturedAt: z.string(),
  /**
   * Caller-supplied time the activity refers to (e.g. a memory of last
   * Tuesday), if different from capture time. Absence means "refers to now".
   */
  occurredAt: z.string().nullable().default(null),
  /** Free-form origin hint (client name, conversation title). */
  source: z.string().nullable().default(null),
  /**
   * Sweep lifecycle. FIX-882 only ever writes "pending"; "swept" is declared
   * now so the FIX-883 sweeper can transition records without a schema
   * migration (BP-030).
   */
  status: z.enum(["pending", "swept"]).default("pending"),
  /**
   * sha256 over the normalized capture tuple (kind, content, context,
   * occurredAt, source) — transport-retry identity; also the key suffix.
   */
  fingerprint: z.string(),
});
export type InboxRecord = z.infer<typeof inboxRecordSchema>;

/**
 * User-scoped so captures survive stateless MCP calls and are visible to the
 * FIX-883 cron sweeper in another process (same rationale as the
 * knowledge-base concept corpus). `flowIsolation: false` per BP-027. No
 * eviction: pending items must never silently drop.
 */
export const inboxCollection = defineResourceCollection({
  pattern: "inbox/**",
  scope: "user",
  flowIsolation: false,
  stateSchema: inboxRecordSchema,
  /**
   * Lazy is load-bearing: the default eager mode hydrates the entire `inbox/`
   * prefix into the execution context before `execute` runs, which would make
   * the capture path O(n) and defeat the fingerprint point lookup.
   */
  prefetchMode: "lazy",
  llmReadable: true,
  llmWritable: false, // writes go through logActivity, not the generic resource tools
});

/** The storage-key prefix injected by the collection pattern (`inbox`). */
export const INBOX_PREFIX = getPatternPrefix(inboxCollection.pattern);

/**
 * Bare key (the framework auto-prepends the pattern prefix):
 * `<kind>/<fingerprint>`. Kind-first so `list("<kind>/")` filters at the source
 * (BP-033); fingerprint-keyed so exact-retry dedup is a single point lookup,
 * not a collection scan. `capturedAt` stays a state field — `listInbox` sorts
 * on it in memory (a full enumeration of the inbox is legitimate there).
 */
export function inboxKey(kind: ActivityKind, fingerprint: string): string {
  return `${kind}/${fingerprint}`;
}

/**
 * Recover the record id (the bare key) from a stored path by stripping the
 * injected `inbox/` prefix (mirrors `conceptIdFromPath` in
 * examples/knowledge-base/src/concepts.ts).
 */
export function inboxIdFromPath(path: string, prefix: string = INBOX_PREFIX): string {
  const lead = `${prefix}/`;
  return path.startsWith(lead) ? path.slice(lead.length) : path;
}
