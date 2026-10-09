/**
 * Type-level test: a partition function cannot reach request input (BP-031).
 *
 * `partitionBy` decides whose rows a run touches, so its argument carries the
 * running session's server-set identity and no handle a caller writes through:
 * not the parent's `input`, not the sequencer's, the block's own or a target's
 * state ref (each has `.input`), not request state. If any of them is added to
 * `TaskPartitionContext`, a `@ts-expect-error` below reports "unused" and
 * typecheck fails. The runtime half is `test/collection/partitioned-ledger.test.ts`.
 *
 * Lives under `src/` because this package's typecheck includes `src/**` only.
 */
import type { TaskPartitionContext, TaskPartitionFn } from "../partition";

declare const view: TaskPartitionContext;

// ── What it does carry ──────────────────────────────────────────────────────
const sessionId: string = view.sessionId;
const userId: string = view.userId;
const orgId: string | undefined = view.orgId;
const tenantId: string | undefined = view.tenantId;
const lineageId: string | undefined = view.lineageId;

// ── What it must not carry ──────────────────────────────────────────────────
// @ts-expect-error — the parent block's input is caller input.
void view.parent;
// @ts-expect-error — the sequencer's state ref carries `.input`.
void view.sequencer;
// @ts-expect-error — the block's own state ref carries `.input`.
void view.self;
// @ts-expect-error — a target's state ref carries `.input`.
void view.getTarget;
// @ts-expect-error — request state.
void view.request;
// @ts-expect-error — session state, which the public create persists from a caller.
void view.session;

// A partition function gets only this view.
const byConversation: TaskPartitionFn = (ctx) => `${ctx.userId}/${ctx.sessionId}`;

export { sessionId, userId, orgId, tenantId, lineageId, byConversation };
