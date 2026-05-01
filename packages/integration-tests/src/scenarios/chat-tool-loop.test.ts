/**
 * S4 — tool-loop convergence.
 *
 * The mocked generator emits two `search` tool calls in sequence, then a
 * final answer. Verifies the runtime invokes the registered tool block
 * twice and lands on the terminal text response without exceeding the
 * iteration budget.
 */
import { describe, expect, it } from "vitest";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import chatFlow from "./fixtures/chat-flow";
import { findMessage, findToolCalls, messageText } from "../helpers/assertions";

describe("tool-loop convergence", () => {
  it("terminates after two tool calls and a final answer", async () => {
    const result = await testFlow({
      flow: chatFlow,
      action: "chat",
      userId: "test-user",
      input: { message: "Look up X and Y" },
      generators: {
        "chat-generator": mockGenerator({
          name: "chat-generator",
          script: [
            {
              toolCalls: [
                { toolCallId: "tc_1", toolName: "search", args: { query: "X" } }
              ]
            },
            {
              toolCalls: [
                { toolCallId: "tc_2", toolName: "search", args: { query: "Y" } }
              ]
            },
            { text: "X and Y both check out." }
          ]
        })
      },
      unmockedGeneratorPolicy: "error"
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    const toolCalls = findToolCalls(result.items);
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls.map((c) => c.toolCall.name)).toEqual(["search", "search"]);

    const assistantMsg = findMessage(result.items, "assistant");
    expect(assistantMsg).toBeDefined();
    expect(messageText(assistantMsg!)).toBe("X and Y both check out.");
  });
});
