/**
 * Why it matters: the claim gate fails a task's attempt on a background
 * failure a drain only logged. The request's own status does not change:
 * background work never drives it.
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { onRequestEnded, type RequestEnding } from "@flow-state-dev/core/types";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import { abortRequest, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A tap that registers a hook recording how the request ended. */
function registering(endings: RequestEnding[]) {
  return handler({
    name: "register-end",
    inputSchema: z.any(),
    execute: (_input, ctx) => {
      onRequestEnded(ctx, (ending) => {
        endings.push(ending);
      });
    }
  });
}

/** Background work that throws after a delay, as a capture that times out does. */
function throwingStep(name: string, message: string, ms = 20) {
  return handler({
    name,
    inputSchema: z.any(),
    execute: async () => {
      await sleep(ms);
      throw new Error(message);
    }
  });
}

const answer = handler({ name: "answer", inputSchema: z.any(), execute: () => "fine" });

async function run(
  flow: Parameters<typeof runAction>[0]["flow"],
  extra: Record<string, unknown> = {},
  stores = createInMemoryStores()
) {
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input: {},
    userId: "u1",
    sessionId: "s1",
    stores,
    runtimeConfig: {},
    ...extra
  } as never);
  return { result, record: await stores.request.get(result.requestId!) };
}

