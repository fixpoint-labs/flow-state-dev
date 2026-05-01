/**
 * S2 — ask mode happy path.
 *
 * Single round-trip: the user asks a question, the assistant responds in
 * one generator call with no tool use. Verifies the simplest path through
 * `runAction` produces user + assistant message items in the expected
 * shape and emits no errors.
 */
import { describe, expect, it } from "vitest";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import chatFlow from "./fixtures/chat-flow";
import { findMessage, itemsByType, messageText } from "../helpers/assertions";

describe("ask-mode happy path", () => {
  it("produces a single round-trip with no errors", async () => {
    const result = await testFlow({
      flow: chatFlow,
      action: "chat",
      userId: "test-user",
      input: { message: "What is 2+2?" },
      generators: {
        "chat-generator": mockGenerator({
          name: "chat-generator",
          script: [{ text: "2+2 equals 4." }]
        })
      },
      unmockedGeneratorPolicy: "error"
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    const userMsg = findMessage(result.items, "user");
    expect(userMsg).toBeDefined();
    expect(messageText(userMsg!)).toContain("What is 2+2");

    const assistantMsg = findMessage(result.items, "assistant");
    expect(assistantMsg).toBeDefined();
    expect(messageText(assistantMsg!)).toContain("4");

    expect(itemsByType(result.items, "error")).toHaveLength(0);
  });
});
