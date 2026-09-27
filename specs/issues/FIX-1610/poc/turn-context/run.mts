/**
 * FIX-1610 · turn-context POC. Throwaway, retained as evidence; see README.md.
 *
 * Keyless: scripted models only. Two questions, each answered by running the
 * real engine with in-memory stores and reading what the model was sent.
 *
 *   C1  What does the built-in agent kind send its model on a second turn in
 *       the same conversation? (characterization of today's `main`)
 *   C2  Does a generator's `context` slot reach the model on its own turn only,
 *       and stay out of the stored conversation, even for a generator that
 *       reads its history?
 *
 * POC_CONTROL=in-user-message puts the channel lines into the user message
 * instead of the context slot. C2 must then fail: the lines come back on the
 * next turn as history.
 *
 * Exit 0 when C2 holds. C1 is reported, not asserted.
 */

import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, generator } from "../../../../../packages/core/src/index.ts";
import { createFlowState, inMemoryStores, runAction } from "../../../../../packages/engine/src/index.ts";
import { createMockModelResolver, mockGenerator } from "../../../../../packages/testing/src/index.ts";
import { hireWorkforce } from "../../../../../packages/workforce/src/hire.ts";

const control = process.env.POC_CONTROL;
const USER = "u_person";

/** Every text the model was sent on one call, flattened, with its role. */
function sent(messages: unknown): Array<{ role: string; text: string }> {
  return (messages as Array<{ role: string; content: unknown }>).map((m) => ({
    role: m.role,
    text:
      typeof m.content === "string"
        ? m.content
        : (m.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("")
  }));
}

/**
 * The stored items of a session, as JSON, split into the conversation (the
 * message items a later turn's history is read from) and everything else
 * (block traces and the like, which record a block's input for inspection).
 */
async function storedTexts(runtime: Awaited<ReturnType<ReturnType<typeof createFlowState>["getRuntime"]>>, sessionId: string) {
  const requests = await runtime.stores.request.list({ sessionId, withItems: true });
  const items = requests.flatMap((r) => r.items ?? []);
  return {
    conversation: items.filter((item) => item.type === "message").map((item) => JSON.stringify(item)),
    other: items.filter((item) => item.type !== "message").map((item) => `${item.type}:${JSON.stringify(item)}`)
  };
}

// ---------------------------------------------------------------------------
// C1 · the built-in agent kind, two turns in one conversation
// ---------------------------------------------------------------------------

async function c1() {
  const answer = mockGenerator({ name: "agent-answer", script: [{ when: () => true, then: { text: "Try forgetting the network." } }] });
  const [seat] = hireWorkforce([{ id: "support.devices", declared: {}, body: "You answer device questions." }]);
  const state = createFlowState({
    flows: { [seat!.id]: seat! },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({ generators: { "agent-answer": answer }, policy: "allow" })
  });
  try {
    const runtime = await state.getRuntime();
    for (const message of ["My MacBook won't join the office wifi.", "Where can I buy it?"]) {
      const result = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow: seat!,
        actionName: "run",
        input: { message },
        userId: USER,
        sessionId: "devices-conversation",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig, logger: {} }
      });
      if (result.error) throw result.error;
    }
    const second = sent(answer.calls[1]!.input);
    const stored = await storedTexts(runtime, "devices-conversation");
    const sawFirst = second.some((m) => m.text.includes("MacBook"));
    console.log(`C1  agent kind, turn 2 sends ${second.length} message(s): ${second.map((m) => m.role).join(", ")}`);
    console.log(`    turn 1 ("MacBook") stored in the conversation: ${stored.conversation.some((s) => s.includes("MacBook"))}`);
    console.log(`    turn 1 sent to the model on turn 2: ${sawFirst}`);
  } finally {
    await state.dispose();
  }
}

// ---------------------------------------------------------------------------
// C2 · a generator's context slot, per turn, never stored
// ---------------------------------------------------------------------------

async function c2(): Promise<boolean> {
  const model = mockGenerator({ name: "specialist", script: [{ when: () => true, then: { text: "Here you go." } }] });
  const inputSchema = z.object({ message: z.string(), recent: z.string().optional() });
  // The turn as the model gets it and as the conversation keeps it. Under the
  // control, the lines are written into the turn itself.
  const asTurn = (input: z.infer<typeof inputSchema>) =>
    control === "in-user-message" && input.recent !== undefined ? `${input.recent}\n\n${input.message}` : input.message;
  const specialist = generator({
    name: "specialist",
    inputSchema,
    model: "scripted",
    itemVisibility: { client: true, history: true },
    history: true, // reads its own conversation, so a leak would show
    prompt: "You answer device questions.",
    context: (input: z.infer<typeof inputSchema>) =>
      control === "in-user-message" || input.recent === undefined ? undefined : `Recent lines in the channel:\n${input.recent}`,
    user: (input: z.infer<typeof inputSchema>) => asTurn(input)
  });
  const flow = defineFlow({
    kind: "turn-context",
    actions: { run: { inputSchema, block: specialist, userMessage: asTurn } }
  })();
  const state = createFlowState({
    flows: { [flow.id]: flow },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({ generators: { specialist: model }, policy: "allow" })
  });
  const turns = [
    { message: "It sees it. It fails after the password.", recent: "LINE-A customer: my MacBook won't join the wifi" },
    { message: "Where can I buy it?", recent: "LINE-B support.devices: try forgetting the network" }
  ];
  try {
    const runtime = await state.getRuntime();
    for (const input of turns) {
      const result = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow,
        actionName: "run",
        input,
        userId: USER,
        sessionId: "specialist-conversation",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig, logger: {} }
      });
      if (result.error) throw result.error;
    }
    const first = sent(model.calls[0]!.input);
    const second = sent(model.calls[1]!.input);
    const stored = await storedTexts(runtime, "specialist-conversation");
    const checks: Array<[string, boolean]> = [
      ["turn 1 sends LINE-A", first.some((m) => m.text.includes("LINE-A"))],
      ["turn 2 sends LINE-B", second.some((m) => m.text.includes("LINE-B"))],
      ["turn 2 sends turn 1's post as history", second.some((m) => m.role === "user" && m.text.includes("fails after the password"))],
      ["turn 2 does not send LINE-A", !second.some((m) => m.text.includes("LINE-A"))],
      ["the stored conversation holds neither line", !stored.conversation.some((s) => s.includes("LINE-A") || s.includes("LINE-B"))]
    ];
    const traced = [...new Set(stored.other.filter((s) => s.includes("LINE-")).map((s) => s.split(":")[0]))];
    console.log(`C2  context slot${control ? ` · POC_CONTROL=${control}` : ""}`);
    for (const [name, ok] of checks) console.log(`    ${ok ? "PASS" : "FAIL"}  ${name}`);
    console.log(`    note: non-conversation items that record the lines: ${traced.join(", ") || "none"}`);
    return checks.every(([, ok]) => ok);
  } finally {
    await state.dispose();
  }
}

await c1();
const held = await c2();
console.log(held ? "\nC2 HOLDS" : "\nC2 FAILS");
process.exit(held ? 0 : 1);
