/**
 * Type-level tests pinning the public `BlockContext` boundary (FIX-999).
 *
 * These live under `src/` on purpose — this package's `typecheck` runs `tsc -p
 * tsconfig.json`, whose `include` is `src/**` only, and vitest transpiles test
 * files without checking types. A `@ts-expect-error` in `test/` would be inert.
 * Same convention as the other `*.type-test.ts` files in this directory.
 *
 * What they pin down, and why it is worth a file:
 *
 * 1. **`stores` is absent, and `flow` admits exactly one member.** The whole
 *    injection seam rests on that premise — if the store layer or the whole flow
 *    instance ever became public, a capability could reach past the claim and
 *    dispatch gates and every guarantee the seam makes about identity would be
 *    bypassable without a cast. The premise used to be asserted by a probe no
 *    type-checker visited, which meant it could go stale silently. A directive
 *    that reports "unused" here is the signal that someone widened the boundary,
 *    and it fails CI.
 *
 *    `flow` is no longer an absence: FIX-1331 opened it to the copy's config bag
 *    and nothing else, so the assertions below are per MEMBER — negative on the
 *    instance's actions, task, internal, resources and id, positive on `config`.
 *    That is strictly more precise than the all-or-nothing assertion it replaces.
 *    Re-aim these when the boundary moves; deleting them reopens the door.
 *
 * 2. **The runtime is reachable without a type assertion.** A capability helper
 *    calls the verbs through the declared member. There is deliberately no cast
 *    anywhere in this file: if reaching the runtime required one, this file would
 *    not compile, which is the compile-time half of the deliverable.
 *
 * 3. **Dispatch is not a named member of the context.** A block that sends a
 *    dispatch is a `dispatcher()`, and the runtime's operation is reachable only
 *    under the `DISPATCH_SEAM` symbol through `dispatchThroughSeam`. If a
 *    `dispatchMessage`-shaped verb ever appears on the public context, the set
 *    of blocks that dispatch stops being knowable at definition time, and a
 *    directive below reports "unused". The request host has no start verb of
 *    its own: a child is started only by a dispatch.
 */
import type { BlockContext } from "../block";
import type { AnyResourceRef } from "../resource";
import type { RequestHost } from "../request-host";
import { requireRequestHost } from "../request-host";
import { DISPATCH_SEAM, dispatchThroughSeam, type DispatchOutcome } from "../dispatch";

declare const ctx: BlockContext;

// ── 1. The boundary: the store layer is off, and `flow` is one member ─────
// If any directive below reports "unused", `BlockContext` grew a member this
// seam exists to keep off it. Do not delete the directive — fix the widening.

// @ts-expect-error `stores` is not on the public BlockContext, by design.
ctx.stores;

// The one member of the flow instance a block may read (FIX-1331). This is the
// POSITIVE half: it fails if someone removes the narrowed view entirely.
const flowConfig: Readonly<Record<string, unknown>> = ctx.flow.config;
void flowConfig;

// And the negative half, member by member. Reaching any of these would let a
// block step past the claim and dispatch gates built onto them.

// @ts-expect-error the flow's action map is not reachable from a block.
void ctx.flow.actions;

// @ts-expect-error nor its task entries, which are gated per board.
void ctx.flow.task;

// @ts-expect-error nor its internal entries.
void ctx.flow.internal;

// @ts-expect-error nor its resource declarations — `ctx.resources` is the door.
void ctx.flow.resources;

// @ts-expect-error nor the instance's own address.
void ctx.flow.id;

// A block that declares a `flowConfigSchema` reads the shape it declared, with
// no annotation and no flow named anywhere.
declare const seatCtx: BlockContext<
  Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Record<string, unknown>,
  Record<string, AnyResourceRef>, Record<string, unknown>, unknown, undefined,
  {}, Record<string, unknown>, Record<string, unknown>,
  { harness: string; model: string }
>;
const harness: string = seatCtx.flow.config.harness;
void harness;

// @ts-expect-error a knob the block did not declare is not on its view.
void seatCtx.flow.config.temperature;

// A block that declared nothing reads the open record: the value is `unknown`,
// which is the honest type for a bag it never described.
const undeclared: unknown = ctx.flow.config.model;
void undeclared;

// @ts-expect-error and `unknown` cannot be used without parsing it first.
void ctx.flow.config.model.length;

// The bag is read-only at the top level, matching the runtime freeze.
// @ts-expect-error `config` is a read-only member.
ctx.flow.config = {};

// ── 2. The seam: the runtime is reachable, with no assertion in this file ──

// The member is DECLARED on the public context. This is the line that fails if
// someone removes it — `requireRequestHost` alone would not catch that, because
// its parameter is structural and a context *missing* an optional property still
// satisfies it.
const declared: RequestHost | undefined = ctx.requestHost;
void declared;

const host: RequestHost = requireRequestHost(ctx);

// Settlement addresses the stamped row and takes no claim.
void host.settleParentTask({ outcome: "complete", output: { ok: true } });

// @ts-expect-error the fence ticket is stamped at spawn, not passed in.
void host.settleParentTask({ outcome: "complete", claim: { attempt: 2 } });

// The parent row crosses untyped — `core` cannot name orchestration's schema.
const row: Promise<unknown> = host.parentTask();
void row;

// Liveness is optional on the bundle: the gate removes it at construction.
void host.livenessOf?.(["req_a", "req_b"]);

// @ts-expect-error liveness is batch-shaped; a bare id is not the surface.
void host.livenessOf?.("req_a");

// ── 3. Dispatch: a symbol slot, not a verb ────────────────────────────────

// @ts-expect-error dispatch is not a named member of the context.
void ctx.dispatchMessage;

// @ts-expect-error nor as a start verb on the context.
void ctx.startDetached;

// @ts-expect-error and not on the request host either — a child is started by a dispatch.
void host.startDetached;

// The slot is declared under the symbol, and only there.
const seam = ctx[DISPATCH_SEAM];
void seam;

// The substrate call takes the whole spec, and identity is never a field of it.
const dispatched: Promise<DispatchOutcome> = dispatchThroughSeam(ctx, {
  type: "internal",
  action: "wake",
  session: { id: "s_epic" },
  payload: { reason: "answered" },
  from: "wake-epic"
});
void dispatched;

void dispatchThroughSeam(ctx, {
  type: "internal",
  action: "receive-reply",
  session: { from: true },
  payload: {},
  from: "reply-to-sender"
});

void dispatchThroughSeam(ctx, {
  type: "internal",
  action: "wake",
  // @ts-expect-error a caller supplies the target session, never the principal.
  session: { id: "s_epic", userId: "u_other" },
  payload: {},
  from: "wake-epic"
});

void dispatchThroughSeam(ctx, {
  // @ts-expect-error a block cannot dispatch a type whose trust it does not hold.
  type: "webhook",
  action: "github/push",
  session: { key: "k" },
  payload: {},
  from: "forged"
});

// The outcome is a discriminated union, so a refusal cannot be read as a start.
declare const settled: DispatchOutcome;
if (settled.ok) {
  const dispatchedIds: [string, string, boolean] = [settled.sessionId, settled.requestId, settled.adopted];
  void dispatchedIds;
} else {
  const dispatchRefusal: string = settled.refused;
  void dispatchRefusal;
}

// @ts-expect-error a refusal carries no session id — the branch must be taken.
void settled.sessionId;
