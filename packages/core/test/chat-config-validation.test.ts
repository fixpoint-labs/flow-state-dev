/**
 * Registration-time validation for the per-flow `chat` config (FIX-667).
 * Covers `validateChatConfig` directly and through `defineFlow`: unknown
 * actions and malformed binding fields throw; absent/empty configs are
 * accepted as no-ops.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "../src";
import { validateChatConfig, type ChatConfig } from "../src/types/chat";
import type { ActionConfig } from "../src/types/flow";

const noopHandler = handler({
  name: "noop",
  inputSchema: z.object({ text: z.string().optional() }),
  execute: () => undefined
});

const actions: Record<string, ActionConfig> = {
  reply: { block: noopHandler }
};

describe("validateChatConfig", () => {
  it("is a no-op when chat is absent", () => {
    expect(() => validateChatConfig("demo", undefined, actions)).not.toThrow();
  });

  it("is a no-op when chat.on is absent (streamToThread only)", () => {
    expect(() =>
      validateChatConfig("demo", { streamToThread: false }, actions)
    ).not.toThrow();
  });

  it("is a no-op for an empty on map", () => {
    expect(() => validateChatConfig("demo", { on: {} }, actions)).not.toThrow();
  });

  it("accepts a minimal valid binding", () => {
    const chat: ChatConfig = {
      on: { mention: { action: "reply", input: () => ({ text: "hi" }) } }
    };
    expect(() => validateChatConfig("demo", chat, actions)).not.toThrow();
  });

  it("rejects a binding referencing an unknown action", () => {
    const chat: ChatConfig = {
      on: { mention: { action: "ghost", input: () => ({}) } }
    };
    expect(() => validateChatConfig("demo", chat, actions)).toThrow(
      /references action "ghost"/
    );
  });

  it("rejects an empty event key", () => {
    const chat: ChatConfig = {
      on: { "": { action: "reply", input: () => ({}) } }
    };
    expect(() => validateChatConfig("demo", chat, actions)).toThrow(/empty event key/);
  });

  it("rejects a non-function input", () => {
    const chat = {
      on: { mention: { action: "reply", input: "nope" } }
    } as unknown as ChatConfig;
    expect(() => validateChatConfig("demo", chat, actions)).toThrow(/`input`/);
  });

  it("rejects a non-function sessionId", () => {
    const chat = {
      on: {
        mention: { action: "reply", input: () => ({}), sessionId: "nope" }
      }
    } as unknown as ChatConfig;
    expect(() => validateChatConfig("demo", chat, actions)).toThrow(/`sessionId`/);
  });

  it("rejects a non-function when predicate", () => {
    const chat = {
      on: { mention: { action: "reply", input: () => ({}), when: true } }
    } as unknown as ChatConfig;
    expect(() => validateChatConfig("demo", chat, actions)).toThrow(/`when`/);
  });
});

describe("defineFlow with chat config", () => {
  it("registers a flow declaring valid chat subscriptions", () => {
    const flow = defineFlow({
      kind: "support",
      actions: { reply: { block: noopHandler } },
      chat: {
        on: {
          mention: {
            action: "reply",
            input: (e) => e,
            sessionId: () => "thread-1",
            when: () => true
          }
        },
        streamToThread: false
      }
    });
    expect(flow.chat?.on?.mention?.action).toBe("reply");
    expect(flow.chat?.streamToThread).toBe(false);
  });

  it("throws at definition time when a binding names an unknown action", () => {
    expect(() =>
      defineFlow({
        kind: "support",
        actions: { reply: { block: noopHandler } },
        chat: { on: { mention: { action: "missing", input: (e) => e } } }
      })
    ).toThrow(/references action "missing"/);
  });
});
