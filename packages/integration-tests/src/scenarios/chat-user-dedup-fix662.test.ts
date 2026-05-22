/**
 * FIX-662 regression — end-to-end through runAction → createExecutionContext
 * → generator message assembly.
 *
 * The chat-flow fixture wires both `action.userMessage` and the generator's
 * `user` slot to `input.message` (the canonical chat-agent shape). Prior to
 * FIX-662 this produced two adjacent `{role:"user"}` entries in the model's
 * messages array, which Anthropic silently merges by concatenation. Locks
 * the fix: exactly one user-role message reaches the model.
 */
import { describe, expect, it } from "vitest";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import chatFlow from "./fixtures/chat-flow";

describe("FIX-662: action.userMessage + generator.user dedup", () => {
  it("emits the user's current turn exactly once on the wire", async () => {
    const chatMock = mockGenerator({
      name: "chat-generator",
      script: [{ text: "hi back" }]
    });

    const result = await testFlow({
      flow: chatFlow,
      action: "chat",
      userId: "test-user",
      input: { message: "hello" },
      generators: { "chat-generator": chatMock },
      unmockedGeneratorPolicy: "error"
    });

    expect(result.error).toBeUndefined();
    expect(chatMock.calls).toHaveLength(1);

    const messages = chatMock.calls[0]!.input as Array<{ role: string; content: unknown }>;
    const userMessages = messages.filter((m) => m.role === "user");

    // Pre-fix: two user-role entries with content "hello". Post-fix: one.
    expect(userMessages).toHaveLength(1);
    const text = typeof userMessages[0]!.content === "string"
      ? userMessages[0]!.content
      : JSON.stringify(userMessages[0]!.content);
    expect(text).toContain("hello");
    expect(text).not.toBe("hellohello");
  });
});
