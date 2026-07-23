/**
 * Goal check — a `context-supply: conversation` delegated agent inherits the
 * parent conversation; an isolated one does not; and either way the worker's
 * own output stays out of host history (FIX-920).
 *
 * Real model, real path, out of CI. See goal.md for the contract.
 *
 * What makes this a goal check, not a dressed-up unit test:
 *   - It drives the REAL `materializeWorker` (the FIX-920 code under test),
 *     which wires the generator's `history` slot to `{ limit: { turns: N } }`
 *     for a `conversation` agent and leaves it absent otherwise, then runs the
 *     produced worker generators through the REAL engine (`runAction`) inside a
 *     REAL session whose prior turn seeded the fact.
 *   - The anti-game runs BOTH modes over the SAME seeded session and the SAME
 *     task input — the ONLY difference is `contextSupply`. The conversation
 *     worker must recover a fact that appears nowhere in its task input (only in
 *     the prior conversation); the isolated worker must NOT. That the isolated
 *     worker, given identical everything, cannot produce the fact is what proves
 *     the history slot delivered it — not leakage, not a hardcoded answer.
 *   - The graded fact is pulled from the fixture, never a literal in this file.
 *
 * Run: pnpm tsx goals/context-supply/inherits-parent-conversation/run.mts
 */
import { readFileSync } from "node:fs";
import { defineFlow, generator } from "@flow-state-dev/core";
import {
  runAction,
  createInMemoryStores,
  createModelResolver,
} from "@flow-state-dev/engine";
import { materializeWorker } from "@flow-state-dev/orchestration";
import { z } from "zod";

const MODEL = "openai/gpt-5.4-mini";

const fx = JSON.parse(
  readFileSync(new URL("./fixtures/input.json", import.meta.url), "utf8"),
) as { fact: string; statement: string; question: string };

// The env may carry an intent ladder override (FSDEV_DEFAULT_MODEL /
// FSDEV_INTENT_*) that a bare createModelResolver (no declared intents) rejects.
// Clear it so the resolver auto-wires the AI Gateway from AI_GATEWAY_API_KEY.
for (const k of Object.keys(process.env)) {
  if (k === "FSDEV_DEFAULT_MODEL" || k.startsWith("FSDEV_INTENT_")) {
    delete process.env[k];
  }
}

// Turn 1 — a real conversation turn that states the held-out fact. `userMessage`
// emits the user turn; the generator acknowledges. Both are history-visible, so
// they become the prior conversation a later worker's history slot can read.
const seed = generator({
  name: "seed",
  model: MODEL,
  prompt: "You are a helpful assistant. Reply with a one-line acknowledgement.",
  inputSchema: z.object({ statement: z.string() }),
  history: true,
  user: (i: { statement: string }) => i.statement,
  itemVisibility: { client: true, history: true },
});

// The two workers differ by ONE field: `contextSupply`. Same body, same model,
// same task input downstream. materializeWorker is the code under test.
const AGENT_BODY =
  "You answer the user's question using the earlier conversation in this session. " +
  "Answer with only the value asked for, nothing else.";
const workerDeps = { catalog: {}, skillName: "ctx-supply-goal", defaultModelId: MODEL };

const conversationWorker = await materializeWorker(
  "answerer",
  { prompt: AGENT_BODY, contextSupply: "conversation" },
  workerDeps,
);
const isolatedWorker = await materializeWorker(
  "answerer",
  { prompt: AGENT_BODY }, // contextSupply absent = isolated (the default)
  workerDeps,
);

const flow = defineFlow({
  kind: "ctx-supply-goal",
  requireUser: true,
  actions: {
    seed: {
      block: seed,
      userMessage: (i: { statement: string }) => i.statement,
    },
    conversationWorker: { block: conversationWorker as never },
    isolatedWorker: { block: isolatedWorker as never },
  },
})({ id: "default" });

const stores = createInMemoryStores();
const runtimeConfig = { modelResolver: createModelResolver() } as never;

