/**
 * S7 — session resume across two `testFlow` runs.
 *
 * Verifies the `stores` extension on `testFlow` lets multiple runs share a
 * session, and that idempotent seeding doesn't reset the session journal
 * or state on the second run.
 *
 * Hello-chat increments `messageCount` once per `chat` action; after two
 * runs the count should be 2.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import helloChatFlow from "../../../../examples/hello-chat/src/flows/hello-chat/flow";

describe("session resume", () => {
  beforeAll(() => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      throw new Error(`Unexpected network request in integration test: ${String(input)}`);
    });
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  it("preserves session state across two runs sharing the same store registry", async () => {
    const stores = createInMemoryStores();
    const sessionId = "test-session-resume";

    const r1 = await testFlow({
      flow: helloChatFlow,
      action: "chat",
      userId: "test-user",
      sessionId,
      stores,
      input: { message: "Round 1" },
      generators: {
        "chat-generator": mockGenerator({
          name: "chat-generator",
          script: [{ text: "Reply 1" }]
        })
      },
      unmockedGeneratorPolicy: "error"
    });
    expect(r1.status).toBe("completed");
    expect(r1.error).toBeUndefined();

    const r2 = await testFlow({
      flow: helloChatFlow,
      action: "chat",
      userId: "test-user",
      sessionId,
      stores,
      input: { message: "Round 2" },
      generators: {
        "chat-generator": mockGenerator({
          name: "chat-generator",
          script: [{ text: "Reply 2" }]
        })
      },
      unmockedGeneratorPolicy: "error"
    });
    expect(r2.status).toBe("completed");
    expect(r2.error).toBeUndefined();

    const session = await stores.session.get(sessionId);
    expect(session).toBeDefined();
    expect((session?.state as { messageCount?: number }).messageCount).toBe(2);
  });
});
