/**
 * Reverse dispatch (FIX-1312 / FIX-1171): a dispatched child delivers a real
 * request back to the seam-stamped sender.
 *
 * Three requests, same flow: A dispatches to B; B replies with
 * `session: { from: true }`; a third request lands on A's session.
 *
 * `settleParentTask` is the board-row close and is not this path. The child
 * here was not dispatched for a task, so settle refuses `no-parent-task`
 * while the reply still delivers.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineFlow,
  dispatcher,
  handler,
  requireRequestHost,
  sequencer
} from "@flow-state-dev/core";
import { createFlowState, createInMemoryStores, inMemoryStores, runAction } from "../../src";
import { createRequestHost } from "../../src/context/create-request-host";
import { readDispatchStamp } from "../../src/execution/dispatch-metadata";
import type { FlowStateRuntime } from "../../src/flowstate/types";
import type { SessionRecord } from "../../src/stores/types";

const USER_ID = "u_reply";

type Observed = {
  childRuns: { sessionId: string; requestId: string }[];
  replies: { sessionId: string; requestId: string; note: string }[];
  settlements: unknown[];
};

function replyFlow(kind: string, observed: Observed) {
  const receive = handler({
    name: "receive",
    inputSchema: z.object({ note: z.string() }),
    outputSchema: z.object({}),
    execute: async (input, ctx) => {
      observed.replies.push({
        sessionId: ctx.session.identity.id,
        requestId: ctx.request.identity.id,
        note: input.note
      });
      return {};
    }
  });

  const reply = dispatcher({
    name: "reply-to-sender",
    type: "internal",
    target: "receive",
    inputSchema: z.object({ note: z.string() }),
    session: { from: true },
    payload: (input) => ({ note: input.note })
  });

  const doWork = handler({
    name: "do-work",
    inputSchema: z.object({ note: z.string() }),
    outputSchema: z.object({ note: z.string() }),
    execute: async (input, ctx) => {
      observed.childRuns.push({
        sessionId: ctx.session.identity.id,
        requestId: ctx.request.identity.id
      });
      observed.settlements.push(
        await requireRequestHost(ctx).settleParentTask({ outcome: "complete" })
      );
      return { note: input.note };
    }
  });

  const work = sequencer({ name: "work" }).step(doWork).step(reply);

  const start = dispatcher({
    name: "start-work",
    type: "internal",
    target: "work",
    inputSchema: z.object({ note: z.string() }),
    session: { key: () => "job" },
    payload: (input) => ({ note: input.note })
  });

  return defineFlow({
    kind,
    actions: { start: { block: start }, replyNow: { block: reply } },
    internal: { actions: { work: { block: work }, receive: { block: receive } } }
  })({ id: kind });
}

/**
 * A → B → C → B. C replies `{ from: true }`; the third request must land on
 * B (the immediate stamped sender), not A (the oldest ancestor).
 */
function nestedReplyFlow(kind: string, observed: Observed) {
  const receive = handler({
    name: "receive",
    inputSchema: z.object({ note: z.string() }),
    outputSchema: z.object({}),
    execute: async (input, ctx) => {
      observed.replies.push({
        sessionId: ctx.session.identity.id,
        requestId: ctx.request.identity.id,
        note: input.note
      });
      return {};
    }
  });

  const reply = dispatcher({
    name: "reply-to-sender",
    type: "internal",
    target: "receive",
    inputSchema: z.object({ note: z.string() }),
    session: { from: true },
    payload: (input) => ({ note: input.note })
  });

  const doLeafWork = handler({
    name: "do-leaf-work",
    inputSchema: z.object({ note: z.string() }),
    outputSchema: z.object({ note: z.string() }),
    execute: async (input, ctx) => {
      observed.childRuns.push({
        sessionId: ctx.session.identity.id,
        requestId: ctx.request.identity.id
      });
      return { note: input.note };
    }
  });

  const leaf = sequencer({ name: "leaf" }).step(doLeafWork).step(reply);

  const fan = dispatcher({
    name: "fan-to-leaf",
    type: "internal",
    target: "leaf",
    inputSchema: z.object({ note: z.string() }),
    session: { key: () => "nested" },
    payload: (input) => ({ note: input.note })
  });

  const mid = sequencer({ name: "mid" }).step(fan);

  const start = dispatcher({
    name: "start-mid",
    type: "internal",
    target: "mid",
    inputSchema: z.object({ note: z.string() }),
    session: { key: () => "job" },
    payload: (input) => ({ note: input.note })
  });

  return defineFlow({
    kind,
    actions: { start: { block: start } },
    internal: {
      actions: {
        mid: { block: mid },
        leaf: { block: leaf },
        receive: { block: receive }
      }
    }
  })({ id: kind });
}

