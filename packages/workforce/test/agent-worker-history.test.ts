/**
 * An agent seat hears the earlier turns of its own conversation, and only
 * those.
 *
 * A person who tells a seat "I need a new laptop" and then asks "where can I
 * buy it?" is asking about the laptop. The seat can only answer that if the
 * model is handed the first turn along with the second. What it must never be
 * handed is another conversation's turns: a seat talks in one conversation per
 * mailbox and one per direct conversation, and a mailbox's seat that repeats
 * what a person told it in private is a leak, not memory.
 *
 * What is graded is what the model was sent, read off the scripted model's
 * calls, never the stored items: a turn can be stored and still not reach the
 * model, which is exactly the failure this file exists for.
 *
 * Red state produced before these were trusted: the kind's answer without its
 * `history` slot. The first and third checks fail (turn 2 sends the system
 * prompt and the new message only), and so do the positive halves of the
 * second. The second's negative halves pass on that red state because nothing
 * is sent at all, so their blast radius was taken separately: with the direct
 * conversation moved onto the seat's mailbox conversation, both go red and the
 * other two checks stay green.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime } from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import { mailboxNotifyInputSchema, wakeMemberSeats, type MailboxNotifyInput } from "../src/index";
import { hireWorkforce } from "../src/hire";

const USER_ID = "u_person";
const SEAT = "support.devices";
const MAILBOX = "support.desk";

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
 * One seat on an in-process host, with a scripted model that answers the
 * laptop question by name and everything else with "noted", and a stand-in
 * for a mailbox's notify step built from the real `wakeMemberSeats`, so a
 * post reaches the seat in the conversation a real mailbox would use.
 */
function boot() {
  const [seat] = hireWorkforce([{ id: SEAT, declared: {}, body: "You answer device questions." }]);
  const answer = mockGenerator({
    name: "agent-answer",
    script: [
      { when: (input: unknown) => turnOf(input) === "I need a new laptop.", then: { text: "Which model are you after?" } },
      { when: () => true, then: { text: "noted" } }
    ]
  });
  const mailbox = defineFlow({
    kind: "mailbox-notify-stand-in",
    actions: { deliver: { inputSchema: mailboxNotifyInputSchema, block: wakeMemberSeats([seat!]) } }
  })({ id: "mailbox-notify-stand-in" });
  const state = createFlowState({
    flows: { [seat!.id]: seat!, [mailbox.id]: mailbox },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({ generators: { "agent-answer": answer }, policy: "allow" })
  });
  return { seat: seat!, mailbox, state, answer };
}

/** One direct turn with the seat, in the conversation named `sessionId`. */
async function say(runtime: FlowStateRuntime, seat: FlowInstance, sessionId: string, message: string) {
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow: seat,
    actionName: "run",
    input: { message },
    userId: USER_ID,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig }
  });
  expect(result.error).toBeUndefined();
}

/** One mailbox post delivered to the seat; resolves once the seat has answered it. */
async function post(runtime: FlowStateRuntime, mailbox: FlowInstance, postId: string, body: string) {
  const delivery: MailboxNotifyInput = { mailboxId: MAILBOX, member: SEAT, postId, body, principal: "devuser" };
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow: mailbox,
    actionName: "deliver",
    input: delivery,
    userId: USER_ID,
    sessionId: MAILBOX,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig }
  });
  expect(result.error).toBeUndefined();
  const handle = result.output as { sessionId: string; requestId: string };
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const record = await runtime.stores.request.get(handle.requestId);
    if (record !== undefined && record.status !== "in_progress") {
      expect(record.status).toBe("completed");
      return handle.sessionId;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`the seat never answered post ${postId}`);
}

describe("an agent seat's conversation", () => {
  it("hands the model the earlier turns of a direct conversation, in order, ahead of the new one", async () => {
    const { seat, state, answer } = boot();
    try {
      const runtime = await state.getRuntime();
      await say(runtime, seat, "direct-talk", "I need a new laptop.");
      await say(runtime, seat, "direct-talk", "Where can I buy it?");

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

  it("keeps a seat's mailbox conversation and its direct conversation apart", async () => {
    const { seat, mailbox, state, answer } = boot();
    try {
      const runtime = await state.getRuntime();
      // Interleaved, so each conversation's second turn runs after the other
      // conversation already holds something it could leak.
      await say(runtime, seat, "direct-talk", "My badge number is 4417.");
      await post(runtime, mailbox, "p_1", "The printer on floor 3 is jammed.");
      await say(runtime, seat, "direct-talk", "What is my badge number?");
      await post(runtime, mailbox, "p_2", "Any update?");

      const callFor = (turn: string) => {
        const call = answer.calls.find((c) => turnOf(c.input) === turn);
        expect(call, `the model was never asked "${turn}"`).toBeDefined();
        return conversation(call!.input).map((m) => m.text).join("\n");
      };
      const directSecond = callFor("What is my badge number?");
      const mailboxSecond = callFor("devuser in support.desk: Any update?");

      // Each conversation remembers its own earlier turn...
      expect(directSecond).toContain("My badge number is 4417.");
      expect(mailboxSecond).toContain("The printer on floor 3 is jammed.");
      // ...and never hears the other one's.
      expect(directSecond).not.toContain("printer");
      expect(mailboxSecond).not.toContain("badge");
    } finally {
      await state.dispose();
    }
  });

  it("hands the model at most the framework's history window of earlier turns", async () => {
    const { seat, state, answer } = boot();
    try {
      const runtime = await state.getRuntime();
      // The window is the session's 50 most recent completed turns. Turn 52
      // has 51 behind it, so the oldest falls out and the next 50 stay.
      const turns = Array.from({ length: 52 }, (_, i) => `turn ${i + 1}`);
      for (const turn of turns) await say(runtime, seat, "long-talk", turn);

      const asked = sent(answer.calls.at(-1)!.input)
        .filter((m) => m.role === "user")
        .map((m) => m.text);
      expect(asked).toEqual(turns.slice(1));
    } finally {
      await state.dispose();
    }
  }, 60_000);
});
