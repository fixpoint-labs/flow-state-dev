/**
 * Cross-flow dispatch (FIX-1171 family / Architect D-8): one flow starts work
 * on another, fire-and-forget, and a miss is a **named runtime refusal**.
 *
 * The address is declared — `flowKind` + `target` on the `dispatcher()` block —
 * but `defineFlow` holds one flow's entry maps and cannot resolve another's, so
 * the check lands at the seam against the flows the process registered. The
 * three ways that goes are all here: it resolves, the flow is not registered
 * (`flow-not-found`), the flow is registered but declares no such entry
 * (`no-entry`). None of them retries, queues, or falls through to the sender's
 * own map — every one throws `DispatchRefusedError` inside the sending block.
 *
 * The reply half is the same three-request shape as within a flow
 * (`dispatch-reply-from.test.ts`), pointed across the boundary: B replies with
 * `{ from: true }` at `flowKind: <A>`, and a third request lands on A's
 * session.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, dispatcher, handler, sequencer } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "../../src";
import { readDispatchStamp } from "../../src/execution/dispatch-metadata";
import type { FlowStateRuntime } from "../../src/flowstate/types";

const USER_ID = "u_cross";
const SENDER = "shipping";
const RECIPIENT = "billing";
/** A third registered flow, so "wrong flow" is distinguishable from "no flow". */
const BYSTANDER = "analytics";

type Observed = {
  /** Runs of the recipient flow's entry — one per delivered dispatch. */
  arrivals: { sessionId: string; requestId: string; orderId: string }[];
  /** Runs of the sender flow's reply entry. */
  replies: { sessionId: string; requestId: string; orderId: string }[];
};

const orderInput = z.object({ orderId: z.string() });

/**
 * The sender: a public action that dispatches across the boundary, plus the
 * entry a reply lands on. `reply-target` names a flow, not this one, exactly
 * like the failing addresses below — what separates them is what the process
 * has registered, which is the whole point.
 */
function senderFlow(observed: Observed, options: { flowKind?: string; target?: string } = {}) {
  const receive = handler({
    name: "receive-confirmation",
    inputSchema: orderInput,
    outputSchema: z.object({}),
    execute: async (input, ctx) => {
      observed.replies.push({
        sessionId: ctx.session.identity.id,
        requestId: ctx.request.identity.id,
        orderId: input.orderId
      });
      return {};
    }
  });

  const notify = dispatcher({
    name: "notify-billing",
    type: "internal",
    flowKind: options.flowKind ?? RECIPIENT,
    target: options.target ?? "charge",
    inputSchema: orderInput,
    session: { key: (input) => input.orderId }
  });

  return defineFlow({
    kind: SENDER,
    actions: { notify: { block: notify } },
    internal: { actions: { confirm: { block: receive } } }
  })({ id: SENDER });
}

/**
 * The recipient: a `charge` entry that records its arrival and then replies
 * back across the boundary with `{ from: true }`.
 */
function recipientFlow(observed: Observed, options: { replyTo?: string } = {}) {
  const reply = dispatcher({
    name: "confirm-to-sender",
    type: "internal",
    flowKind: options.replyTo ?? SENDER,
    target: "confirm",
    inputSchema: orderInput,
    session: { from: true }
  });

  const charge = handler({
    name: "charge-order",
    inputSchema: orderInput,
    outputSchema: orderInput,
    execute: async (input, ctx) => {
      observed.arrivals.push({
        sessionId: ctx.session.identity.id,
        requestId: ctx.request.identity.id,
        orderId: input.orderId
      });
      return input;
    }
  });

  return defineFlow({
    kind: RECIPIENT,
    // Session state the sender's flow does not declare — the child must be
    // defaulted from the flow it BELONGS to, not the one that sent it.
    session: { stateSchema: z.object({ charged: z.boolean().default(false) }) },
    actions: {},
    internal: {
      actions: { charge: { block: sequencer({ name: "charge-and-confirm" }).step(charge).step(reply) } }
    }
  })({ id: RECIPIENT });
}

