/**
 * The dispatch seam, end to end on the shipped runtime path.
 *
 * A `dispatcher()` block in an action puts an `internal` message through the
 * seam `createFlowState` wires, and the message becomes a real request against
 * the flow's `internal` entry — in a child session the seam derived from the
 * dispatcher's key, or in an existing session the dispatcher named. Nothing is
 * injected: the seam reaches the block the way it reaches every block, under
 * the `DISPATCH_SEAM` slot `createExecutionContext` attaches.
 *
 * Pins both directions (BP-035): the two session policies that deliver, and the
 * two refusals an `id` policy can meet — a session that does not exist, and one
 * that is not this principal's. Every refusal is decided before anything is
 * dispatched, so the sender's request carries it and no child runs.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "../../src";
import type { FlowStateRuntime } from "../../src/flowstate/types";

const USER_ID = "u_dispatch";

type Observed = {
  runs: { sessionId: string; requestId: string; input: unknown }[];
};

/** A flow with one internal entry and two dispatchers reaching it. */
function messagingFlow(kind: string, observed: Observed) {
  const work = handler({
    name: "work",
    inputSchema: z.object({ note: z.string() }),
    outputSchema: z.object({}),
    execute: async (input, ctx) => {
      observed.runs.push({
        sessionId: ctx.session.identity.id,
        requestId: ctx.request.identity.id,
        input
      });
      return {};
    }
  });

  const spawn = dispatcher({
    name: "spawn-work",
    type: "internal",
    target: "work",
    inputSchema: z.object({ key: z.string(), note: z.string() }),
    session: { key: (input) => input.key },
    payload: (input) => ({ note: input.note })
  });

  const deliver = dispatcher({
    name: "deliver-work",
    type: "internal",
    target: "work",
    inputSchema: z.object({ to: z.string(), note: z.string() }),
    session: { id: (input) => input.to },
    payload: (input) => ({ note: input.note })
  });

  return defineFlow({
    kind,
    actions: { spawn: { block: spawn }, deliver: { block: deliver } },
    internal: { actions: { work: { block: work } } }
  })({ id: kind });
}

/** Poll until `predicate` holds — the dispatched request runs unawaited. */
async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function boot(kind: string) {
  const observed: Observed = { runs: [] };
  const flow = messagingFlow(kind, observed);
  const state = createFlowState({
    flows: { [kind]: flow },
    stores: { default: { primary: inMemoryStores() } }
  });
  const runtime = await state.getRuntime();
  return { observed, flow, runtime, state };
}