async function run(actionName: string, input: unknown, sessionId: string) {
  return runAction({
    flow,
    actionName: actionName as never,
    input,
    userId: "goal-user",
    sessionId,
    stores,
    runtimeConfig,
  });
}

/** The delegated task — carries the QUESTION, never the fact. */
const task = { taskId: "t1", goal: fx.question, attempts: 0 };

async function runGoalCheck(): Promise<string[]> {
  const failures: string[] = [];

  // Honesty guard: the task the worker receives must NOT contain the fact, or
  // "recovered it" would prove nothing. The worker's turn is built from the
  // goal (+ optional input); assert the fact is absent from both.
  const taskText = JSON.stringify(task).toLowerCase();
  if (taskText.includes(fx.fact.toLowerCase())) {
    return [`setup invalid: the fact leaked into the worker's task input`];
  }

  const SESSION = "ctx-supply-session";

  // Turn 1: seed the fact into the conversation.
  const seeded = await run("seed", { statement: fx.statement }, SESSION);
  if (seeded.error) return [`seed turn failed: ${seeded.error.message}`];

  // Turn 2: the conversation worker — same session, task input without the fact.
  const conv = await run("conversationWorker", task, SESSION);
  if (conv.error) return [`conversation worker failed: ${conv.error.message}`];

  // Turn 3: the isolated worker — SAME seeded session, SAME task input. Only
  // `contextSupply` differs. Its output's own history-invisibility means turn 2
  // contributed nothing to history either, so the only place the fact lives is
  // the turn-1 conversation the isolated worker has no slot to read.
  const iso = await run("isolatedWorker", task, SESSION);
  if (iso.error) return [`isolated worker failed: ${iso.error.message}`];

  const convAnswer = String(conv.output ?? "");
  const isoAnswer = String(iso.output ?? "");
  const has = (s: string) => s.toLowerCase().includes(fx.fact.toLowerCase());

  // 1. Conversation mode recovered the fact from inherited history.
  if (!has(convAnswer)) {
    failures.push(
      `conversation worker did NOT recover "${fx.fact}" — history slot did not deliver ` +
        `the prior conversation. Answer: ${JSON.stringify(convAnswer.slice(0, 200))}`,
    );
  }

  // 2. Isolated mode did NOT — same session, same task, no history slot.
  if (has(isoAnswer)) {
    failures.push(
      `isolated worker recovered "${fx.fact}" despite having no history slot — the conversation ` +
        `worker's pass could be leakage/hardcoding, not the inherited history. ` +
        `Answer: ${JSON.stringify(isoAnswer.slice(0, 200))}`,
    );
  }

  // 3. Output isolation: the conversation worker's OWN emitted message carries
  //    itemVisibility.history === false — its sub-work does not re-enter host
  //    history even though it reads history.
  const workerMessage = conv.items.find(
    (i: { type: string; role?: string }) => i.type === "message" && i.role === "assistant",
  ) as { itemVisibility?: { history?: boolean } } | undefined;
  if (!workerMessage) {
    failures.push(`could not find the conversation worker's emitted message item to check visibility`);
  } else if (workerMessage.itemVisibility?.history !== false) {
    failures.push(
      `output isolation broken: worker message itemVisibility.history is ` +
        `${JSON.stringify(workerMessage.itemVisibility?.history)}, expected false`,
    );
  }

  if (failures.length === 0) {
    console.log(
      `conversation answer: ${JSON.stringify(convAnswer)}  (recovered "${fx.fact}")\n` +
        `isolated answer:     ${JSON.stringify(isoAnswer)}  (did NOT recover it)\n` +
        `worker output itemVisibility.history: ${workerMessage!.itemVisibility?.history}`,
    );
  }
  return failures;
}

const failures = await runGoalCheck();
if (failures.length === 0) {
  console.log(
    `\nPASS — a context-supply "conversation" agent recovered the held-out fact from the parent ` +
      `conversation; an isolated agent, given the identical session and task, did not; and the ` +
      `worker's own output stayed history-invisible.`,
  );
  process.exit(0);
} else {
  console.error("\nFAIL —");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
