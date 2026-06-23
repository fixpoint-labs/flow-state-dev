/**
 * Registration-time validation for the per-flow `chat` config (FIX-667,
 * FIX-838). A chat binding is an action in chat form: it carries the handler
 * `block` inline (the shared `ActionCore`), so validation requires a `block`
 * and there is no named-action reference to check. Covers `validateChatConfig`
 * directly and through `defineFlow`: a missing block or malformed binding field
 * throws; absent/empty configs are accepted as no-ops; an event-only handler
 * does NOT appear in `flow.actions`.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "../src";
import { validateChatConfig, type ChatConfig } from "../src/types/chat";

const noopHandler = handler({
  name: "noop",
  inputSchema: z.object({ text: z.string().optional() }),
  execute: () => undefined
});

describe("validateChatConfig", () => {
  it("is a no-op when chat is absent", () => {
    expect(() => validateChatConfig("demo", undefined)).not.toThrow();
  });

  it("is a no-op when chat.on is absent (streamToThread only)", () => {
    expect(() => validateChatConfig("demo", { streamToThread: false })).not.toThrow();
  });

  it("is a no-op for an empty on map", () => {
    expect(() => validateChatConfig("demo", { on: {} })).not.toThrow();
  });

  it("accepts a minimal valid binding carrying an inline block", () => {
    const chat: ChatConfig = {
      on: { mention: { block: noopHandler, input: () => ({ text: "hi" }) } }
    };
    expect(() => validateChatConfig("demo", chat)).not.toThrow();
  });

  it("rejects a binding with no block", () => {
    const chat = {
      on: { mention: { input: () => ({}) } }
    } as unknown as ChatConfig;
    expect(() => validateChatConfig("demo", chat)).toThrow(/must declare a `block`/);
  });

  it("rejects an empty event key", () => {
    const chat: ChatConfig = {
      on: { "": { block: noopHandler, input: () => ({}) } }
    };
    expect(() => validateChatConfig("demo", chat)).toThrow(/empty event key/);
  });

  it("rejects a non-function input", () => {
    const chat = {
      on: { mention: { block: noopHandler, input: "nope" } }
    } as unknown as ChatConfig;
    expect(() => validateChatConfig("demo", chat)).toThrow(/`input`/);
  });

  it("rejects a non-function sessionId", () => {
    const chat = {
      on: {
        mention: { block: noopHandler, input: () => ({}), sessionId: "nope" }
      }
    } as unknown as ChatConfig;
    expect(() => validateChatConfig("demo", chat)).toThrow(/`sessionId`/);
  });

  it("rejects a non-function when predicate", () => {
    const chat = {
      on: { mention: { block: noopHandler, input: () => ({}), when: true } }
    } as unknown as ChatConfig;
    expect(() => validateChatConfig("demo", chat)).toThrow(/`when`/);
  });
});

describe("defineFlow with chat config", () => {
  it("registers a flow declaring valid chat subscriptions carrying inline blocks", () => {
    const flow = defineFlow({
      kind: "support",
      actions: {},
      chat: {
        on: {
          mention: {
            block: noopHandler,
            input: (e) => e,
            sessionId: () => "thread-1",
            when: () => true
          }
        },
        streamToThread: false
      }
    });
    expect(flow.chat?.on?.mention?.block).toBe(noopHandler);
    expect(flow.chat?.streamToThread).toBe(false);
  });

  it("throws at definition time when a binding has no block", () => {
    expect(() =>
      defineFlow({
        kind: "support",
        actions: {},
        // @ts-expect-error — block is required on a chat binding
        chat: { on: { mention: { input: (e) => e } } }
      })
    ).toThrow(/must declare a `block`/);
  });

  it("keeps an event-only chat handler out of flow.actions (no caller surface)", () => {
    const flow = defineFlow({
      kind: "support",
      actions: {},
      chat: { on: { mention: { block: noopHandler, input: (e) => e } } }
    });
    expect(Object.keys(flow.actions)).toHaveLength(0);
    expect(flow.actions).not.toHaveProperty("noop");
  });
});