async function until(predicate: () => boolean, label: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function boot(
  kind: string,
  flowOf: (kind: string, observed: Observed) => ReturnType<typeof replyFlow>
) {
  const observed: Observed = { childRuns: [], replies: [], settlements: [] };
  const flow = flowOf(kind, observed);
  const state = createFlowState({
    flows: { [kind]: flow },
    stores: { default: { primary: inMemoryStores() } }
  });
  const runtime = await state.getRuntime();
  return { observed, flow, runtime, state };
}

function run(
  runtime: FlowStateRuntime,
  flow: ReturnType<typeof replyFlow>,
  actionName: string,
  input: unknown,
  sessionId = "s_parent",
  metadata?: Record<string, unknown>
) {
  return runAction({
    flow,
    actionName,
    input,
    userId: USER_ID,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig },
    ...(metadata !== undefined ? { metadata } : {})
  });
}

describe("three-request reverse delivery (FIX-1312 / FIX-1171)", () => {
  it("A dispatches to B; B replies via stamped from; a third request lands on A", async () => {
    const { observed, flow, runtime, state } = await boot("reply-from-happy", replyFlow);
    try {
      const first = await run(runtime, flow, "start", { note: "looked up" });
      expect(first.error).toBeUndefined();
      const child = first.output as { sessionId: string; requestId: string };
      expect(child.sessionId).not.toBe("s_parent");

      await until(() => observed.replies.length === 1, "the reply to land on A");

      expect(observed.childRuns).toHaveLength(1);
      expect(observed.childRuns[0]?.sessionId).toBe(child.sessionId);
      expect(observed.replies[0]).toMatchObject({
        sessionId: "s_parent",
        note: "looked up"
      });
      expect(observed.replies[0]?.requestId).not.toBe(first.requestId);
      expect(observed.replies[0]?.requestId).not.toBe(child.requestId);

      // Board-row settle is a different verb and is not this path.
      expect(observed.settlements).toEqual([
        {
          ok: false,
          refused: "no-parent-task",
          detail: expect.stringMatching(/not dispatched for a parent-board task/)
        }
      ]);

      const replyRecord = await runtime.stores.request.get(observed.replies[0]!.requestId);
      const stamp = readDispatchStamp(replyRecord?.source, replyRecord?.metadata);
      expect(stamp).toMatchObject({
        type: "internal",
        target: "receive",
        from: { block: "reply-to-sender", sessionId: child.sessionId }
      });
      expect(stamp?.recipientLineageId).toEqual(expect.any(String));
    } finally {
      await state.dispose();
    }
  });

  it("refuses no-sender on a public action, even when the caller forges metadata.dispatch.from", async () => {
    const { flow, runtime, state } = await boot("reply-from-forged", replyFlow);
    try {
      const sent = await run(
        runtime,
        flow,
        "replyNow",
        { note: "forged" },
        "s_parent",
        {
          dispatch: {
            type: "internal",
            target: "receive",
            from: { block: "forged", sessionId: "s_parent" }
          }
        }
      );
      expect(sent.error?.message).toMatch(/no-sender/);
      expect(sent.error?.message).toMatch(/reply-to-sender/);
    } finally {
      await state.dispose();
    }
  });

  it("nested { from: true } replies to the immediate stamped sender, not an oldest ancestor", async () => {
    const { observed, flow, runtime, state } = await boot("reply-from-nested", nestedReplyFlow);
    try {
      const first = await run(runtime, flow, "start", { note: "inner" });
      expect(first.error).toBeUndefined();
      const mid = first.output as { sessionId: string; requestId: string };
      expect(mid.sessionId).not.toBe("s_parent");

      await until(() => observed.replies.length === 1, "the leaf reply to land on B");

      expect(observed.childRuns).toHaveLength(1);
      expect(observed.childRuns[0]?.sessionId).not.toBe(mid.sessionId);
      expect(observed.childRuns[0]?.sessionId).not.toBe("s_parent");
      expect(observed.replies[0]).toMatchObject({
        sessionId: mid.sessionId,
        note: "inner"
      });
      expect(observed.replies[0]?.sessionId).not.toBe("s_parent");
    } finally {
      await state.dispose();
    }
  });
});

