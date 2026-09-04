/**
 * The guards on a delivery into an EXISTING session (the `id` policy), on the
 * shipped runtime path.
 *
 * Nothing here is injected. The sender's action runs through `runAction` under
 * the runtime's own config, the seam dispatches through the host `createFlowState`
 * wires, and the recipient's concurrency key is held by a real request posted
 * through the runtime's router — the same arbiter the seam's host shares.
 *
 * Three promises, each asserted on the promise rather than on a field:
 *
 * - **Acceptance means durable.** The moment the dispatcher returns, the
 *   delivery's request record exists and carries the recipient lineage the seam
 *   approved. Asserting "eventually persisted" would pass on a path that
 *   returns the id first and writes second — which is the defect.
 * - **A replaced recipient never runs the delivery.** The recipient deleted and
 *   recreated under the same id between acceptance and the run gets a new
 *   lineage; the run drops the delivery, deletes its row, and leaves the
 *   replacement's history untouched.
 * - **An external queue refuses the delivery by name**, before anything is
 *   enqueued, while a derived child is unaffected.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "../../src";
import type { FlowStateRuntime } from "../../src/flowstate/types";
import type { FlowDispatcher } from "../../src/transports/dispatcher";
import { dispatchTypeOf } from "../../src/execution/transport-sources";
import { readDispatchStamp } from "../../src/execution/dispatch-metadata";

const USER_ID = "u_guard";

type Observed = { runs: { sessionId: string; input: unknown }[] };

/** A flow whose `hold` action parks on a promise the test releases. */
function guardedFlow(kind: string, observed: Observed) {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  const work = handler({
    name: "work",
    inputSchema: z.object({ note: z.string() }),
    outputSchema: z.object({}),
    execute: async (input, ctx) => {
      observed.runs.push({ sessionId: ctx.session.identity.id, input });
      return {};
    }
  });

  const hold = handler({
    name: "hold",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.object({}),
    execute: async () => {
      await held;
      return {};
    }
  });

  const deliver = dispatcher({
    name: "deliver-work",
    type: "internal",
    target: "work",
    inputSchema: z.object({ to: z.string(), note: z.string() }),
    session: { id: (input) => input.to },
    payload: (input) => ({ note: input.note })
  });

  const spawn = dispatcher({
    name: "spawn-work",
    type: "internal",
    target: "work",
    inputSchema: z.object({ key: z.string(), note: z.string() }),
    session: { key: (input) => input.key },
    payload: (input) => ({ note: input.note })
  });

  const flow = defineFlow({
    kind,
    actions: {
      hold: { block: hold, inputSchema: z.object({}).passthrough() },
      deliver: { block: deliver },
      spawn: { block: spawn }
    },
    internal: { actions: { work: { block: work } } },
    // Session-keyed queue: a delivery into a session waits behind whatever
    // request holds that session's key.
    request: { concurrency: { policy: "queue", key: "session" } }
  })({ id: kind });

  return { flow, release: () => release() };
}

async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setTimeout(r, 5));
}

async function boot(kind: string, options: { dispatcher?: FlowDispatcher } = {}) {
  const observed: Observed = { runs: [] };
  const { flow, release } = guardedFlow(kind, observed);
  const state = createFlowState({
    flows: { [kind]: flow },
    stores: { default: { primary: inMemoryStores() } },
    ...(options.dispatcher !== undefined ? { dispatcher: options.dispatcher } : {})
  });
  const runtime = await state.getRuntime();
  const router = await state.getRouter();
  return { observed, flow, release, runtime, router, state };
}

function run(
  runtime: FlowStateRuntime,
  flow: ReturnType<typeof guardedFlow>["flow"],
  actionName: string,
  input: unknown,
  sessionId = "s_sender"
) {
  return runAction({
    flow,
    actionName,
    input,
    userId: USER_ID,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig }
  });
}

async function seedSession(
  runtime: FlowStateRuntime,
  id: string,
  flowKind: string,
  lineageId: string
): Promise<void> {
  const ts = Date.now();
  await runtime.stores.session.set(
    id,
    {
      id,
      state: {},
      version: 0,
      createdAt: ts,
      updatedAt: ts,
      flowKind,
      userId: USER_ID,
      lineageId,
      journal: []
    },
    "any"
  );
}

async function drain(stream: ReadableStream<Uint8Array> | null): Promise<void> {
  if (stream === null) return;
  const reader = stream.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) break;
  }
}

/** Post the `hold` action through the router so its session key is held in the shared arbiter. */
function holdThroughRouter(
  router: Awaited<ReturnType<typeof boot>>["router"],
  kind: string,
  sessionId: string
): Promise<void> {
  return router
    .POST(
      new Request(`http://localhost/api/flows/${kind}/actions/hold`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ userId: USER_ID, sessionId, input: {} })
      }),
      { params: { path: [kind, "actions", "hold"] } }
    )
    .then((res) => drain(res.body));
}

