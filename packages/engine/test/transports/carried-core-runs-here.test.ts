// FIX-2752.
/**
 * A dispatch that carries its action core (a dynamic schedule's fire) runs in
 * this process, even when an external runner (a job queue) is installed.
 *
 * Why it matters: the carried core is a block produced at dispatch time. It
 * can't be serialized, so a queue job drops it and the run has nothing to
 * execute, while the scheduled endpoint has already claimed that time: the
 * fire is lost. Running it here is the only way it runs at all. Every other
 * dispatch still goes to the queue, so a static schedule keeps the queue's
 * retries.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createInboundTransportHost, createInMemoryStores, type DispatchEnvelope, type FlowRunner } from "../../src/host";
import { createFlowRegistry, defaultBodyUserIdPrincipalResolver } from "../../src";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { oneOffSessionId } from "@flow-state-dev/core/helpers";

function setup() {
  const ran: string[] = [];
  const queued: DispatchEnvelope[] = [];
  const queue: FlowRunner = {
    dispatch: vi.fn(async (envelope: DispatchEnvelope) => {
      queued.push(envelope);
      return { requestId: envelope.requestId, finished: new Promise(() => undefined) } as never;
    }),
    close: async () => undefined
  };
  const flow = defineFlow({
    kind: "digest",
    actions: {
      run: {
        inputSchema: z.object({}).passthrough(),
        block: handler({ name: "static-run", execute: () => (ran.push("static"), { ok: true }) })
      }
    }
  })();
  const registry = createFlowRegistry();
  registry.register(flow);
  const host = createInboundTransportHost({
    registry,
    stores: createInMemoryStores(),
    resolvePrincipal: defaultBodyUserIdPrincipalResolver,
    runtimeConfig: { modelResolver: createMockModelResolver({}) },
    runner: queue
  });
  const carried = handler({ name: "dynamic-run", inputSchema: z.object({}).passthrough(), execute: () => (ran.push("dynamic"), { ok: true }) });
  const fire = (core?: { block: unknown }) =>
    host.dispatch({
      sessionId: oneOffSessionId(),
      source: "scheduled",
      flowKind: "digest",
      action: core === undefined ? "run" : "dynamic-run",
      input: {},
      principal: { userId: "alice", orgId: "acme" },
      metadata: { schedule: { scheduleId: core === undefined ? "nightly" : "acme/alice/poll", origin: core === undefined ? "static" : "dynamic" } },
      ...(core === undefined ? {} : { resolvedActionCore: core as never }),
      responseEmitter: null
    });
  return { fire, carried, ran, queued };
}

describe("a dispatch that carries its action core, with a job queue installed", () => {
  it("runs in this process, not on the queue, so a dynamic schedule's fire runs", async () => {
    const h = setup();
    const handle = h.fire({ block: h.carried });
    await vi.waitFor(() => expect(h.ran.length + h.queued.length).toBe(1));
    expect(h.queued.map((e) => e.actionName)).toEqual([]);
    expect(h.ran).toEqual(["dynamic"]);
    const result = await handle.finished;
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ ok: true });
  });

  it("still sends a dispatch with no carried core to the queue", async () => {
    const h = setup();
    h.fire();
    await vi.waitFor(() => expect(h.queued.map((e) => e.actionName)).toEqual(["run"]));
    expect(h.ran).toEqual([]);
  });
});