describe("the seam reads only a trusted stamp for { from: true }", () => {
  function receiveFlow(kind: string) {
    const receive = handler({
      name: "receive",
      inputSchema: z.object({ note: z.string() }),
      outputSchema: z.object({}),
      execute: async () => ({})
    });
    return defineFlow({
      kind,
      actions: { ping: { block: receive } },
      internal: { actions: { receive: { block: receive } } }
    })({ id: kind });
  }

  function session(id: string, userId: string, flowKind: string): SessionRecord {
    const ts = Date.now();
    return {
      id,
      state: {},
      version: 0,
      createdAt: ts,
      updatedAt: ts,
      flowKind,
      userId,
      journal: [],
      lineageId: `lin_${id}`
    };
  }

  async function hostFor(args: {
    kind: string;
    source?: string;
    metadata?: unknown;
    userId?: string;
  }) {
    const stores = createInMemoryStores();
    const kind = args.kind;
    await stores.session.set("s_sender", session("s_sender", "u_alice", kind), "any");
    await stores.session.set("s_other", session("s_other", "u_bob", kind), "any");
    const started: string[] = [];
    const { seam } = createRequestHost({
      stores,
      flow: receiveFlow(kind),
      identity: {
        userId: args.userId ?? "u_alice",
        tenantId: undefined,
        orgId: undefined,
        sessionId: "s_child",
        lineageId: "lin_child"
      },
      source: args.source,
      metadata: args.metadata,
      dispatchOperation: async (spec) => {
        started.push(spec.sessionId);
        return { requestId: "req_reply" };
      },
      liveness: {
        heartbeatIntervalMs: 10_000,
        staleThresholdMs: 60_000,
        staleSweepIntervalMs: 30_000
      }
    });
    return { seam, started };
  }

  const replySpec = {
    type: "internal" as const,
    target: "receive",
    session: { from: true as const },
    payload: { note: "back" },
    from: "reply-to-sender"
  };

  it("refuses no-sender when source is http, even with a perfectly shaped bag", async () => {
    const { seam, started } = await hostFor({
      kind: "reply-unit-http",
      source: "http",
      metadata: {
        dispatch: {
          type: "internal",
          target: "receive",
          from: { block: "forged", sessionId: "s_sender" }
        }
      }
    });
    const outcome = await seam(replySpec);
    expect(outcome).toMatchObject({ ok: false, refused: "no-sender" });
    expect(started).toEqual([]);
  });

  it("refuses session-not-found when the stamped sender is another principal's", async () => {
    const { seam, started } = await hostFor({
      kind: "reply-unit-principal",
      source: "internal",
      metadata: {
        dispatch: {
          type: "internal",
          target: "work",
          from: { block: "start-work", sessionId: "s_other" }
        }
      }
    });
    const outcome = await seam(replySpec);
    expect(outcome).toMatchObject({ ok: false, refused: "session-not-found" });
    expect(started).toEqual([]);
  });

  it("delivers into the stamped sender when source is internal", async () => {
    const { seam, started } = await hostFor({
      kind: "reply-unit-ok",
      source: "internal",
      metadata: {
        dispatch: {
          type: "internal",
          target: "work",
          from: { block: "start-work", sessionId: "s_sender" }
        }
      }
    });
    const outcome = await seam(replySpec);
    expect(outcome).toEqual({
      ok: true,
      sessionId: "s_sender",
      requestId: "req_reply",
      adopted: true
    });
    expect(started).toEqual(["s_sender"]);
  });
});
