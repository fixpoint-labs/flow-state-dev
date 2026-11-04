/**
 * A failed turn on a real engine, end to end through the adapter: the engine
 * writes its `error` item, the conversation's feed carries it to a failed
 * entry with the engine's own reason, and the adapter's `retry` runs the
 * request again as a new one. Only the turn is scripted: a handler that throws
 * once, where a model call without a key would.
 */
import { createClient, type ClientFetch } from "@flow-state-dev/client";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowState, createInProcessFetch, inMemoryStores } from "@flow-state-dev/engine";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createLabAdapter, type ConversationEntry, type ConversationView } from "../src/adapter";

describe("on a real engine", () => {
  it("a turn that throws shows its reason, and Retry runs it again as a new request", async () => {
    let attempts = 0;
    const answer = handler({
      name: "answer",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("AI_GATEWAY_API_KEY is not set");
        return { ok: true };
      },
    });
    const flow = defineFlow({ kind: "lab-turn", actions: { respond: { block: answer, inputSchema: z.any() } } })();
    const app = createFlowState({ flows: { "lab-turn": flow }, stores: { default: { primary: inMemoryStores() } } });
    try {
      const client = createClient({ userId: "u1", fetcher: createInProcessFetch(app) as unknown as ClientFetch });
      const { id: sessionId } = await client.flow("lab-turn").createSession();
      const sent = await client.flow("lab-turn").send("respond", { message: "hi" }, { sessionId });
      expect((await sent.wait()).status).toBe("failed");

      const lab = createLabAdapter(client);
      const view = await new Promise<ConversationView>((resolve) => {
        const stop = lab.watchConversation(sessionId, (next) => {
          if (next.entries.some((e) => e.kind === "failed")) {
            stop();
            resolve(next);
          }
        });
      });
      const line = view.entries.find((e): e is Extract<ConversationEntry, { kind: "failed" }> => e.kind === "failed")!;
      expect(line).toMatchObject({ reason: "AI_GATEWAY_API_KEY is not set", requestId: sent.id, latest: true });

      await lab.retry(sessionId, line.requestId);
      const again = (await client.sessions.requests(sessionId, { limit: 10 })).find((r) => r.id !== sent.id);
      expect(again).toBeDefined();
      expect((await client.flow("lab-turn").request(again!.id).wait()).status).toBe("completed");
      expect(attempts).toBe(2);
    } finally {
      await app.dispose();
    }
  });
});
