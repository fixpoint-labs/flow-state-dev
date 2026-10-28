/**
 * An agent worker hears the earlier turns of its own conversation, and only
 * those.
 *
 * A user who tells a worker "I need a new laptop" and then asks "where can I
 * buy it?" is asking about the laptop. The worker can only answer that if the
 * model is handed the first turn along with the second. What it must never be
 * handed is another conversation's turns: a worker talks in one session per
 * conversation, and a worker that repeats in one conversation what a user
 * told it in another is a leak, not memory.
 *
 * What is graded is what the model was sent, read off the scripted model's
 * calls, never the stored items: a turn can be stored and still not reach the
 * model, which is exactly the failure this file exists for.
 *
 * Red state produced before these were trusted: the worker flow's answer without its
 * `history` slot. The first and third checks fail (turn 2 sends the system
 * prompt and the new message only), and so do the positive halves of the
 * second. The second's negative halves pass on that red state because nothing
 * is sent at all, so their blast radius was taken separately: with the two
 * conversations moved onto one session, both go red and the other two checks
 * stay green.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime } from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import { mintWorkers } from "../src/hire";

const USER_ID = "u_person";
const WORKER = "support.devices";

type Sent = { role: string; text: string };

/** Every message the model was sent on one call, as role and flattened text. */
function sent(messages: unknown): Sent[] {
  return (messages as Array<{ role: string; content: unknown }>).map((m) => ({
    role: m.role,
    text:
      typeof m.content === "string"
        ? m.content
        : (m.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("")
  }));
}

/** The conversation part of a call: everything but the system prompt. */
function conversation(messages: unknown): Sent[] {
  return sent(messages).filter((m) => m.role !== "system");
}

/** The text of the last user message on a call — the turn being answered. */
function turnOf(messages: unknown): string | undefined {
  return sent(messages).filter((m) => m.role === "user").at(-1)?.text;
}

/**
 * One worker on an in-process host, with a scripted model that answers the
 * laptop question by name and everything else with "noted".
 */
function boot() {
  const [worker] = mintWorkers([{ id: WORKER, declared: {}, body: "You answer device questions." }]);
  const answer = mockGenerator({
    name: "agent-answer",
    script: [
      { when: (input: unknown) => turnOf(input) === "I need a new laptop.", then: { text: "Which model are you after?" } },
      { when: () => true, then: { text: "noted" } }
    ]
  });
  const state = createFlowState({
    flows: { [worker!.id]: worker! },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({ generators: { "agent-answer": answer }, policy: "allow" })
  });
  return { worker: worker!, state, answer };
}

/** One direct turn with the worker, in the conversation named `sessionId`. */
async function say(runtime: FlowStateRuntime, worker: FlowInstance, sessionId: string, message: string) {
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow: worker,
    actionName: "respond",
    input: { message },
    userId: USER_ID,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig }
  });
  expect(result.error).toBeUndefined();
}

describe("an agent worker's conversation", () => {
  it("hands the model the earlier turns of a direct conversation, in order, ahead of the new one", async () => {
    const { worker, state, answer } = boot();
    try {
      const runtime = await state.getRuntime();
      await say(runtime, worker, "direct-talk", "I need a new laptop.");
      await say(runtime, worker, "direct-talk", "Where can I buy it?");

      // Both sides of turn 1, then turn 2 once: the question has its subject.
      expect(conversation(answer.calls[1]!.input)).toEqual([
        { role: "user", text: "I need a new laptop." },
        { role: "assistant", text: "Which model are you after?" },
        { role: "user", text: "Where can I buy it?" }
      ]);
    } finally {
      await state.dispose();
    }
  });

  it("keeps two of a worker's conversations apart", async () => {
    const { worker, state, answer } = boot();
    try {
      const runtime = await state.getRuntime();
      // Interleaved, so each conversation's second turn runs after the other
      // conversation already holds something it could leak.
      await say(runtime, worker, "direct-talk", "My badge number is 4417.");
      await say(runtime, worker, "desk-talk", "The printer on floor 3 is jammed.");
      await say(runtime, worker, "direct-talk", "What is my badge number?");
      await say(runtime, worker, "desk-talk", "Any update?");

      const callFor = (turn: string) => {
        const call = answer.calls.find((c) => turnOf(c.input) === turn);
        expect(call, `the model was never asked "${turn}"`).toBeDefined();
        return conversation(call!.input).map((m) => m.text).join("\n");
      };
      const directSecond = callFor("What is my badge number?");
      const deskSecond = callFor("Any update?");

      // Each conversation remembers its own earlier turn...
      expect(directSecond).toContain("My badge number is 4417.");
      expect(deskSecond).toContain("The printer on floor 3 is jammed.");
      // ...and never hears the other one's.
      expect(directSecond).not.toContain("printer");
      expect(deskSecond).not.toContain("badge");
    } finally {
      await state.dispose();
    }
  });

  it("hands the model at most the framework's history window of earlier turns", async () => {
    const { worker, state, answer } = boot();
    try {
      const runtime = await state.getRuntime();
      // The window is the session's 50 most recent completed turns. Turn 52
      // has 51 behind it, so the oldest falls out and the next 50 stay.
      const turns = Array.from({ length: 52 }, (_, i) => `turn ${i + 1}`);
      for (const turn of turns) await say(runtime, worker, "long-talk", turn);

      const asked = sent(answer.calls.at(-1)!.input)
        .filter((m) => m.role === "user")
        .map((m) => m.text);
      expect(asked).toEqual(turns.slice(1));
    } finally {
      await state.dispose();
    }
  }, 60_000);
});
