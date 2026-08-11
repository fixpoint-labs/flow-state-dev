/**
 * A keep-alive hook that throws must not revert a resumption that is running
 * (FIX-1095).
 *
 * `host.continueRequest` starts the resumed run and THEN hands its `finished`
 * to `runtimeConfig.onBackgroundWork` — the adapter-supplied keep-alive hook,
 * which Next's `after()` and `waitUntil` both raise synchronously when called
 * outside a request scope. `continueRequest` is synchronous from the resume
 * route's point of view (it awaits the promise it returns), and that route's
 * catch treats any failure as a setup failure: it reverts the suspension to
 * `pending` and releases the lease so an operator can retry. Reverting a
 * suspension whose run is still going invites a second resume against the same
 * request — two writers, one row.
 *
 * This drives the real host and the real resume route end to end, with a hook
 * that throws, and pins the OUTCOME rather than the wrapping: the resumed run
 * reaches its post-gate step and completes, and the suspension stays resolved.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import { createInboundTransportHost } from "../src/transports/host/createInboundTransportHost";
import { defaultBodyUserIdPrincipalResolver } from "../src/transports/auth/defaultBodyUserIdPrincipalResolver";
import { handleResumeSuspension } from "../src/routes/resume-routes";

const FLOW_KIND = "resume-keepalive";

/** Resolves the first time the post-gate step runs, so the test can await the
 * resumed run without the route handing back its `finished`. */
function createDeferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function setup(afterGate: () => void) {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases
  });

  const gate = handler({
    name: "gate",
    inputSchema: z.object({ amount: z.number() }),
    outputSchema: z.unknown(),
    execute: async (input, ctx) =>
      await ctx.suspend!({
        reason: "human_approval",
        message: `Approve ${input.amount}?`,
        data: { amount: input.amount }
      })
  });

  // The step the resumption exists to reach. If the run really is under way
  // when the hook throws, this runs; if the fix only wrapped the hook without
  // the run proceeding, it does not.
  const postGate = handler({
    name: "postGate",
    inputSchema: z.unknown(),
    outputSchema: z.object({ settled: z.literal(true) }),
    execute: async () => {
      afterGate();
      return { settled: true } as const;
    }
  });

  const flow = defineFlow({
    kind: FLOW_KIND,
    actions: {
      transfer: {
        inputSchema: z.object({ amount: z.number() }),
        block: sequencer({ name: "transferSeq", durable: true })
          .step(gate)
          .step(postGate)
      }
    }
  })();

  const registry = createFlowRegistry();
  registry.register(flow as never);

  return { stores, provider, registry };
}

function resumeRequest(requestId: string, suspensionId: string): Request {
  return new Request(
    `https://x/api/flows/${FLOW_KIND}/requests/${requestId}/resume`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ suspensionId, action: "approve", resumedBy: "reviewer" })
    }
  );
}

describe("resume — a throwing onBackgroundWork hook (FIX-1095)", () => {
  it("does not revert the suspension of a run that is already under way", async () => {
    const reached = createDeferred();
    const { stores, provider, registry } = setup(reached.resolve);

    // Suspend for real, so the resume re-enters a genuine gate.
    const first = await runAction({
      flow: registry.get(FLOW_KIND)! as never,
      actionName: "transfer",
      input: { amount: 1000 },
      userId: "u_reviewer",
      stores,
      source: "http",
      runtimeConfig: { durabilityProvider: provider }
    });
    const requestId = first.requestId!;
    const [suspension] = await provider.listSuspended({ status: "pending" });
    expect(suspension?.requestId).toBe(requestId);

    // Observe every status the resume writes to the suspension. A completed run
    // cleans its suspension record up, so reading the record afterwards cannot
    // tell "never reverted" from "reverted then deleted" — and would pass
    // vacuously either way. The write log can only be satisfied by the revert
    // not happening.
    const statusesWritten: string[] = [];
    const watchedProvider = {
      ...provider,
      suspend: async (record: Parameters<typeof provider.suspend>[0]) => {
        statusesWritten.push(record.status);
        return provider.suspend(record);
      }
    };

    const error = vi.fn();
    const host = createInboundTransportHost({
      registry,
      stores,
      resolvePrincipal: defaultBodyUserIdPrincipalResolver,
      runtimeConfig: {
        logger: { error },
        durabilityProvider: watchedProvider,
        onBackgroundWork: () => {
          throw new Error("after() was called outside a request scope");
        }
      }
    });

    const response = await handleResumeSuspension(
      resumeRequest(requestId, suspension.suspensionId),
      { kind: "resume_suspension", flowKind: FLOW_KIND, requestId },
      {
        host,
        registry,
        stores,
        durabilityProvider: watchedProvider,
        seams: {} as never,
        requestContext: {} as never
      }
    );

    // The route answered normally — the hook's throw never reached its catch.
    expect(response.status).toBe(202);

    // The resumption did what it was for: the post-gate step ran and the
    // request reached a terminal state.
    await reached.promise;
    await vi.waitFor(async () => {
      expect((await stores.request.get(requestId))?.status).toBe("completed");
    });

    // The damaging outcome: a suspension reverted to `pending` is one a second
    // resume can claim while the first is still writing to the same request.
    // The resume resolved the gate and left it resolved.
    expect(statusesWritten).toEqual(["approved"]);

    // Swallowed, not hidden — keep-alive really did fail to register.
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toMatch(/onBackgroundWork threw/);
  });
});