describe("request-end seam · background failures", () => {
  it("hands the hooks every background step that failed, the action's and onFinished's, and leaves the request completed", async () => {
    const endings: RequestEnding[] = [];
    const flow = defineFlow({
      kind: "bg-failures-completed",
      actions: {
        run: {
          inputSchema: z.any(),
          block: sequencer({ name: "run" })
            .tap(registering(endings))
            .sideChain(throwingStep("capture", "capture timed out"))
            .step(answer)
        }
      },
      request: { onFinished: sequencer({ name: "finished" }).sideChain(throwingStep("notify", "notify failed")) }
    })();

    const { result, record } = await run(flow);

    expect(result.error).toBeUndefined();
    expect(record?.status).toBe("completed");
    expect(endings).toEqual([
      {
        status: "completed",
        backgroundFailures: [
          { step: "capture", message: "capture timed out" },
          { step: "notify", message: "notify failed" }
        ]
      }
    ]);
  });

  it("hands on a failure a default .waitForSideChain() drained, while the pipeline continued past the wait", async () => {
    const endings: RequestEnding[] = [];
    const flow = defineFlow({
      kind: "bg-failures-wait",
      actions: {
        run: {
          inputSchema: z.any(),
          block: sequencer({ name: "run" })
            .tap(registering(endings))
            .sideChain(throwingStep("persist", "persist failed"))
            .waitForSideChain()
            .step(answer)
        }
      }
    })();

    const { result } = await run(flow);

    expect(result.output).toBe("fine");
    expect(endings[0]?.backgroundFailures).toEqual([{ step: "persist", message: "persist failed" }]);
  });

  it("hands on a failure that lands after a .waitForSideChain({ timeoutMs }) gave up and its timeout was rescued", async () => {
    // The wait takes the step out of the pool before it awaits it. Once the
    // wait times out and a rescue carries the request on, the request's own
    // drain must still wait for that step, or its failure is never kept.
    const endings: RequestEnding[] = [];
    const impatient = sequencer({ name: "impatient" })
      .sideChain(throwingStep("slow-write", "late boom", 80))
      .waitForSideChain({ timeoutMs: 10 })
      .rescue([{ block: handler({ name: "gave-up", inputSchema: z.any(), execute: () => "gave up waiting" }) }]);
    const flow = defineFlow({
      kind: "bg-failures-wait-timeout",
      actions: {
        run: {
          inputSchema: z.any(),
          block: sequencer({ name: "run" }).tap(registering(endings)).step(impatient).step(answer)
        }
      }
    })();

    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { result } = await run(flow);

      expect(result.output).toBe("fine");
      expect(endings).toEqual([{ status: "completed", backgroundFailures: [{ step: "slow-write", message: "late boom" }] }]);
      // Logged once: the wait that gave up never logs it, and the request's drain never saw it.
      expect(logged.mock.calls.map((call) => call.join(" ")).filter((line) => line.includes("late boom"))).toHaveLength(1);
    } finally {
      logged.mockRestore();
    }
  });

  it("hands on a late failure after a rescued .waitForSideChain({ failOnError: true, timeoutMs }) gave up: its throw has no caller left", async () => {
    const endings: RequestEnding[] = [];
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const strict = sequencer({ name: "strict" })
      .sideChain(throwingStep("slow-write", "late boom", 80))
      .waitForSideChain({ timeoutMs: 10, failOnError: true })
      .rescue([{ block: handler({ name: "gave-up", inputSchema: z.any(), execute: () => "gave up waiting" }) }]);
    const flow = defineFlow({
      kind: "bg-failures-strict-wait-timeout",
      actions: {
        run: {
          inputSchema: z.any(),
          block: sequencer({ name: "run" }).tap(registering(endings)).step(strict).step(answer)
        }
      }
    })();

    try {
      const { result } = await run(flow);

      expect(result.output).toBe("fine");
      expect(endings).toEqual([{ status: "completed", backgroundFailures: [{ step: "slow-write", message: "late boom" }] }]);
      // Logged once, as the request's drain logs a failure: no caller is left to log it.
      const lines = logged.mock.calls.map((call) => call.join(" ")).filter((line) => line.includes("late boom"));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('Background work "slow-write" failed');
    } finally {
      logged.mockRestore();
    }
  });

  it("still hands on the failures when reading the durable cancel throws: a store blink is not a cancel", async () => {
    const endings: RequestEnding[] = [];
    const stores = createInMemoryStores();
    const read = stores.request.isAbortRequested.bind(stores.request);
    let blinking = false;
    stores.request.isAbortRequested = async (requestId: string) => {
      if (blinking) throw new Error("the store blinked");
      return read(requestId);
    };
    const startBlinking = handler({
      name: "start-blinking",
      inputSchema: z.any(),
      execute: () => {
        blinking = true;
      }
    });
    const flow = defineFlow({
      kind: "bg-failures-cancel-read-throws",
      actions: {
        run: { inputSchema: z.any(), block: sequencer({ name: "run" }).tap(registering(endings)).step(answer), onCompleted: startBlinking }
      },
      request: { onFinished: sequencer({ name: "finished" }).sideChain(throwingStep("notify", "notify failed")) }
    })();

    const { result, record } = await run(flow, {}, stores);

    expect(result.error).toBeUndefined();
    expect(record?.status).toBe("completed");
    expect(endings).toEqual([{ status: "completed", backgroundFailures: [{ step: "notify", message: "notify failed" }] }]);
  });

  it("hands on nothing when the request was cancelled, whether a step settled on the cancel or threw anyway", async () => {
    const endings: RequestEnding[] = [];
    const stopsOnCancel = handler({
      name: "stops-on-cancel",
      inputSchema: z.any(),
      execute: (_input, ctx) =>
        new Promise((_resolve, reject) => {
          ctx.signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true });
        })
    });
    const stores = createInMemoryStores();
    // The abort endpoint's two halves: the durable intent, then the controller.
    const cancel = handler({
      name: "cancel",
      inputSchema: z.any(),
      execute: async (_input, ctx) => {
        const id = ctx.request.identity.id;
        await stores.request.setFieldsIfStatus(id, { abortRequested: true }, ["in_progress"], Date.now());
        abortRequest(id);
        await sleep(5);
        return "cancelled";
      }
    });
    const flow = defineFlow({
      kind: "bg-failures-cancel",
      actions: {
        run: {
          inputSchema: z.any(),
          block: sequencer({ name: "run" })
            .tap(registering(endings))
            .sideChain(stopsOnCancel)
            .sideChain(throwingStep("throws-anyway", "threw after the cancel", 60))
            .step(cancel)
        }
      }
    })();

    const { record } = await run(flow, {}, stores);

    expect(record?.status).toBe("aborted");
    expect(endings).toEqual([{ status: "aborted" }]);
  });

  it("hands on nothing for a cancel that arrived too late to end the request as aborted", async () => {
    // Past the success path's abort check the request stays completed, as
    // `onCompleted` already ran; a step that throws after the cancel still
    // must not fail the task the person cancelled.
    const endings: RequestEnding[] = [];
    const stores = createInMemoryStores();
    const lateCancel = handler({
      name: "late-cancel",
      inputSchema: z.any(),
      execute: async (input: { requestId: string }) => {
        await stores.request.setFieldsIfStatus(input.requestId, { abortRequested: true }, ["in_progress"], Date.now());
        abortRequest(input.requestId);
      }
    });
    const flow = defineFlow({
      kind: "bg-failures-late-cancel",
      actions: {
        run: { inputSchema: z.any(), block: sequencer({ name: "run" }).tap(registering(endings)).step(answer), onCompleted: lateCancel }
      },
      request: { onFinished: sequencer({ name: "finished" }).sideChain(throwingStep("notify", "threw after the cancel")) }
    })();

    const { record } = await run(flow, {}, stores);

    expect(record?.status).toBe("completed");
    expect(endings).toEqual([{ status: "completed" }]);
  });

  it("hands on nothing for a late cancel recorded only as the durable intent, as another instance's abort route records it", async () => {
    // The abort poll closes before `onFinished`, so this run's controller never
    // fires; the intent on the record is the only sign of the cancel.
    const endings: RequestEnding[] = [];
    const stores = createInMemoryStores();
    const durableCancel = handler({
      name: "durable-cancel",
      inputSchema: z.any(),
      execute: async (input: { requestId: string }) => {
        await stores.request.setFieldsIfStatus(input.requestId, { abortRequested: true }, ["in_progress"], Date.now());
      }
    });
    const flow = defineFlow({
      kind: "bg-failures-durable-cancel",
      actions: {
        run: { inputSchema: z.any(), block: sequencer({ name: "run" }).tap(registering(endings)).step(answer), onCompleted: durableCancel }
      },
      request: { onFinished: sequencer({ name: "finished" }).sideChain(throwingStep("notify", "threw after the cancel")) }
    })();

    const { record } = await run(flow, {}, stores);

    expect(record?.status).toBe("completed");
    expect(endings).toEqual([{ status: "completed" }]);
  });

  it("hands on a failure after a dropped connection: a disconnect is not a cancel", async () => {
    const endings: RequestEnding[] = [];
    const transport = new AbortController();
    const dropConnection = handler({
      name: "drop-connection",
      inputSchema: z.any(),
      execute: () => {
        transport.abort(new Error("client went away"));
        return "fine";
      }
    });
    const flow = defineFlow({
      kind: "bg-failures-disconnect",
      actions: {
        run: {
          inputSchema: z.any(),
          block: sequencer({ name: "run" })
            .tap(registering(endings))
            .sideChain(throwingStep("capture", "capture failed after the disconnect", 40))
            .step(dropConnection)
        }
      }
    })();

    await run(flow, { signal: transport.signal });

    expect(endings).toHaveLength(1);
    expect(endings[0]?.backgroundFailures).toEqual([{ step: "capture", message: "capture failed after the disconnect" }]);
  });

  it("hands on a failure when a dropped connection ends the request as interrupted", async () => {
    // A step that honours its signal throws when the connection drops, so the
    // request takes the error path. That is still not a cancel.
    const endings: RequestEnding[] = [];
    const transport = new AbortController();
    const honoursTheSignal = handler({
      name: "honours-the-signal",
      inputSchema: z.any(),
      execute: (_input, ctx) => {
        transport.abort(new Error("client went away"));
        if (ctx.signal.aborted) throw new Error("the connection dropped");
        return "fine";
      }
    });
    const flow = defineFlow({
      kind: "bg-failures-disconnect-throws",
      actions: {
        run: {
          inputSchema: z.any(),
          block: sequencer({ name: "run" })
            .tap(registering(endings))
            .sideChain(throwingStep("capture", "capture failed after the disconnect", 40))
            .step(honoursTheSignal)
        }
      }
    })();

    await run(flow, { signal: transport.signal });

    expect(endings).toEqual([
      { status: "interrupted", backgroundFailures: [{ step: "capture", message: "capture failed after the disconnect" }] }
    ]);
  });

  it("hands on nothing when the request suspends: the resume reruns the step, and its outcome is the one handed on", async () => {
    const endings: RequestEnding[] = [];
    const flow = defineFlow({
      kind: "bg-failures-suspended",
      actions: {
        run: {
          inputSchema: z.any(),
          durable: true,
          block: sequencer({ name: "run", durable: true })
            .tap(registering(endings))
            .sideChain(throwingStep("capture", "failed before the stop", 1))
            .waitForSideChain()
            .step(
              handler({
                name: "ask",
                inputSchema: z.any(),
                outputSchema: z.unknown(),
                execute: (_input, ctx) => ctx.suspend!({ reason: "human_input", message: "Which one?" })
              })
            )
        }
      }
    })();
    const stores = createInMemoryStores();
    const provider = createCheckpointDurabilityProvider({
      checkpoints: stores.checkpoints,
      suspensions: stores.suspensions,
      leases: stores.leases
    });

    await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      userId: "u1",
      sessionId: "s1",
      stores,
      runtimeConfig: { durabilityProvider: provider }
    });

    expect(endings).toEqual([{ status: "suspended", suspension: expect.objectContaining({ reason: "human_input", suspensionId: expect.any(String) }) }]);
  });

  it("hands on nothing for a request whose background work succeeded", async () => {
    const endings: RequestEnding[] = [];
    const flow = defineFlow({
      kind: "bg-failures-none",
      actions: {
        run: {
          inputSchema: z.any(),
          block: sequencer({ name: "run" })
            .tap(registering(endings))
            .sideChain(handler({ name: "fine-step", inputSchema: z.any(), execute: async () => sleep(5) }))
            .step(answer)
        }
      }
    })();

    await run(flow);

    expect(endings).toEqual([{ status: "completed" }]);
  });
});