/**
 * A third registered flow that declares the same entry name as the sender, so a
 * reply misaddressed to it gets past entry resolution and is refused on the one
 * thing that separates the two flows: whose session the delivery names.
 */
function bystanderFlow() {
  const noop = handler({
    name: "noop",
    inputSchema: orderInput,
    outputSchema: z.object({}),
    execute: async () => ({})
  });
  return defineFlow({
    kind: BYSTANDER,
    actions: {},
    internal: { actions: { confirm: { block: noop } } }
  })({ id: BYSTANDER });
}

async function boot(flows: FlowInstance[]) {
  const state = createFlowState({
    flows: Object.fromEntries(flows.map((flow) => [flow.kind, flow])),
    stores: { default: { primary: inMemoryStores() } }
  });
  const runtime = await state.getRuntime();
  return { runtime, state };
}

function run(
  runtime: FlowStateRuntime,
  flow: FlowInstance,
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

async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Poll one request record until it satisfies `predicate`, then return it. */
async function untilRecord(
  runtime: FlowStateRuntime,
  requestId: string,
  predicate: (record: { status: string }) => boolean
): Promise<unknown> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const record = await runtime.stores.request.get(requestId);
    if (record !== undefined && predicate(record)) return record;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for request "${requestId}" to settle`);
}

function observed(): Observed {
  return { arrivals: [], replies: [] };
}

describe("cross-flow fire-and-forget", () => {
  it("delivers into a child session of the TARGET flow and returns without waiting", async () => {
    const seen = observed();
    const sender = senderFlow(seen);
    const { runtime, state } = await boot([sender, recipientFlow(seen)]);
    try {
      const sent = await run(runtime, sender, "notify", { orderId: "ord_1" });
      expect(sent.error).toBeUndefined();

      const handle = sent.output as { sessionId: string; requestId: string; adopted: boolean };
      expect(handle.adopted).toBe(false);
      expect(handle.sessionId).not.toBe("s_sender");

      await until(() => seen.arrivals.length === 1, "the billing entry to run");
      expect(seen.arrivals[0]).toMatchObject({
        sessionId: handle.sessionId,
        orderId: "ord_1"
      });

      // The child belongs to the recipient flow — its own kind, its own state
      // defaults, its own lineage — while still naming the sender as its parent.
      const child = await runtime.stores.session.get(handle.sessionId);
      expect(child?.flowKind).toBe(RECIPIENT);
      expect(child?.parentSessionId).toBe("s_sender");
      expect(child?.state).toMatchObject({ charged: false });

      const parent = await runtime.stores.session.get("s_sender");
      expect(parent?.flowKind).toBe(SENDER);
      // A cross-flow child roots its own lineage: the lineage is a shared
      // storage bucket with no flow in its key, so inheriting the sender's
      // would put two flows' `sharedToLineage` declarations on one cell.
      expect(child?.lineageId).not.toBe(parent?.lineageId);

      // The dispatched request records the boundary it crossed.
      const record = await runtime.stores.request.get(handle.requestId);
      expect(record?.flowKind).toBe(RECIPIENT);
      expect(readDispatchStamp(record?.source, record?.metadata)).toMatchObject({
        type: "internal",
        target: "charge",
        flowKind: RECIPIENT,
        flowId: RECIPIENT,
        from: { block: "notify-billing", sessionId: "s_sender" }
      });
    } finally {
      await state.dispose();
    }
  });

  it("refuses flow-not-found when the addressed flow is not registered here", async () => {
    const seen = observed();
    // Defining the flow is not the failure — an address `defineFlow` cannot
    // resolve is accepted at definition time, on purpose.
    const sender = senderFlow(seen, { flowKind: "warehouse" });
    const { runtime, state } = await boot([sender, recipientFlow(seen)]);
    try {
      const sent = await run(runtime, sender, "notify", { orderId: "ord_2" });
      expect(sent.error?.message).toMatch(/flow-not-found/);
      expect(sent.error?.message).toMatch(/warehouse/);
      expect(sent.error?.message).toMatch(/notify-billing/);
      expect(seen.arrivals).toHaveLength(0);
    } finally {
      await state.dispose();
    }
  });

  it("refuses no-entry when the addressed flow declares no such entry", async () => {
    const seen = observed();
    const sender = senderFlow(seen, { target: "refund" });
    const { runtime, state } = await boot([sender, recipientFlow(seen)]);
    try {
      const sent = await run(runtime, sender, "notify", { orderId: "ord_3" });
      expect(sent.error?.message).toMatch(/no-entry/);
      // Named against the flow the address pointed at, not the sender's.
      expect(sent.error?.message).toMatch(/"billing" declares no internal entry "refund"/);
      expect(seen.arrivals).toHaveLength(0);
    } finally {
      await state.dispose();
    }
  });

  it("does not fall through to an identically named entry on the SENDER's flow", async () => {
    const seen = observed();
    // `confirm` exists here — on the sender. The recipient declares no such
    // entry, and resolution must not walk back to the flow that dispatched.
    const sender = senderFlow(seen, { target: "confirm" });
    const { runtime, state } = await boot([sender, recipientFlow(seen)]);
    try {
      const sent = await run(runtime, sender, "notify", { orderId: "ord_4" });
      expect(sent.error?.message).toMatch(/no-entry/);
      expect(sent.error?.message).toMatch(/"billing" declares no internal entry "confirm"/);
      expect(seen.replies).toHaveLength(0);
    } finally {
      await state.dispose();
    }
  });

});

describe("three-request reverse delivery across flows", () => {
  it("A dispatches to B; B replies via the stamped sender; the reply lands on A", async () => {
    const seen = observed();
    const sender = senderFlow(seen);
    const { runtime, state } = await boot([sender, recipientFlow(seen)]);
    try {
      const first = await run(runtime, sender, "notify", { orderId: "ord_5" });
      expect(first.error).toBeUndefined();
      const handle = first.output as { sessionId: string; requestId: string };

      await until(() => seen.replies.length === 1, "the confirmation to land on shipping");

      expect(seen.arrivals).toHaveLength(1);
      expect(seen.replies[0]).toMatchObject({ sessionId: "s_sender", orderId: "ord_5" });
      // Three distinct requests: the caller's, the child's, the reply's.
      expect(seen.replies[0]?.requestId).not.toBe(first.requestId);
      expect(seen.replies[0]?.requestId).not.toBe(handle.requestId);

      const replyRecord = await runtime.stores.request.get(seen.replies[0]!.requestId);
      expect(replyRecord?.flowKind).toBe(SENDER);
      expect(readDispatchStamp(replyRecord?.source, replyRecord?.metadata)).toMatchObject({
        type: "internal",
        target: "confirm",
        flowKind: SENDER,
        from: { block: "confirm-to-sender", sessionId: handle.sessionId }
      });
    } finally {
      await state.dispose();
    }
  });

  it("refuses session-not-addressable when the stamped sender is not on the addressed flow", async () => {
    const seen = observed();
    const sender = senderFlow(seen);
    // The reply points at a registered flow the sender's session does not
    // belong to. `{ from: true }` supplies the session id; the address supplies
    // the flow; a delivery only happens when they agree.
    const { runtime, state } = await boot([
      sender,
      recipientFlow(seen, { replyTo: BYSTANDER }),
      bystanderFlow()
    ]);
    try {
      const first = await run(runtime, sender, "notify", { orderId: "ord_6" });
      expect(first.error).toBeUndefined();
      const handle = first.output as { requestId: string };
      await until(() => seen.arrivals.length === 1, "the billing entry to run");

      // The refusal reaches the recipient as a thrown `DispatchRefusedError`,
      // so the dispatched request FAILS rather than the reply landing anywhere.
      const childRecord = await untilRecord(
        runtime,
        handle.requestId,
        (record) => record.status === "failed" || record.status === "error"
      );
      const dump = JSON.stringify(childRecord);
      expect(dump).toMatch(/session-not-addressable/);
      expect(dump).toMatch(/belongs to flow[^,]*shipping/);
      expect(dump).toMatch(/this dispatch is addressed to flow[^,]*analytics/);
      expect(seen.replies).toHaveLength(0);
    } finally {
      await state.dispose();
    }
  });
});
