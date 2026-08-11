/**
 * Which milestone a detached start waits for (FIX-982).
 *
 * `createDetachedStartOperation` is the seam a block reaches when it hands work
 * to a Workstream, and its caller does something irreversible on the result: the
 * task board releases the claim on the row it just handed over. Nobody holds the
 * child's `finished`, so anything that fails after this resolves fails into a
 * promise with no observer — the row stays `in_progress` and only lease recovery
 * eventually notices.
 *
 * So the milestone it waits for has to be the one past which failure cannot be
 * silent. That is **execution**, not acceptance: a request can be registered and
 * discoverable and still die in setup, writing no terminal record and
 * deregistering its entry on the way out. The window itself is exercised against
 * the real runtime in `transports/in-process-acceptance.test.ts`; what is pinned
 * here is which signal this seam consumes, and that a deferred start still gets
 * the weaker one rather than nothing.
 */
import { describe, it, expect } from "vitest";
import { createDetachedStartOperation } from "../../src/context/detached-start-operation";
import type { DispatchHandle, InboundTransportHost } from "../../src/transports/types";

const SPEC = {
  sessionId: "s_child",
  input: { boardId: "b", taskId: "t1" },
  actionName: "board-workstream-runner",
  flowKind: "acceptance",
  userId: "u_1"
};

/** A host that hands back exactly the milestones the test wants to offer. */
function hostReturning(handle: Partial<DispatchHandle>) {
  const dispatch = (): DispatchHandle =>
    ({
      requestId: "req_child",
      finished: new Promise<never>(() => {}),
      ...handle
    }) as DispatchHandle;
  return { dispatch } as Pick<InboundTransportHost, "dispatch">;
}

describe("a detached start waits for the child to be executing", () => {
  it("waits for started, not for the earlier acceptance", async () => {
    let settleStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      settleStarted = resolve;
    });
    const start = createDetachedStartOperation({
      host: hostReturning({ accepted: Promise.resolve(), started })
    });

    const pending = start(SPEC);
    // Acceptance has already resolved. If this seam were satisfied by it, the
    // parent would be free to release its claim while the child's setup is
    // still ahead of it — which is the whole defect.
    const early = await Promise.race([
      pending.then(() => "returned" as const),
      new Promise<"waiting">((r) => setTimeout(() => r("waiting"), 50))
    ]);
    expect(early).toBe("waiting");

    settleStarted();
    await expect(pending).resolves.toEqual({ requestId: "req_child" });
  });

  it("propagates a setup failure instead of reporting the child started", async () => {
    const start = createDetachedStartOperation({
      host: hostReturning({
        accepted: Promise.resolve(),
        started: Promise.reject(new Error("session store unavailable"))
      })
    });

    await expect(start(SPEC)).rejects.toThrow(/session store unavailable/);
  });

  it("falls back to acceptance when the start is deferred past this call", async () => {
    // A queued or externally dispatched child starts after this returns, so it
    // offers no execution signal. Waiting for one would mean waiting out the
    // queue, which is the launching request blocking on the work it detached.
    // The hand-off gap that leaves is FIX-1070's, unchanged.
    let settleAccepted: () => void = () => {};
    const accepted = new Promise<void>((resolve) => {
      settleAccepted = resolve;
    });
    const start = createDetachedStartOperation({
      host: hostReturning({ accepted })
    });

    const pending = start(SPEC);
    const early = await Promise.race([
      pending.then(() => "returned" as const),
      new Promise<"waiting">((r) => setTimeout(() => r("waiting"), 50))
    ]);
    expect(early).toBe("waiting");

    settleAccepted();
    await expect(pending).resolves.toEqual({ requestId: "req_child" });
  });
});