type Handle = { sessionId: string; requestId: string; adopted: boolean };

describe("a delivery into an existing session", () => {
  it("has a durable record carrying the approved recipient lineage the moment acceptance resolves", async () => {
    const { observed, flow, release, runtime, router, state } = await boot("guard-accept");
    try {
      await seedSession(runtime, "s_r", "guard-accept", "lin_original");
      const holding = holdThroughRouter(router, "guard-accept", "s_r");
      await settle();

      const sent = await run(runtime, flow, "deliver", { to: "s_r", note: "for s_r" });
      expect(sent.error).toBeUndefined();
      const handle = sent.output as Handle;
      expect(handle.sessionId).toBe("s_r");

      // Read at the instant the sender's request completed — the delivery is
      // still queued behind `hold`, so nothing but acceptance can have written it.
      const record = await runtime.stores.request.get(handle.requestId);
      expect(record).toBeDefined();
      expect(readDispatchStamp(record?.source, record?.metadata)).toMatchObject({
        type: "internal",
        target: "work",
        from: { block: "deliver-work", sessionId: "s_sender" },
        recipientLineageId: "lin_original"
      });
      expect(observed.runs).toEqual([]);

      release();
      await holding;
      await until(() => observed.runs.length === 1, "the delivery to run");
      expect(observed.runs[0]).toEqual({ sessionId: "s_r", input: { note: "for s_r" } });

      // A delivery never becomes the recipient's auto-resume target.
      const recipient = await runtime.stores.session.get("s_r");
      expect(recipient?.latestRequestId).not.toBe(handle.requestId);
    } finally {
      release();
      await state.dispose();
    }
  });

  it("is dropped when the recipient was replaced between acceptance and the run, leaving no row and no handler run", async () => {
    const { observed, flow, release, runtime, router, state } = await boot("guard-drop");
    try {
      await seedSession(runtime, "s_r", "guard-drop", "lin_original");
      const holding = holdThroughRouter(router, "guard-drop", "s_r");
      await settle();

      const sent = await run(runtime, flow, "deliver", { to: "s_r", note: "for the old session" });
      expect(sent.error).toBeUndefined();
      const handle = sent.output as Handle;

      // Delete and recreate the recipient under the same id while the delivery
      // is still queued. The replacement gets a NEW lineage.
      await runtime.stores.session.delete("s_r");
      await seedSession(runtime, "s_r", "guard-drop", "lin_replacement");

      release();
      await holding;
      await settle();

      // THE PROMISE: the handler did not run against the replacement…
      expect(observed.runs).toEqual([]);
      // …and the acceptance-time writes are reconciled, so the replacement
      // exposes no request row for the dropped delivery.
      expect(await runtime.stores.request.get(handle.requestId)).toBeUndefined();
    } finally {
      release();
      await state.dispose();
    }
  });

  it("is refused by name under an external dispatcher, while a derived child is not", async () => {
    const enqueued: unknown[] = [];
    // A dispatcher with no `dispatchLocal` is external by the host's own test:
    // it cannot accept a live signal or emitter, so its work runs elsewhere.
    const external: FlowDispatcher = {
      dispatch: async (envelope) => {
        enqueued.push(envelope);
        return {
          requestId: envelope.requestId ?? "req_external",
          finished: Promise.resolve({ status: "completed" } as never)
        } as never;
      },
      close: async () => {}
    };
    const { observed, flow, runtime, state } = await boot("guard-external", { dispatcher: external });
    try {
      await seedSession(runtime, "s_r", "guard-external", "lin_original");

      const sent = await run(runtime, flow, "deliver", { to: "s_r", note: "hi" });
      expect(sent.error?.message).toMatch(/external-dispatcher/);
      expect(enqueued).toEqual([]);
      expect(observed.runs).toEqual([]);

      // A derived child is the queue's to run: it goes through.
      const spawned = await run(runtime, flow, "spawn", { key: "doc-1", note: "hi" });
      expect(spawned.error).toBeUndefined();
      expect(enqueued).toHaveLength(1);
    } finally {
      await state.dispose();
    }
  });
});

describe("the stamp is trusted only under a seam-stamped source", () => {
  it("reads nothing off a forged metadata.dispatch on a caller-addressed request", () => {
    const forged = {
      dispatch: {
        type: "internal",
        target: "work",
        from: { block: "x", sessionId: "s" },
        recipientLineageId: "lin_victim"
      }
    };
    expect(readDispatchStamp("http", forged)).toBeUndefined();
    expect(readDispatchStamp("internal", forged)?.recipientLineageId).toBe("lin_victim");
  });

  it("gives the fenced workstream source no dispatch type", () => {
    expect(dispatchTypeOf("workstream")).toBeUndefined();
    expect(dispatchTypeOf("http")).toBe("public");
    expect(dispatchTypeOf("task")).toBe("task");
  });
});
