/**
 * A channel post reaches an agent seat through the kind's internal
 * `onChannelPost` entry.
 *
 * A channel's notify block is handed one delivery per member per post, and a
 * dispatch resolves only a flow's internal entries. So the kind carries one
 * that takes the delivery as it is handed over and runs the seat's ordinary
 * answer on it, with the post as the seat's turn: `<writer> in <channel>:
 * <body>`. The writer is the post's `author`, else its `principal`.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1590/PLAN.md`, V1):
 *   BR-7  a dispatch to the entry runs the seat's answer, and the model is
 *         handed the heard turn;
 *   BR-8  the heard turn is kept as the seat's user message, ahead of the reply;
 *   BR-9  a second post keyed on the same channel lands in the same
 *         conversation;
 *   BR-13 the same name on the public action route runs nothing.
 *
 * Red state produced before these were trusted: the kind without the entry —
 * the declaration case fails, and the dispatch is refused `no-entry`.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, dispatcher } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime } from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import { channelNotifyInputSchema, type ChannelNotifyInput } from "../src/index";
import { hireWorkforce } from "../src/hire";

const USER_ID = "u_channel";
const CHANNEL_SESSION = "support.desk";

/** A stand-in for a channel's fan-out: one dispatcher to the seat's receiver, keyed on the channel. */
function wakeFlow(seatId: string) {
  return defineFlow({
    kind: "wake-test",
    actions: {
      deliver: {
        inputSchema: channelNotifyInputSchema,
        block: dispatcher({
          name: "wake-seat",
          flowKind: seatId,
          action: "onChannelPost",
          inputSchema: channelNotifyInputSchema,
          session: { key: (post: ChannelNotifyInput) => `channel:${post.channelId}` }
        })
      }
    }
  })({ id: "wake-test" });
}

function boot() {
  const [seat] = hireWorkforce([{ id: "support.otto", declared: {}, body: "You answer questions." }]);
  const heard: string[] = [];
  const sender = wakeFlow(seat!.id);
  const state = createFlowState({
    flows: { [seat!.id]: seat!, [sender.id]: sender },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({
      generators: {
        "agent-answer": mockGenerator({
          name: "agent-answer",
          script: [
            {
              when: (input: unknown) => {
                heard.push(JSON.stringify(input));
                return true;
              },
              then: { text: "the reply" }
            }
          ]
        })
      },
      policy: "allow"
    })
  });
  return { seat: seat!, sender, state, heard };
}

function post(overrides: Partial<ChannelNotifyInput> = {}): ChannelNotifyInput {
  return {
    channelId: CHANNEL_SESSION,
    member: "support.otto",
    postId: "p_1",
    body: "can someone look at the refund queue?",
    principal: "devuser",
    ...overrides
  };
}

async function deliver(runtime: FlowStateRuntime, sender: ReturnType<typeof wakeFlow>, input: ChannelNotifyInput) {
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow: sender,
    actionName: "deliver",
    input,
    userId: USER_ID,
    sessionId: CHANNEL_SESSION,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig }
  });
  expect(result.error).toBeUndefined();
  return result.output as { sessionId: string; requestId: string; adopted: boolean };
}

/** Wait for a dispatched request to settle, then return it with its items. */
async function settled(runtime: FlowStateRuntime, sessionId: string, requestId: string) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const record = await runtime.stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") {
      const requests = await runtime.stores.request.list({ sessionId, withItems: true });
      return requests.find((request) => request.id === requestId)!;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`request ${requestId} never settled`);
}

/** The kept (non-transient) messages of one request, as role and text. */
function messagesOf(request: { items?: unknown[] }) {
  return (request.items ?? [])
    .filter((item) => (item as { type?: string }).type === "message")
    .map((item) => {
      const message = item as { role: string; transient?: boolean; content: Array<{ text?: string }> };
      return { role: message.role, transient: message.transient === true, text: message.content.map((c) => c.text ?? "").join("") };
    });
}

