/**
 * S5 — hello-chat smoke.
 *
 * The simplest scenario in the suite. Exists primarily to confirm the
 * integration-tests package wiring works end-to-end: vitest can resolve
 * `@flow-state-dev/testing`, the hello-chat flow imports cleanly, and
 * `runAction` completes against in-memory stores with a mocked generator.
 *
 * If this test fails, none of the harder scenarios (S1, S6) are worth
 * debugging until it passes.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import helloChatFlow from "../../../../examples/hello-chat/src/flows/hello-chat/flow";
import { findMessage, messageText } from "../helpers/assertions";

describe("hello-chat smoke", () => {
  beforeAll(() => {
    // Hard-fail on accidental network access. Mocked tests should never
    // touch the wire.
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      throw new Error(`Unexpected network request in integration test: ${String(input)}`);
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("completes a chat action through runAction with a mocked generator", async () => {
    const result = await testFlow({
      flow: helloChatFlow,
      action: "chat",
      userId: "test-user",
      input: { message: "Hi" },
      generators: {
        "chat-generator": mockGenerator({
          name: "chat-generator",
          script: [{ text: "Hello!" }]
        })
      },
      unmockedGeneratorPolicy: "error"
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("completed");

    const assistant = findMessage(result.items, "assistant");
    expect(assistant).toBeDefined();
    expect(messageText(assistant!)).toBe("Hello!");
  });
});