/** The `fsdev run` call shape: runtime config SPREAD, not passed by reference. */
function run(
  runtime: FlowStateRuntime,
  flow: ReturnType<typeof messagingFlow>,
  actionName: string,
  input: unknown,
  sessionId = "s_parent"
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

async function createSession(
  runtime: FlowStateRuntime,
  id: string,
  flowKind: string,
  userId: string
): Promise<void> {
  const ts = Date.now();
  await runtime.stores.session.set(
    id,
    { id, state: {}, version: 0, createdAt: ts, updatedAt: ts, flowKind, userId, journal: [] },
    "any"
  );
}

describe("a dispatcher spawning a child session (the `key` policy)", () => {
  it("runs the internal entry in a derived child, and the second dispatch adopts it", async () => {
    const { observed, flow, runtime, state } = await boot("seam-key");
    try {
      const first = await run(runtime, flow, "spawn", { key: "doc-1", note: "first" });
      expect(first.error).toBeUndefined();
      const handle = first.output as { sessionId: string; requestId: string; adopted: boolean };
      expect(handle.adopted).toBe(false);
      expect(handle.sessionId).not.toBe("s_parent");

      await until(() => observed.runs.length === 1, "the child to run");
      expect(observed.runs[0]).toMatchObject({
        sessionId: handle.sessionId,
        requestId: handle.requestId,
        input: { note: "first" }
      });

      // The child is a persisted, labelled descendant of the sender.
      const session = await runtime.stores.session.get(handle.sessionId);
      expect(session).toMatchObject({
        parentSessionId: "s_parent",
        flowKind: "seam-key",
        userId: USER_ID,
        topic: "doc-1",
        coordinate: "internal:work"
      });

      // The request record carries the dispatch type as its source and the
      // server-assembled provenance — never the sender's input.
      const record = await runtime.stores.request.get(handle.requestId);
      expect(record).toMatchObject({
        source: "internal",
        sessionId: handle.sessionId,
        actionName: "work",
        metadata: {
          dispatch: {
            type: "internal",
            target: "work",
            from: { block: "spawn-work", sessionId: "s_parent" },
            key: "doc-1"
          }
        }
      });

      // Same key from the same parent → the same child, adopted.
      const second = await run(runtime, flow, "spawn", { key: "doc-1", note: "second" });
      expect(second.error).toBeUndefined();
      expect(second.output).toMatchObject({ sessionId: handle.sessionId, adopted: true });
      await until(() => observed.runs.length === 2, "the second child run");
      expect(observed.runs[1]).toMatchObject({ sessionId: handle.sessionId, input: { note: "second" } });

      // A different key from the same parent → a different child.
      const other = await run(runtime, flow, "spawn", { key: "doc-2", note: "other" });
      expect((other.output as { sessionId: string }).sessionId).not.toBe(handle.sessionId);
    } finally {
      await state.dispose();
    }
  });
});

describe("a dispatcher delivering into an existing session (the `id` policy)", () => {
  it("runs the internal entry in the named session", async () => {
    const { observed, flow, runtime, state } = await boot("seam-id");
    try {
      await createSession(runtime, "s_peer", "seam-id", USER_ID);

      const result = await run(runtime, flow, "deliver", { to: "s_peer", note: "hello peer" });
      expect(result.error).toBeUndefined();
      expect(result.output).toMatchObject({ sessionId: "s_peer", adopted: true });

      await until(() => observed.runs.length === 1, "the delivery to run");
      expect(observed.runs[0]).toMatchObject({ sessionId: "s_peer", input: { note: "hello peer" } });

      const record = await runtime.stores.request.get(
        (result.output as { requestId: string }).requestId
      );
      expect(record).toMatchObject({ source: "internal", sessionId: "s_peer", actionName: "work" });
      expect((record?.metadata as { dispatch?: { key?: string } })?.dispatch?.key).toBeUndefined();
    } finally {
      await state.dispose();
    }
  });

  it("refuses a session that does not exist — never created", async () => {
    const { observed, flow, runtime, state } = await boot("seam-missing");
    try {
      const result = await run(runtime, flow, "deliver", { to: "s_nowhere", note: "lost" });
      expect(result.error?.message).toMatch(/session-not-found/);
      expect(result.error?.message).toMatch(/deliver-work/);
      expect(observed.runs).toHaveLength(0);
      expect(await runtime.stores.session.get("s_nowhere")).toBeUndefined();
    } finally {
      await state.dispose();
    }
  });

  it("refuses another principal's session, and one on another flow", async () => {
    const { observed, flow, runtime, state } = await boot("seam-foreign");
    try {
      await createSession(runtime, "s_bob", "seam-foreign", "u_bob");
      await createSession(runtime, "s_elsewhere", "another-flow", USER_ID);

      // Another principal's session answers the same refusal as an absent one, so a
      // sender cannot learn that a session exists across a boundary it cannot see.
      const bob = await run(runtime, flow, "deliver", { to: "s_bob", note: "hi bob" });
      expect(bob.error?.message).toMatch(/session-not-found/);

      const elsewhere = await run(runtime, flow, "deliver", { to: "s_elsewhere", note: "hi" });
      expect(elsewhere.error?.message).toMatch(/session-not-addressable/);

      expect(observed.runs).toHaveLength(0);
    } finally {
      await state.dispose();
    }
  });
});