describe("the agent kind's channel receiver", () => {
  it("is declared as an internal entry taking the channel's delivery, and nowhere public", () => {
    const { seat } = boot();
    const entry = seat.internal?.actions.onChannelPost;
    expect(entry, "the agent kind declares no internal onChannelPost").toBeDefined();
    expect(entry!.inputSchema).toBe(channelNotifyInputSchema);
    // Default concurrency: a queued request expires after the engine's wait,
    // which would drop a post that arrives behind a slow answer (BR-10).
    expect(entry!.concurrency).toBeUndefined();
    expect(Object.keys(seat.actions)).toEqual(["run"]);
  });

  it("runs the seat's answer on a dispatched post, keeping the heard turn ahead of the reply", async () => {
    const { sender, state, heard } = boot();
    try {
      const runtime = await state.getRuntime();
      const handle = await deliver(runtime, sender, post());
      const request = await settled(runtime, handle.sessionId, handle.requestId);
      expect(request.status).toBe("completed");

      const turn = "devuser in support.desk: can someone look at the refund queue?";
      expect(messagesOf(request)).toEqual([
        { role: "user", transient: false, text: turn },
        { role: "assistant", transient: false, text: "the reply" }
      ]);
      // The model was handed the heard turn, not the raw delivery.
      expect(heard.some((input) => input.includes(turn))).toBe(true);

      // The run is a child of the channel's session, on the seat's own flow.
      const child = await runtime.stores.session.get(handle.sessionId);
      expect(child?.flowKind).toBe("agent");
      expect(child?.parentSessionId).toBe(CHANNEL_SESSION);
    } finally {
      await state.dispose();
    }
  });

  it("names the author as the writer when a seat wrote the post", async () => {
    const { sender, state } = boot();
    try {
      const runtime = await state.getRuntime();
      const handle = await deliver(runtime, sender, post({ author: "support.iris", body: "done" }));
      const request = await settled(runtime, handle.sessionId, handle.requestId);
      expect(messagesOf(request)[0]).toEqual({ role: "user", transient: false, text: "support.iris in support.desk: done" });
    } finally {
      await state.dispose();
    }
  });

  it("lands a second post on the same channel in the same conversation", async () => {
    const { sender, state } = boot();
    try {
      const runtime = await state.getRuntime();
      const first = await deliver(runtime, sender, post());
      await settled(runtime, first.sessionId, first.requestId);
      const second = await deliver(runtime, sender, post({ postId: "p_2", body: "and the shipping one" }));
      await settled(runtime, second.sessionId, second.requestId);

      expect(second.sessionId).toBe(first.sessionId);
      expect(second.adopted).toBe(true);
      const requests = await runtime.stores.request.list({ sessionId: first.sessionId, withItems: true });
      const turns = requests.flatMap(messagesOf).filter((m) => m.role === "user").map((m) => m.text);
      expect(turns.sort()).toEqual([
        "devuser in support.desk: and the shipping one",
        "devuser in support.desk: can someone look at the refund queue?"
      ]);
    } finally {
      await state.dispose();
    }
  });

  it("is refused on the public action route and runs nothing", async () => {
    const { seat, state, heard } = boot();
    try {
      const router = await state.getRouter();
      const segments = [seat.id, "actions", "onChannelPost"];
      const res = await router.POST(
        new Request(`http://localhost/api/flows/${segments.map(encodeURIComponent).join("/")}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: USER_ID, sessionId: "s_public", input: post() })
        }),
        { params: { path: segments } }
      );
      // The public route resolves `flow.actions` only, so an internal name is
      // an action the flow does not define there.
      const text = await res.text();
      expect(res.status, text).toBeGreaterThanOrEqual(400);
      expect(text).toContain('does not define action \\"onChannelPost\\"');
      expect(heard).toEqual([]);
    } finally {
      await state.dispose();
    }
  });
});
