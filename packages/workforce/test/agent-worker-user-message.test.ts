/**
 * A message to an agent seat is kept as the caller's turn.
 *
 * A seat is a direct conversation with that agent, so its session has to hold
 * both sides: what the person said and what the seat answered. Before this,
 * `run` recorded only the reply, and a page reloading a seat's conversation
 * showed answers to questions nobody could see.
 *
 * Red state produced before this was trusted: `run` without its
 * `userMessage` — the request's items hold the reply and no user message.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import { hireWorkforce } from "../src/hire";

const USER_ID = "u_person";

describe("a message to an agent seat", () => {
  it("is kept in the seat's conversation as the caller's turn, ahead of the reply", async () => {
    const [seat] = hireWorkforce([{ id: "support.otto", declared: {}, body: "You answer questions." }]);
    const state = createFlowState({
      flows: { [seat!.id]: seat! },
      stores: { default: { primary: inMemoryStores() } },
      modelResolver: createMockModelResolver({
        generators: {
          "agent-answer": mockGenerator({ name: "agent-answer", script: [{ when: () => true, then: { text: "the reply" } }] })
        },
        policy: "allow"
      })
    });
    try {
      const runtime = await state.getRuntime();
      const result = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow: seat!,
        actionName: "run",
        input: { message: "where is my refund?" },
        userId: USER_ID,
        sessionId: "otto-conversation",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });
      expect(result.error).toBeUndefined();

      const [request] = await runtime.stores.request.list({ sessionId: "otto-conversation", withItems: true });
      const messages = (request?.items ?? [])
        .filter((item) => item.type === "message")
        .map((item) => {
          const message = item as unknown as { role: string; transient?: boolean; content: Array<{ text?: string }> };
          return { role: message.role, transient: message.transient === true, text: message.content.map((c) => c.text ?? "").join("") };
        });
      expect(messages).toEqual([
        { role: "user", transient: false, text: "where is my refund?" },
        { role: "assistant", transient: false, text: "the reply" }
      ]);
    } finally {
      await state.dispose();
    }
  });
});
