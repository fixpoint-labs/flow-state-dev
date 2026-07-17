// ---------------------------------------------------------------------------
// Knowledge Hub lab — the capture surface (FIX-882).
//
// A single `logActivity` MCP tool hands a piece of the owner's mental activity
// (a thought, journal fragment, task, memory, goal, decision, or topic of
// interest) into the user-scoped `inbox` collection, and a `listInbox` read-back
// inspects what's pending. Capture is strictly mechanical — the deterministic mailroom stamps a
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

/**
 * Session state IS the conversation record — one source of truth for the
 * conversation topic (no separate `conversations` collection).
 * `createConversation` writes the description here; `null` for a session that
 * was auto-vivified by a `logActivity` whose conversation was never explicitly
 * opened (BP-023 nullable + default).
 */
const sessionStateSchema = z.object({
  description: z.string().nullable().default(null),
});

/** The per-item shape `listInbox` returns — the fields an inspector needs, not
 *  the full record (the fingerprint and swept lifecycle stay internal). */
const inboxItemSummarySchema = z.object({
  id: z.string(),
  kind: activityKindSchema,
  content: z.string(),
  situation: z.string(),
  // Nullable so a legacy record captured before conversationId existed lists as
  // ungrouped rather than failing output validation (BP-030). New records
  // always carry a real id.
  conversationId: z.string().nullable(),
  capturedAt: z.string(),
  status: z.enum(["pending", "swept"]),
});

const logActivity = handler({
  name: "logActivity",
  inputSchema: z.object({
    conversationId: z
      .string()
      .min(1)
      // Bounds the stored conversationId to a sane length. NOTE: this does NOT
      // bound the session KEY the MCP adapter derives from this field — that raw
      // value reaches `host.dispatch` (which persists a session record) BEFORE
      // this schema runs, so an oversized id still writes an oversized-keyed
      // session before being rejected here. Hardening caller-supplied session
      // keys is a deliberate promotion Non-Goal (spec §8). 200 fits a minted
      // `conv_…` id (~35 chars) with headroom.
      .max(200)
      .describe(
        "The conversation id returned by createConversation. Required — groups this capture into that conversation. If you have not opened a conversation, call createConversation first."
      ),
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
    situation: z
      .string()
      .min(1)
      .max(20_000)
      .refine(nonBlank, "situation must not be blank")
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
      .describe("Where this was captured from (client or conversation hint). Short label, not a transcript. If the endpoint tags an installation, that value is authoritative and any value you set here is overridden — so you can omit it."),
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

    // Absent → create; swept (already placed by the sweeper) → replace with a
    // fresh pending record (re-capturing after a sweep is a new mental event).
    // Always `replace: true` on the write: two concurrent identical captures can
    // both miss the getOptional above and reach here — replace/upsert semantics
    // make the later write win on the same fingerprint-derived key (end state is
    // exactly one record) rather than the loser throwing on an already-created
    // key. Both may then report `deduplicated: false`; that inaccuracy is
    // accepted — no locking or CAS (BP-038). The retry guarantee is deliberately
    // bounded to the pending window.
    const capturedAt = new Date().toISOString();
    const record: InboxRecord = {
      kind: input.kind,
      content: input.content,
      situation: input.situation,
      conversationId: input.conversationId,
      capturedAt,
      occurredAt: input.occurredAt,
      source: input.source,
      status: "pending",
      fingerprint,
    };
    const ref = await ctx.resources.inbox.create(key, record, { replace: true });
    return { id: inboxIdFromPath(ref.path), capturedAt, deduplicated: false };
  },
});

const createConversation = handler({
  name: "createConversation",
  inputSchema: z.object({
    description: z
      .string()
      .min(1)
      .max(2_000)
      .refine(nonBlank, "description must not be blank")
      .describe(
        "A short description or topic for this conversation — what it is about. Stored with the conversation so later passes know what was discussed."
      ),
  }),
  outputSchema: z.object({
    conversationId: z
      .string()
      .describe("The conversation id to pass as `conversationId` on subsequent logActivity captures."),
  }),
  // Types `ctx.session` so the topic description is a typed session field.
  // (The "session record is the conversation record" rationale lives on the
  // flow-level `session` config and the action's `mcp.session` wiring.)
  sessionStateSchema,
  execute: async (input, ctx) => {
    await ctx.session.setState({ description: input.description });
    return { conversationId: ctx.session.identity.id };
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

    const items = pending.slice(0, input.limit).map((r) => {
      // Dual-read legacy rows (BP-030): before FIX-897's rename the per-capture
      // text was stored under `context` (now `situation`), and rows had no
      // `conversationId`. Map the old field forward so a single pre-rename
      // capture never makes the whole inbox unreadable via output validation.
      const legacy = r.state as {
        situation?: string;
        context?: string;
        conversationId?: string | null;
      };
      return {
        id: inboxIdFromPath(r.path),
        kind: r.state.kind,
        content: r.state.content,
        situation: legacy.situation ?? legacy.context ?? "",
        conversationId: legacy.conversationId ?? null,
        capturedAt: r.state.capturedAt,
        status: r.state.status,
      };
    });

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
  // Session state doubles as the per-conversation record (description).
  session: { stateSchema: sessionStateSchema },
  actions: {
    createConversation: {
      block: createConversation,
      description:
        "Open a conversation (a topic) before logging activity. Supply a short description of what the conversation is about; returns a conversationId to pass on every subsequent logActivity call so related captures are grouped together.",
      // Mint a fresh `conv_…` session id for this call and hand it back as the
      // conversationId — the session record becomes the conversation record.
      mcp: { session: "conv_*" },
    },
    logActivity: {
      block: logActivity,
      description:
        "Log a piece of the owner's mental activity — a thought, journal fragment, task, memory, goal, decision, or topic of interest — into the knowledge inbox. Use whenever the owner says something worth remembering or acting on. Always include the situation it arose in, and the conversationId from createConversation.",
      // Route this capture into the session named by the caller's `conversationId`,
      // so captures sharing a conversationId land in one session and are grouped.
      mcp: { session: { fromInput: "conversationId" } },
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
