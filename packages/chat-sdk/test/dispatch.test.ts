/**
 * Behavioral tests for declarative chat dispatch (FIX-667, FIX-838).
 * Exercises `dispatchChatEvent` directly against the subscription index:
 * matching, broadcast fan-out, `when`/`input`/`sessionId` resolution and error
 * isolation, the no-match no-op (the adapter-mount `route()`/`flowKind`
 * fallback was removed), the namespaced `metadata.chat.eventKey` stamp, the
 * block-name provenance on `action`, and the `streamToThread` precedence chain.
 *
 * Bindings carry the handler `block` inline (the shared action core), so the
 * dispatched `action` is the block name (provenance) and resolution happens via
 * the `metadata.chat.eventKey` coordinate, never the name.
 */
import { describe, expect, it, vi } from "vitest";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import type { FlowInstance, ChatEventBinding } from "@flow-state-dev/core";
import type {
  InboundTransportHost,
  InboundRequestEnvelope,
} from "@flow-state-dev/server";
import { dispatchChatEvent } from "../src/event-handlers";
import { buildChatSubscriptionIndex } from "../src/subscription-index";
import type { ChatAdapterOptions, ChatInboundEvent } from "../src/types";

/** A handler block with a known name — its name is the dispatched `action`. */
function blk(name: string) {
  return handler({
    name,
    inputSchema: z.object({}).passthrough(),
    execute: () => undefined,
  });
}

type RecordingHost = {
  host: InboundTransportHost;
  calls: InboundRequestEnvelope[];
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

function makeHost(flows: FlowInstance[]): RecordingHost {
  const calls: InboundRequestEnvelope[] = [];
  const warn = vi.fn();
  const error = vi.fn();
  const host = {
    registry: {
      list: () => flows,
      get: (kind: string) => flows.find((f) => f.kind === kind),
    },
    stores: {
      session: { get: async () => undefined, set: async () => undefined },
    },
    logger: { warn, error, info: vi.fn(), debug: vi.fn() },
    dispatch(envelope: InboundRequestEnvelope) {
      calls.push(envelope);
      return {
        requestId: `req_${calls.length}`,
        responseEmitter: null as never,
        liveStream: null,
        finished: Promise.resolve({ output: undefined, items: [], durationMs: 0 }),
      };
    },
    resolvePrincipal: async () => ({ userId: "u" }),
  } as unknown as InboundTransportHost;
  return { host, calls, warn, error };
}

function flow(kind: string, on: Record<string, ChatEventBinding>, streamToThread?: boolean): FlowInstance {
  return {
    kind,
    id: kind,
    actions: {},
    chat: { on, ...(streamToThread !== undefined ? { streamToThread } : {}) },
  } as unknown as FlowInstance;
}

function mentionEvent(overrides: Partial<ChatInboundEvent> = {}): ChatInboundEvent {
  return {
    kind: "mention",
    thread: { id: "thread-1", isDM: false, adapter: { name: "slack" } } as never,
    message: { id: "m1", text: "hi", author: { userId: "alice" } } as never,
    platform: "slack",
    raw: {},
    ...overrides,
  };
}

/** Read the namespaced chat metadata off a recorded envelope. */
function chatMeta(envelope: InboundRequestEnvelope): Record<string, unknown> {
  return (envelope.metadata as { chat: Record<string, unknown> }).chat;
}

// `streamToThread: false` keeps the stream bridge out of the dispatch path
// so these tests assert envelope construction without a live emitter.
const baseOptions: ChatAdapterOptions = { bot: {} as never, streamToThread: false };

describe("dispatchChatEvent — flow-level subscriptions", () => {
  it("dispatches a single matching binding with the resolved envelope", async () => {
    const flows = [
      flow("support", { mention: { block: blk("reply"), input: () => ({ text: "x" }) } }, false),
    ];
    const { host, calls } = makeHost(flows);
    await dispatchChatEvent(host, baseOptions, mentionEvent(), buildChatSubscriptionIndex(flows));

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      source: "chat",
      flowKind: "support",
      // Block-name provenance, not a named-action reference.
      action: "reply",
      input: { text: "x" },
      sessionId: "thread-1",
    });
    expect(chatMeta(calls[0]).eventKey).toBe("mention");
    expect(chatMeta(calls[0]).platform).toBe("slack");
  });

  it("awaits an async input before constructing the envelope", async () => {
    const flows = [
      flow("support", {
        mention: { block: blk("reply"), input: async () => ({ text: "async" }) },
      }, false),
    ];
    const { host, calls } = makeHost(flows);
    await dispatchChatEvent(host, baseOptions, mentionEvent(), buildChatSubscriptionIndex(flows));
    expect(calls[0].input).toEqual({ text: "async" });
  });

  it("broadcasts to two flows subscribing to the same event", async () => {
    const flows = [
      flow("a", { mention: { block: blk("x"), input: () => 1 } }, false),
      flow("b", { mention: { block: blk("y"), input: () => 2 } }, false),
    ];
    const { host, calls } = makeHost(flows);
    await dispatchChatEvent(host, baseOptions, mentionEvent(), buildChatSubscriptionIndex(flows));
    expect(calls.map((c) => c.flowKind).sort()).toEqual(["a", "b"]);
  });

  it("skips a binding whose when predicate is falsy, fires the matching one", async () => {
    const flows = [
      flow("slackOnly", { mention: { block: blk("s"), input: () => 1, when: (e: any) => e.platform === "slack" } }, false),
      flow("discordOnly", { mention: { block: blk("d"), input: () => 1, when: (e: any) => e.platform === "discord" } }, false),
    ];
    const { host, calls } = makeHost(flows);
    await dispatchChatEvent(host, baseOptions, mentionEvent({ platform: "slack" }), buildChatSubscriptionIndex(flows));
    expect(calls).toHaveLength(1);
    expect(calls[0].flowKind).toBe("slackOnly");
  });

  it("treats a throwing when as no match and does not abort siblings", async () => {
    const flows = [
      flow("boom", { mention: { block: blk("x"), input: () => 1, when: () => { throw new Error("nope"); } } }, false),
      flow("ok", { mention: { block: blk("y"), input: () => 2 } }, false),
    ];
    const { host, calls, error } = makeHost(flows);
    await dispatchChatEvent(host, baseOptions, mentionEvent(), buildChatSubscriptionIndex(flows));
    expect(calls.map((c) => c.flowKind)).toEqual(["ok"]);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("`when` threw"),
      expect.objectContaining({ code: "CHAT_BINDING_WHEN_THROWS" })
    );
  });

  it("skips only the binding whose input throws", async () => {
    const flows = [
      flow("boom", { mention: { block: blk("x"), input: () => { throw new Error("bad"); } } }, false),
      flow("ok", { mention: { block: blk("y"), input: () => 2 } }, false),
    ];
    const { host, calls, error } = makeHost(flows);
    await dispatchChatEvent(host, baseOptions, mentionEvent(), buildChatSubscriptionIndex(flows));
    expect(calls.map((c) => c.flowKind)).toEqual(["ok"]);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("`input` threw"),
      expect.objectContaining({ code: "CHAT_BINDING_INPUT_THROWS" })
    );
  });

  it("uses a binding-provided sessionId override", async () => {
    const flows = [
      flow("support", { mention: { block: blk("reply"), input: () => 1, sessionId: () => "custom-session" } }, false),
    ];
    const { host, calls } = makeHost(flows);
    await dispatchChatEvent(host, baseOptions, mentionEvent(), buildChatSubscriptionIndex(flows));
    expect(calls[0].sessionId).toBe("custom-session");
  });

  it("falls back to thread id when sessionId returns undefined", async () => {
    const flows = [
      flow("support", { mention: { block: blk("reply"), input: () => 1, sessionId: () => undefined } }, false),
    ];
    const { host, calls } = makeHost(flows);
    await dispatchChatEvent(host, baseOptions, mentionEvent(), buildChatSubscriptionIndex(flows));
    expect(calls[0].sessionId).toBe("thread-1");
  });

  it("falls back to thread id when sessionId throws", async () => {
    const flows = [
      flow("support", { mention: { block: blk("reply"), input: () => 1, sessionId: () => { throw new Error("x"); } } }, false),
    ];
    const { host, calls, error } = makeHost(flows);
    await dispatchChatEvent(host, baseOptions, mentionEvent(), buildChatSubscriptionIndex(flows));
    expect(calls[0].sessionId).toBe("thread-1");
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("`sessionId` threw"),
      expect.objectContaining({ code: "CHAT_BINDING_SESSION_THROWS" })
    );
  });
});

