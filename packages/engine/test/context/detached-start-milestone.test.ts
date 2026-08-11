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

  it("reports a failed registration as not-started instead of reporting success", async () => {
    // The one thing this seam exists to prevent: a caller holding no `finished`
    // being told the child started when it never registered.
    //
    // Reported as not-started rather than thrown (FIX-1095). The caller still
    // owns the work either way — a rejected acceptance comes from the
    // enqueue-time chain, which terminates the request record before rethrowing
    // — and only the not-started shape lets it act on that. A throw is
    // indistinguishable from one raised after a child existed, so the caller
    // must leave its row for lease recovery.
    const start = createDetachedStartOperation({
      host: hostReturning({ accepted: Promise.reject(new Error("registry write failed")) })
    });

    await expect(start(SPEC)).resolves.toEqual({
      notStarted: true,
      reason: "registry write failed"
    });
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

  it("reports a failed enqueue as not-started, with the record already terminal", async () => {
    // The mirror of the case above, on the same axis (FIX-1095). An external
    // dispatcher that cannot enqueue rejects `accepted`, and that rejection
    // reaches here only through the enqueue-time chain's `catch`, which awaits
    // `terminateUnenqueuedRequest` before rethrowing. Propagating it instead of
    // reporting not-started leaves the caller holding a released claim it cannot
    // act on, and its row `in_progress` until an unrelated drain reclaims it.
    //
    // Driven through the REAL host so the ordering is exercised rather than
    // stipulated: the record's terminal status is what shows the termination had
    // already happened when the result came back.
    const ran: string[] = [];
    const registry = createFlowRegistry();
    registry.register(flowWithRunner("enqueue-fails", ran));
    const stores = createInMemoryStores();

    // Give the record write real latency. Without it the in-memory store commits
    // within the same microtask turn, so the status below reads `failed` whether
    // or not anything waited for it — an assertion that cannot fail. With it, a
    // termination that was merely started (rather than awaited) has provably not
    // landed when the refusal comes back.
    const rawSet = stores.request.set.bind(stores.request);
    stores.request.set = (async (...args: Parameters<typeof rawSet>) => {
      await new Promise((r) => setTimeout(r, 20));
      return rawSet(...args);
    }) as typeof rawSet;

    // No `dispatchLocal`, so the host takes its external-dispatcher branch. The
    // envelope carries the id the host materialized, which is the only handle on
    // the record once the result comes back as a refusal.
    let enqueuedRequestId: string | undefined;
    const host = createInboundTransportHost({
      registry,
      stores,
      resolvePrincipal: defaultBodyUserIdPrincipalResolver,
      runtimeConfig: {},
      dispatcher: {
        dispatch: (envelope: { requestId: string }) => {
          enqueuedRequestId = envelope.requestId;
          return Promise.reject(new Error("queue unreachable"));
        },
        close: () => Promise.resolve()
      } as never
    });

    const started = await createDetachedStartOperation({ host })({
      ...SPEC,
      flowKind: "enqueue-fails",
      input: dispatchInput
    });

    // The outcome the caller acts on: a refusal it can settle its own row
    // against, not a throw that strands it.
    expect(started).toEqual({ notStarted: true, reason: "queue unreachable" });

    // Nothing ran, and the record the host materialized at enqueue time is
    // already terminal — not left `in_progress` for the sweeper. Read AFTER the
    // result, with no waiting: the ordering claim is that termination has
    // already committed by the time the refusal is observable, so a poll here
    // would hide exactly the thing being pinned.
    expect(ran).toEqual([]);
    expect(enqueuedRequestId).toBeDefined();
    const record = await stores.request.get(enqueuedRequestId!);
    expect(record?.status).toBe("failed");
  });
});
