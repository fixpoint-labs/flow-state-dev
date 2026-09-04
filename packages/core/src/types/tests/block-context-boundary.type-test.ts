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
 * 1. **`stores` and `flow` are absent from the public context.** The whole
 *    injection seam rests on that premise — if either ever became public, a
 *    capability could reach the store layer directly and every guarantee the seam
 *    makes about identity would be bypassable without a cast. The premise used to
 *    be asserted by a probe no type-checker visited, which meant it could go stale
 *    silently. A directive that reports "unused" here is the signal that someone
 *    widened the boundary, and it fails CI.
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
 *    directive below reports "unused". (`startDetached` stays on the request
 *    host this cycle, behind the fence, and takes no new callers.)
 */
import type { BlockContext } from "../block";
import type { RequestHost, StartDetachedResult } from "../request-host";
import { requireRequestHost } from "../request-host";
import { DISPATCH_SEAM, dispatchThroughSeam, type DispatchOutcome } from "../dispatch";

declare const ctx: BlockContext;

// ── 1. The boundary: neither handle is on the public context ──────────────
// If either directive reports "unused", `BlockContext` grew a member this seam
// exists to keep off it. Do not delete the directive — fix the widening.

// @ts-expect-error `stores` is not on the public BlockContext, by design.
ctx.stores;

// @ts-expect-error `flow` is not on the public BlockContext, by design.
ctx.flow;

// ── 2. The seam: the runtime is reachable, with no assertion in this file ──

// The member is DECLARED on the public context. This is the line that fails if
// someone removes it — `requireRequestHost` alone would not catch that, because
// its parameter is structural and a context *missing* an optional property still
// satisfies it.
const declared: RequestHost | undefined = ctx.requestHost;
void declared;

const host: RequestHost = requireRequestHost(ctx);

declare const started: StartDetachedResult;

// Start-or-adopt takes a routing seed and never a session id.
void host.startDetached({ seed: { topic: "review" }, input: { n: 1 } });

// @ts-expect-error no session id is nameable on the seam.
void host.startDetached({ sessionId: "s_other", seed: { topic: "review" } });

// @ts-expect-error identity is closed over, never a parameter.
void host.startDetached({ seed: { topic: "review" }, userId: "u_other" });

// Server-derived provenance is its own channel, distinct from the caller's bag.
void host.startDetached({
  seed: { topic: "review" },
  provenance: { taskId: "task_7f3" }
});

// @ts-expect-error a provenance bag with no facts in it is not provenance.
void host.startDetached({ seed: { topic: "review" }, provenance: {} });

// @ts-expect-error the channel is closed — adding a fact to it is a decision.
void host.startDetached({ seed: { topic: "r" }, provenance: { taskId: "t", boardId: "b1" } });

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

// The result is a discriminated union, so a refusal cannot be read as a start.
if (started.ok) {
  const ids: [string, string, boolean] = [started.sessionId, started.requestId, started.adopted];
  void ids;
} else {
  const refusal: string = started.refused;
  void refusal;
}

// @ts-expect-error a refusal carries no session id — the branch must be taken.
void started.sessionId;

// ── 3. Dispatch: a symbol slot, not a verb ────────────────────────────────

// @ts-expect-error dispatch is not a named member of the context.
void ctx.dispatchMessage;

// @ts-expect-error nor under the detached name.
void ctx.startDetached;

// The slot is declared under the symbol, and only there.
const seam = ctx[DISPATCH_SEAM];
void seam;

// The substrate call takes the whole spec, and identity is never a field of it.
const dispatched: Promise<DispatchOutcome> = dispatchThroughSeam(ctx, {
  type: "internal",
  target: "wake",
  session: { id: "s_epic" },
  payload: { reason: "answered" },
  from: "wake-epic"
});
void dispatched;

void dispatchThroughSeam(ctx, {
  type: "internal",
  target: "wake",
  // @ts-expect-error a caller supplies the target session, never the principal.
  session: { id: "s_epic", userId: "u_other" },
  payload: {},
  from: "wake-epic"
});

void dispatchThroughSeam(ctx, {
  // @ts-expect-error a block cannot dispatch a type whose trust it does not hold.
  type: "webhook",
  target: "github/push",
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
