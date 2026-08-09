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
 */
import type { BlockContext } from "../block";
import type { RequestHost, StartDetachedResult } from "../request-host";
import { requireRequestHost } from "../request-host";

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
