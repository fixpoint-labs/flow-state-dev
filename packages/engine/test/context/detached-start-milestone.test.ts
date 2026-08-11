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
 * What it waits for is **acceptance**, and deliberately nothing later. The row
 * it hands over is protected by its own lease, not by a dispatch milestone: a
 * child that dies at any point leaves a lease nobody renews, and the next drain
 * recovers the row. Waiting longer would only change which failures cost one
 * lease of latency, and would couple the launching request to the child's
 * startup — the thing detachment exists to remove.
 *
 * What acceptance does buy is that the failure is *visible*. Pinned here: the
 * seam waits for it, propagates its rejection, and does not hang when a
 * dispatcher offers none.
 */
import { describe, it, expect, vi } from "vitest";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { declareWorkstreamBindings } from "@flow-state-dev/core/types";
import type { BlockDefinition, FlowInstance } from "@flow-state-dev/core/types";
import { createDetachedStartOperation } from "../../src/context/detached-start-operation";
import {
  createFlowRegistry,
  createInboundTransportHost,
  createInMemoryStores,
  defaultBodyUserIdPrincipalResolver
} from "../../src";
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

describe("a detached start waits for the dispatch to be accepted", () => {
  it("waits for acceptance before reporting the child started", async () => {
    let settleAccepted: () => void = () => {};
    const accepted = new Promise<void>((resolve) => {
      settleAccepted = resolve;
    });
    const start = createDetachedStartOperation({ host: hostReturning({ accepted }) });

    const pending = start(SPEC);
    const early = await Promise.race([
      pending.then(() => "returned" as const),
      new Promise<"waiting">((r) => setTimeout(() => r("waiting"), 50))
    ]);
    expect(early).toBe("waiting");

    settleAccepted();
    await expect(pending).resolves.toEqual({ requestId: "req_child" });
  });

  it("propagates a failed registration instead of reporting success", async () => {
    // The one thing this seam exists to prevent: a caller holding no `finished`
    // being told the child started when it never registered.
    const start = createDetachedStartOperation({
      host: hostReturning({ accepted: Promise.reject(new Error("registry write failed")) })
    });

    await expect(start(SPEC)).rejects.toThrow(/registry write failed/);
  });

  it("does not wait on a dispatcher that reports no acceptance", async () => {
    // The field is optional on the contract. A custom dispatcher that does not
    // distinguish acceptance from completion must not hang the launching
    // request — it gets today's behaviour, which the row's lease still covers.
    const start = createDetachedStartOperation({ host: hostReturning({}) });
    await expect(start(SPEC)).resolves.toEqual({ requestId: "req_child" });
  });

  it("reports a synchronous dispatch refusal as not-started, rather than throwing", async () => {
    // A `reject` concurrency policy whose key the launching request already
    // holds throws out of `host.dispatch` before any child exists. Reported as
    // "not started" so the caller — which still owns whatever it was handing
    // over — can settle it, instead of leaving a row `in_progress` with no
    // Workstream anywhere while its lease runs down.
    const start = createDetachedStartOperation({
      host: {
        dispatch: () => {
          throw new Error("concurrency key already held");
        }
      } as never
    });

    await expect(start(SPEC)).resolves.toEqual({
      notStarted: true,
      reason: "concurrency key already held"
    });
  });
});

describe("not-started is reserved for a throw that happened before any child existed", () => {
  const BOARD_ID = "hook-board";
  const COORDINATE = "assignee|9:implement";

  /**
   * A flow whose workstream core routes `BOARD_ID` at a runner that records the
   * fact it ran, so "a child existed" is an observation rather than an argument.
   */
  function flowWithRunner(kind: string, ran: string[]): FlowInstance {
    const runner = handler({
      name: "runner",
      execute: () => {
        ran.push("runner");
        return null;
      }
    }) as unknown as BlockDefinition<never, never>;

    const drain = sequencer({ name: "drain" }).tap(
      handler({ name: "work", execute: () => undefined })
    );
    declareWorkstreamBindings(drain, [
      {
        boardId: BOARD_ID,
        coordinateKey: COORDINATE,
        worker: handler({ name: "implement", execute: () => null }) as unknown as BlockDefinition<
          never,
          never
        >,
        runner
      }
    ]);

    return defineFlow({
      kind,
      actions: { run: { block: drain } }
    } as never)({ id: kind }) as unknown as FlowInstance;
  }

  const dispatchInput = {
    boardId: BOARD_ID,
    coordinateKey: COORDINATE,
    taskId: "t1",
    attempt: 0,
    createdAt: 1_700_000_000_000,
    payload: { taskId: "t1" }
  };

  it("reports the child started when the host's background-work hook throws after it began", async () => {
    // The premise the not-started result rests on is that `host.dispatch` cannot
    // throw synchronously once a child exists. `onBackgroundWork` — the
    // adapter-supplied keep-alive hook (Next `after()`, Vercel `waitUntil`),
    // which throws synchronously when called outside a request scope — is
    // invoked by `dispatch` AFTER the in-process run has been started. Reported
    // as not-started, the caller restores its claim and fails a row whose child
    // is still running and still trying to settle it: two writers, one row.
    const ran: string[] = [];
    const registry = createFlowRegistry();
    registry.register(flowWithRunner("hook-throws", ran));

    const host = createInboundTransportHost({
      registry,
      stores: createInMemoryStores(),
      resolvePrincipal: defaultBodyUserIdPrincipalResolver,
      runtimeConfig: {
        onBackgroundWork: () => {
          throw new Error("after() was called outside a request scope");
        }
      }
    });

    const started = await createDetachedStartOperation({ host })({
      ...SPEC,
      flowKind: "hook-throws",
      input: dispatchInput
    });

    // The child really did start — so "not started" would be a false report.
    await vi.waitFor(() => expect(ran).toEqual(["runner"]));
    expect(started).not.toHaveProperty("notStarted");
  });
});
