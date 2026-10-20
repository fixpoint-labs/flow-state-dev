/** One `final: true` event when a request settles failed (FIX-1983). */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { z } from "zod";
import { afterEach, describe, expect, it } from "vitest";
import { createInMemoryStores, runAction, type StoreRegistry } from "../src";
import type { ErrorCaptureEvent } from "../src/errors/error-capture";
import type { FlowInstance } from "@flow-state-dev/core/types";

/** Wait until `events` holds a final event, or give up after a short budget. */
async function finalOf(events: ErrorCaptureEvent[]): Promise<ErrorCaptureEvent[]> {
  for (let i = 0; i < 50; i += 1) {
    if (events.some((e) => e.final === true)) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return events.filter((e) => e.final === true);
}

async function run(flow: FlowInstance, stores: StoreRegistry, events: ErrorCaptureEvent[]) {
  return runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input: {},
    userId: "u_final",
    sessionId: "s_final",
    stores,
    runtimeConfig: { errorCapture: (e) => void events.push(e) }
  });
}

describe("errorCapture final-failure event", () => {
  const previousDefaultModel = process.env.FSDEV_DEFAULT_MODEL;
  afterEach(() => {
    if (previousDefaultModel === undefined) delete process.env.FSDEV_DEFAULT_MODEL;
    else process.env.FSDEV_DEFAULT_MODEL = previousDefaultModel;
  });

  it("sends one final event for a request that settles failed, after its record says failed", async () => {
    const stores = createInMemoryStores();
    const events: ErrorCaptureEvent[] = [];
    let statusWhenSent: string | undefined;
    const leaf = handler({
      name: "leaf-boom",
      execute: () => {
        throw new Error("leaf failed for good");
      }
    });
    const flow = defineFlow({
      kind: "final-flow",
      actions: {
        run: {
          inputSchema: z.any(),
          block: sequencer({ name: "root", inputSchema: z.any() }).step(handler({ name: "pass", execute: (i) => i })).step(leaf)
        }
      }
    })();

    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      input: {},
      userId: "u_final",
      sessionId: "s_final",
      stores,
      runtimeConfig: {
        errorCapture: async (e) => {
          events.push(e);
          if (e.final === true) statusWhenSent = (await stores.request.get(e.requestId))?.status;
        }
      }
    });

    const finals = await finalOf(events);
    expect(finals).toHaveLength(1);
    const final = finals[0]!;
    expect(final).toMatchObject({
      final: true,
      scope: "request",
      requestId: result.requestId,
      flowKind: "final-flow",
      actionName: "run",
      userId: "u_final",
      sessionId: "s_final",
      // The leaf that threw, so a sink can tell one failure from another.
      blockName: "leaf-boom"
    });
    expect(final.blockPath).toBeTruthy();
    expect(final.error.message).toContain("leaf failed for good");
    expect(statusWhenSent).toBe("failed");
    // The per-block event is still sent, and is not final.
    expect(events.filter((e) => e.final !== true).map((e) => e.blockName)).toEqual(["leaf-boom"]);
  });

  it("sends no final event when a sequencer rescues the failure and the request completes", async () => {
    const events: ErrorCaptureEvent[] = [];
    const risky = handler({
      name: "risky",
      execute: () => {
        throw new Error("rescued");
      }
    });
    const flow = defineFlow({
      kind: "rescued-flow",
      actions: {
        run: {
          inputSchema: z.any(),
          block: sequencer({ name: "root", inputSchema: z.any() }).step(risky).rescue([
            { when: [Error], block: handler({ name: "fallback", execute: () => ({ ok: true }) }) }
          ])
        }
      }
    })();

    const result = await run(flow, createInMemoryStores(), events);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.error).toBeUndefined();
    expect(events.length).toBeGreaterThan(0);
    expect(events.filter((e) => e.final === true)).toHaveLength(0);
  });

  it("sends no final event when a retried block passes on a later attempt", async () => {
    const events: ErrorCaptureEvent[] = [];
    let calls = 0;
    const flaky = handler({
      name: "flaky",
      retry: { maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0 },
      execute: () => {
        calls += 1;
        if (calls === 1) throw new Error("first attempt fails");
        return { ok: true };
      }
    });
    const flow = defineFlow({ kind: "retry-flow", actions: { run: { inputSchema: z.any(), block: flaky } } })();

    const result = await run(flow, createInMemoryStores(), events);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(result.error).toBeUndefined();
    expect(events.filter((e) => e.final !== true)).toHaveLength(1);
    expect(events.filter((e) => e.final === true)).toHaveLength(0);
  });

  it("sends one final event for a setup failure whose failed record landed", async () => {
    // Rejected at resolver construction: a setup failure after the request was accepted.
    process.env.FSDEV_DEFAULT_MODEL = "intent/chat";
    const stores = createInMemoryStores();
    const events: ErrorCaptureEvent[] = [];
    const flow = defineFlow({
      kind: "setup-flow",
      actions: { run: { inputSchema: z.any(), block: handler({ name: "never", execute: () => ({}) }) } }
    })();

    await expect(
      runAction({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "run",
        input: {},
        userId: "u_setup",
        sessionId: "s_setup",
        requestId: "req_setup",
        stores,
        runtimeConfig: { errorCapture: (e) => void events.push(e) }
      })
    ).rejects.toThrow();

    const finals = await finalOf(events);
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({ final: true, scope: "request", requestId: "req_setup", flowKind: "setup-flow", userId: "u_setup" });
    expect((await stores.request.get("req_setup"))?.status).toBe("failed");
  });

  it("still sends the final event when the failed status event can't be written", async () => {
    const stores = createInMemoryStores();
    const events: ErrorCaptureEvent[] = [];
    // Once the record says failed, writing the stream's events throws: the status event is lost.
    const flushEvents = stores.request.flushEvents.bind(stores.request);
    stores.request.flushEvents = (async (requestId: string) => {
      if ((await stores.request.get(requestId))?.status === "failed") throw new Error("event store down");
      return flushEvents(requestId);
    }) as typeof stores.request.flushEvents;
    const flow = defineFlow({
      kind: "status-lost-flow",
      actions: {
        run: {
          inputSchema: z.any(),
          block: handler({
            name: "boom",
            execute: () => {
              throw new Error("failed while the event store was down");
            }
          })
        }
      }
    })();

    await run(flow, stores, events).catch(() => undefined);

    const finals = await finalOf(events);
    expect(finals).toHaveLength(1);
    expect(finals[0]!.error.message).toContain("failed while the event store was down");
  });
});
