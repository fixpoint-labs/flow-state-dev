// ---------------------------------------------------------------------------
// Knowledge Hub lab — the capture surface (FIX-882).
//
// A single `logActivity` MCP tool hands a piece of the owner's mental activity
// (a thought, journal fragment, task, memory, goal, or decision) into the
// user-scoped `inbox` collection, and a `listInbox` read-back inspects what's
// pending. Capture is strictly mechanical — the deterministic mailroom stamps a
// wall-clock time and computes a sha256 fingerprint over the full capture tuple
// for transport-retry idempotency. No model call runs at capture time; all
// classification and near-duplicate judgment is the FIX-883 sweeper's job.
//
// Handlers declare `resources: { inbox }` directly for a typed `ctx`
// (the labs/trading-desk form), no capability layer. Auth is a bearer secret
// read from `KH_MCP_SECRET`: the per-flow resolver is ALWAYS defined and fails
// closed — a bearer resolver when the secret is set, otherwise a resolver that
// throws, so `logActivity`/`listInbox` are unreachable over any HTTP transport
// (MCP or the generic action routes) until the secret is provided. The CLI is
// unaffected: `fsdev run` invokes the action in-process as its built-in
// `cli-user` principal and never goes through a transport resolver.
// ---------------------------------------------------------------------------

import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createBearerSecretPrincipalResolver } from "@flow-state-dev/engine";
import {
  activityKindSchema,
  inboxCollection,
  inboxIdFromPath,
  inboxKey,
  type InboxRecord,
} from "./inbox";
import { computeFingerprint } from "./mailroom";

/** Reject a whitespace-only string WITHOUT transforming it — the stored fields
 *  stay verbatim (`.trim().min(1)` would mutate, breaking the verbatim contract). */
const nonBlank = (s: string) => s.trim().length > 0;

/** The per-item shape `listInbox` returns — the fields an inspector needs, not
 *  the full record (the fingerprint and swept lifecycle stay internal). */
const inboxItemSummarySchema = z.object({
  id: z.string(),
  kind: activityKindSchema,
  content: z.string(),
  context: z.string(),
  capturedAt: z.string(),
  status: z.enum(["pending", "swept"]),
});

const logActivity = handler({
  name: "logActivity",
  inputSchema: z.object({
    kind: activityKindSchema.describe(
      "What sort of mental activity this is. Best guess — a later review pass re-classifies."
    ),
    content: z
      .string()
      .min(1)
      .max(20_000)
      .refine(nonBlank, "content must not be blank")
      .describe(
        "The activity itself, verbatim — the thought, task, memory, goal, or decision as the owner expressed it."
      ),
    context: z
      .string()
      .min(1)
      .max(20_000)
      .refine(nonBlank, "context must not be blank")
      .describe(
        "Required. The situation this arose in: what was being discussed, worked on, or happening when it came up. Summarize the surrounding conversation or activity."
      ),
    occurredAt: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .default(null)
      .describe("When the activity itself happened, if not now (e.g. a memory of a past event). ISO 8601."),
    source: z
      .string()
      .max(500)
      .nullable()
      .default(null)
      .describe("Where this was captured from (client or conversation hint). Short label, not a transcript."),
  }),
  outputSchema: z.object({
    id: z.string(),
    capturedAt: z.string(),
    deduplicated: z.boolean(),
  }),
  resources: { inbox: inboxCollection },
  execute: async (input, ctx) => {
    const fingerprint = computeFingerprint(input);
    const key = inboxKey(input.kind, fingerprint);

    // Point lookup on the fingerprint-derived key (lazy collection → loads only
    // this key, no prefix scan). A still-pending record with the same tuple is a
    // transport retry: return its id, write nothing.
    const existing = await ctx.resources.inbox.getOptional(key);
    if (existing && existing.state.status === "pending") {
      return {
        id: inboxIdFromPath(existing.path),
        capturedAt: existing.state.capturedAt,
        deduplicated: true,
      };
    }

    // Absent → create. Swept (already placed by the sweeper) → replace with a
    // fresh pending record: re-capturing after a sweep is a new mental event.
    // The retry guarantee is deliberately bounded to the pending window.
    const capturedAt = new Date().toISOString();
    const record: InboxRecord = {
      kind: input.kind,
      content: input.content,
      context: input.context,
      capturedAt,
      occurredAt: input.occurredAt,
      source: input.source,
      status: "pending",
      fingerprint,
    };
    const ref = await ctx.resources.inbox.create(key, record, { replace: existing !== undefined });
    return { id: inboxIdFromPath(ref.path), capturedAt, deduplicated: false };
  },
});

const listInbox = handler({
  name: "listInbox",
  inputSchema: z.object({
    kind: activityKindSchema.nullable().default(null).describe("Only this kind (omit for all)."),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  outputSchema: z.object({
    items: z.array(inboxItemSummarySchema),
    totalPending: z.number(),
    oldestPendingCapturedAt: z.string().nullable(),
  }),
  resources: { inbox: inboxCollection },
  execute: async (input, ctx) => {
    // A `kind` filter narrows via the key prefix at the source (BP-033); no
    // filter enumerates the whole inbox (a legitimate full read here).
    const refs = input.kind
      ? await ctx.resources.inbox.list(`${input.kind}/`)
      : await ctx.resources.inbox.list();

    // Swept records stay stored for the sweeper but are never listed here, and
    // never consume `limit`. Newest first by capturedAt (ISO strings sort
    // lexicographically for a fixed-offset wall clock).
    const pending = refs
      .filter((r) => r.state.status === "pending")
      .sort((a, b) => b.state.capturedAt.localeCompare(a.state.capturedAt));

    const items = pending.slice(0, input.limit).map((r) => ({
      id: inboxIdFromPath(r.path),
      kind: r.state.kind,
      content: r.state.content,
      context: r.state.context,
      capturedAt: r.state.capturedAt,
      status: r.state.status,
    }));

    return {
      items,
      totalPending: pending.length,
      // Oldest is the last element after the newest-first sort.
      oldestPendingCapturedAt: pending.length > 0 ? pending[pending.length - 1].state.capturedAt : null,
    };
  },
});

const knowledgeHubFlow = defineFlow({
  kind: "knowledge-hub",
  authentication: {
    requireUser: true,
    // Always defined — fail closed. With no per-flow resolver, HTTP transports
    // fall back to the host's body-userId resolver (caller-controlled — BP-031).
    // The throwing resolver is CONSTRUCTED (not invoked) at import time, so local
    // dev / CI import stays safe; it only throws when an HTTP request arrives
    // without KH_MCP_SECRET set. `fsdev run` supplies its principal in-process
    // and never reaches this.
    resolvePrincipal: process.env.KH_MCP_SECRET
      ? createBearerSecretPrincipalResolver({
          secret: process.env.KH_MCP_SECRET,
          principal: { userId: "owner" }, // the single personal user the inbox binds to
        })
      : () => {
          throw new Error("knowledgeHub: HTTP access requires KH_MCP_SECRET");
        },
  },
  mcp: { enabled: true },
  actions: {
    logActivity: {
      block: logActivity,
      description:
        "Log a piece of the owner's mental activity — a thought, journal fragment, task, memory, goal, or decision — into the knowledge inbox. Use whenever the owner says something worth remembering or acting on. Always include the context it arose in.",
    },
    listInbox: {
      block: listInbox,
      description:
        "Inspect the knowledge inbox: pending captured items, counts, and how long the oldest has been waiting.",
    },
  },
  resources: { inbox: inboxCollection },
});

export default knowledgeHubFlow({ id: "default" });
