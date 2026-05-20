// Regression tests for FIX-662: user-input duplication between
// `action.userMessage` (which emits a runtime MessageItem that flows into
// historyValues via live items) and the generator's `user` slot. When both
// resolve to identical content, the message-assembly layer must emit the
// user's turn exactly once. The canonical wiring is the kitchen-sink
// chat-agent template, which is the dual-wired pattern these tests lock.

import { describe, expect, it } from "vitest";
import { generator } from "../../src";
import { createMockContext, runForTest } from "../helpers";

type CapturedMessages = unknown[];

function makeCapturingCtx(captured: { messages?: CapturedMessages }) {
  return createMockContext({
    resolveModel: () => ({
      modelId: "mock",
      async generate(options: { messages: unknown[] }) {
        captured.messages = options.messages;
        return { text: "ok" };
      }
    }) as any
  });
}

function userMessages(messages: CapturedMessages | undefined): unknown[] {
  return (messages ?? []).filter(
    (m): m is { role: "user"; content: unknown } =>
      typeof m === "object" && m !== null && (m as { role?: unknown }).role === "user"
  );
}

describe("FIX-662: generator user-slot dedup", () => {
  it("drops the leading userValues duplicate when historyValues ends with the same user message", async () => {
    // Headline regression: the kitchen-sink bug shape. typing "1" produced
    // [{user,"1"},{user,"1"}] which Anthropic merged into "11".
    const captured: { messages?: CapturedMessages } = {};
    const block = generator({
      name: "dual-wired",
      model: "mock",
      prompt: "system",
      history: () => [{ role: "user", content: "1" }],
      user: () => "1"
    });

    await runForTest(block, { value: "x" }, makeCapturingCtx(captured));

    const users = userMessages(captured.messages);
    expect(users).toHaveLength(1);
    expect(users[0]).toEqual({ role: "user", content: "1" });
  });

  it("keeps both when user-slot content differs from historyValues tail", async () => {
    const captured: { messages?: CapturedMessages } = {};
    const block = generator({
      name: "reformulated",
      model: "mock",
      prompt: "p",
      history: () => [{ role: "user", content: "1" }],
      user: () => "Reformulate: 1"
    });

    await runForTest(block, { value: "x" }, makeCapturingCtx(captured));

    const users = userMessages(captured.messages);
    expect(users).toHaveLength(2);
    expect(users[0]).toEqual({ role: "user", content: "1" });
    expect(users[1]).toEqual({ role: "user", content: "Reformulate: 1" });
  });

  it("does not dedup when historyValues ends with an assistant message", async () => {
    const captured: { messages?: CapturedMessages } = {};
    const block = generator({
      name: "after-assistant",
      model: "mock",
      prompt: "p",
      history: () => [
        { role: "user", content: "earlier" },
        { role: "assistant", content: "response" }
      ],
      user: () => "earlier"
    });

    await runForTest(block, { value: "x" }, makeCapturingCtx(captured));

    const users = userMessages(captured.messages);
    expect(users).toHaveLength(2);
    expect(users[1]).toEqual({ role: "user", content: "earlier" });
  });

  it("does nothing when userValues is empty even if history ends with a user message", async () => {
    const captured: { messages?: CapturedMessages } = {};
    const block = generator({
      name: "no-user-slot",
      model: "mock",
      prompt: "p",
      history: () => [{ role: "user", content: "1" }]
    });

    await runForTest(block, { value: "x" }, makeCapturingCtx(captured));

    const users = userMessages(captured.messages);
    expect(users).toHaveLength(1);
    expect(users[0]).toEqual({ role: "user", content: "1" });
  });

  it("does not dedup when historyValues is empty", async () => {
    const captured: { messages?: CapturedMessages } = {};
    const block = generator({
      name: "no-history",
      model: "mock",
      prompt: "p",
      user: () => "1"
    });

    await runForTest(block, { value: "x" }, makeCapturingCtx(captured));

    const users = userMessages(captured.messages);
    expect(users).toHaveLength(1);
    expect(users[0]).toEqual({ role: "user", content: "1" });
  });

  it("only examines the leading userValues entry; subsequent entries pass through", async () => {
    const captured: { messages?: CapturedMessages } = {};
    const block = generator({
      name: "multi-user",
      model: "mock",
      prompt: "p",
      history: () => [{ role: "user", content: "1" }],
      user: () => ["1", "follow-up"]
    });

    await runForTest(block, { value: "x" }, makeCapturingCtx(captured));

    const users = userMessages(captured.messages);
    expect(users).toHaveLength(2);
    expect(users[0]).toEqual({ role: "user", content: "1" });
    expect(users[1]).toEqual({ role: "user", content: "follow-up" });
  });

  it("dedups multipart content when both sides produce equivalent shapes", async () => {
    const captured: { messages?: CapturedMessages } = {};
    const multipart = { role: "user", content: [{ type: "text", text: "1" }] };
    const block = generator({
      name: "multipart-match",
      model: "mock",
      prompt: "p",
      history: () => [multipart],
      user: () => ({ ...multipart })
    });

    await runForTest(block, { value: "x" }, makeCapturingCtx(captured));

    const users = userMessages(captured.messages);
    expect(users).toHaveLength(1);
  });

  it("dedups multipart content regardless of object key insertion order", async () => {
    // Guards against the latent failure mode where the two producers
    // (asUserMessage, itemToLLMMessages) might serialize structurally
    // equal parts with different key insertion order. Stable-key
    // stringify makes equivalence robust to that.
    const captured: { messages?: CapturedMessages } = {};
    const historyPart = { type: "text", text: "hello" };
    const userPart = { text: "hello", type: "text" };
    const block = generator({
      name: "multipart-key-order",
      model: "mock",
      prompt: "p",
      history: () => [{ role: "user", content: [historyPart] }],
      user: () => ({ role: "user", content: [userPart] })
    });

    await runForTest(block, { value: "x" }, makeCapturingCtx(captured));

    const users = userMessages(captured.messages);
    expect(users).toHaveLength(1);
  });

  it("handles undefined content without throwing or returning a non-string key", async () => {
    // Defensive: messages with undefined content should never match
    // anything sensible, and the key function must remain a string.
    const captured: { messages?: CapturedMessages } = {};
    const block = generator({
      name: "undefined-content",
      model: "mock",
      prompt: "p",
      history: () => [{ role: "user", content: undefined as unknown as string }],
      user: () => "real text"
    });

    await runForTest(block, { value: "x" }, makeCapturingCtx(captured));
    // Either dedup fires or not — the contract here is "no crash, and the
    // real text still reaches the model exactly once if no dedup fires."
    const users = userMessages(captured.messages);
    const realTextEntries = users.filter((u) => u.content === "real text");
    expect(realTextEntries).toHaveLength(1);
  });

  it("does not dedup multipart messages with structurally different content", async () => {
    const captured: { messages?: CapturedMessages } = {};
    const block = generator({
      name: "multipart-mismatch",
      model: "mock",
      prompt: "p",
      history: () => [{ role: "user", content: [{ type: "text", text: "1" }] }],
      user: () => ({ role: "user", content: [{ type: "text", text: "2" }] })
    });

    await runForTest(block, { value: "x" }, makeCapturingCtx(captured));

    const users = userMessages(captured.messages);
    expect(users).toHaveLength(2);
  });

  it("does not dedup sub-generator-style content where user slot is workspace state", async () => {
    const captured: { messages?: CapturedMessages } = {};
    const block = generator({
      name: "worker-style",
      model: "mock",
      prompt: "p",
      history: () => [{ role: "user", content: "user typed something else" }],
      user: () => "Workspace entries:\n- foo"
    });

    await runForTest(block, { value: "x" }, makeCapturingCtx(captured));

    const users = userMessages(captured.messages);
    expect(users).toHaveLength(2);
  });

  it("custom history slot footgun: dedups when custom history ends in a matching user message (documented limitation)", async () => {
    // §3.6 / §7-item-8: a developer-provided history function that returns
    // a list ending with a user message identical to the `user` slot's
    // output will trigger the dedup. The user slot emission is suppressed
    // and the model sees only the custom history's user message. This test
    // locks the documented out-of-scope behavior so a future scoped fix
    // surfaces as a deliberate update rather than a silent regression.
    const captured: { messages?: CapturedMessages } = {};
    const block = generator({
      name: "custom-history-footgun",
      model: "mock",
      prompt: "p",
      history: () => [{ role: "user", content: "manual" }],
      user: () => "manual"
    });

    await runForTest(block, { value: "x" }, makeCapturingCtx(captured));

    const users = userMessages(captured.messages);
    expect(users).toHaveLength(1);
    expect(users[0]).toEqual({ role: "user", content: "manual" });
  });
});