describe("dispatchChatEvent — no matching subscription", () => {
  it("is a no-op when no flow subscription matches (no route() fallback)", async () => {
    const flows: FlowInstance[] = [];
    const { host, calls } = makeHost(flows);
    await dispatchChatEvent(host, baseOptions, mentionEvent(), buildChatSubscriptionIndex(flows));
    expect(calls).toHaveLength(0);
  });

  it("is a no-op when a flow is registered but its when predicate rejects the event", async () => {
    const flows = [
      flow("discordOnly", { mention: { block: blk("d"), input: () => 1, when: (e: any) => e.platform === "discord" } }, false),
    ];
    const { host, calls } = makeHost(flows);
    await dispatchChatEvent(host, baseOptions, mentionEvent({ platform: "slack" }), buildChatSubscriptionIndex(flows));
    expect(calls).toHaveLength(0);
  });
});

describe("dispatchChatEvent — streamToThread precedence", () => {
  // responseEmitter === undefined in the envelope signals stream-to-thread on.
  function emitterMode(envelope: InboundRequestEnvelope): "stream" | "no-stream" {
    return envelope.responseEmitter === null ? "no-stream" : "stream";
  }

  it("flow.chat.streamToThread wins over adapter default", async () => {
    const flows = [flow("support", { mention: { block: blk("reply"), input: () => 1 } }, false)];
    const { host, calls } = makeHost(flows);
    // adapter default true, flow says false → no stream
    await dispatchChatEvent(host, { bot: {} as never, streamToThread: true }, mentionEvent(), buildChatSubscriptionIndex(flows));
    expect(emitterMode(calls[0])).toBe("no-stream");
  });

  it("flow.chat.streamToThread wins over flowOverrides", async () => {
    const flows = [flow("support", { mention: { block: blk("reply"), input: () => 1 } }, false)];
    const { host, calls } = makeHost(flows);
    await dispatchChatEvent(
      host,
      { bot: {} as never, flowOverrides: { support: { streamToThread: true } } },
      mentionEvent(),
      buildChatSubscriptionIndex(flows)
    );
    expect(emitterMode(calls[0])).toBe("no-stream");
  });

  it("falls through to adapter streamToThread when flow leaves it unset", async () => {
    const flows = [flow("support", { mention: { block: blk("reply"), input: () => 1 } })];
    const { host, calls } = makeHost(flows);
    await dispatchChatEvent(host, { bot: {} as never, streamToThread: false }, mentionEvent(), buildChatSubscriptionIndex(flows));
    expect(emitterMode(calls[0])).toBe("no-stream");
  });
});
