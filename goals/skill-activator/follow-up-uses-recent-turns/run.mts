/**
 * Goal check — a follow-up that only makes sense with the last few turns
 * activates the skill the assistant just offered, when the activator's
 * evaluator is built with `skillEvaluator(model, { recentMessages: 3 })`
 * (FIX-1595).
 *
 * Real models, real path, out of CI. See goal.md for the contract.
 *
 * Each case is one session in the engine (`runAction`): an opening turn, then
 * a turn where the user says something and the assistant offers a skill's
 * work, both written by running a `chat` action in that session; then the
 * follow-up runs through the real activator in the same session. The earlier
 * turns reach the evaluator only through the session, never through the
 * action input, and no follow-up names a skill, trips a keyword or starts
 * with a slash (the run refuses a fixture that does).
 *
 * Both legs: Jev (`typesafe-ai/jev`) through the app's default resolver, and
 * an OpenAI evaluation model (`openai/gpt-5.4-mini`) on the gateway's
 * OpenAI-compatible endpoint, used as an instance.
 *
 * Run: pnpm tsx goals/skill-activator/follow-up-uses-recent-turns/run.mts
 * Control: GOAL_CONTROL=no-recent (must FAIL on every targeted follow-up)
 */
import { createOpenAI } from "@ai-sdk/openai";
import {
  defineFlow,
  handler,
  sequencer,
  DEFAULT_ORG_ID,
  type EvaluationModel,
  type InitialSkill,
} from "@flow-state-dev/core";
import type { BlockTraceItem } from "@flow-state-dev/core/items";
import {
  createInMemoryStores,
  createModelResolver,
  createResponseEmitter,
  runAction,
} from "@flow-state-dev/engine";
import {
  createSkillActivator,
  defineSkillsCollection,
  skillEvaluator,
} from "@flow-state-dev/orchestration";
import { z } from "zod";
import { fail, loadFixture, runGoal, stripIntentOverrides } from "../../lib/index.mts";

type Exchange = { ask: string; offer: string; followUp: string };
type Fixture = {
  skills: Array<{ name: string; description: string; whenToUse: string; keywords: string[] }>;
  opener: { ask: string; reply: string };
  targeted: Array<Exchange & { expect: string }>;
  smallTalk: Exchange;
};

const fx = loadFixture<Fixture>(import.meta.url);
// The default resolver declares no intents; ambient intent pins would make it throw.
stripIntentOverrides();
const JEV = "typesafe-ai/jev";
const ADAPTER_ID = "openai/gpt-5.4-mini";
const RECENT = 3;
const CONTROL = process.env.GOAL_CONTROL;
if (CONTROL !== undefined && CONTROL !== "no-recent") {
  fail(`unknown GOAL_CONTROL "${CONTROL}" (known: no-recent)`);
}
if (!process.env.AI_GATEWAY_API_KEY) {
  fail("AI_GATEWAY_API_KEY is not set: this goal needs Vercel's AI Gateway to reach both models");
}

const initialSkills: InitialSkill[] = fx.skills.map((s) => ({
  name: s.name,
  skillMd: [
    "---",
    `description: ${JSON.stringify(s.description)}`,
    `when_to_use: ${JSON.stringify(s.whenToUse)}`,
    `keywords: [${s.keywords.join(", ")}]`,
    "---",
    "",
    `Instructions for ${s.name}.`,
  ].join("\n"),
}));
const catalogNames = new Set(fx.skills.map((s) => s.name));

// Held-out guard: a follow-up that names a skill, trips a keyword or is a
// slash command would resolve without the earlier turns.
for (const { followUp } of [...fx.targeted, fx.smallTalk]) {
  const lower = followUp.toLowerCase();
  const named = fx.skills.some(
    (s) => lower.includes(s.name) || s.name.split("-").some((w) => lower.includes(w)) || s.keywords.some((k) => lower.includes(k)),
  );
  if (lower.startsWith("/") || named) fail(`fixture follow-up would not need the earlier turns: ${JSON.stringify(followUp)}`);
}

const openai = createOpenAI({
  baseURL: "https://ai-gateway.vercel.sh/v1",
  apiKey: process.env.AI_GATEWAY_API_KEY,
});
const ADAPTER = openai.evaluationModel(ADAPTER_ID) as unknown as EvaluationModel;

/** The block the app would write; under the control, without the option. */
const evaluatorFor = (model: string | EvaluationModel) =>
  CONTROL === "no-recent" ? skillEvaluator(model) : skillEvaluator(model, { recentMessages: RECENT });

let seq = 0;

/** One session: two earlier turns written through the engine, then the follow-up through the activator. */
async function session(model: string | EvaluationModel, exchange: Exchange) {
  const n = ++seq;
  const sessionId = `goal_recent_session_${n}`;
  const stores = createInMemoryStores();
  const chatInput = z.object({ message: z.string(), reply: z.string() });
  const runInput = z.object({ message: z.string() });
  const flow = defineFlow({
    kind: `skill-activator-recent-goal-${n}`,
    resources: { skills: defineSkillsCollection({ scope: "session" }) },
    actions: {
      // An earlier turn: the user's message, then the assistant's reply.
      chat: {
        inputSchema: chatInput,
        userMessage: (i) => i.message,
        block: handler({
          name: "assistant-reply",
          inputSchema: chatInput,
          execute: (input, ctx) => {
            ctx.emit.message(input.reply);
            return { ok: true };
          },
        }),
      },
      run: {
        inputSchema: runInput,
        userMessage: (i) => i.message,
        block: sequencer({ name: "turn", inputSchema: runInput }).step(
          createSkillActivator({ initialSkills, evaluator: evaluatorFor(model) }),
        ),
      },
    },
  })();

  const exec = async (actionName: "chat" | "run", input: Record<string, unknown>) => {
    const requestId = `req_recent_goal_${n}_${actionName}_${Math.random().toString(16).slice(2, 8)}`;
    const response = createResponseEmitter({ requestId, now: () => Date.now() });
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName,
      input,
      requestId,
      userId: "goal_user",
      sessionId,
      stores,
      responseEmitter: response,
      runtimeConfig: { modelResolver: createModelResolver() },
    });
    return { result, items: response.getItems() as unknown as Array<Record<string, unknown>> };
  };

  for (const [message, reply] of [
    [fx.opener.ask, fx.opener.reply],
    [exchange.ask, exchange.offer],
  ]) {
    const earlier = await exec("chat", { message, reply });
    if (earlier.result.error) return { error: `earlier turn failed: ${earlier.result.error.message}` };
  }

  // Only the message: earlier turns never travel in the action input.
  const { result, items } = await exec("run", { message: exchange.followUp });
  const row = (items as unknown as BlockTraceItem[]).find(
    (i) => i.type === "block_trace" && i.blockKind === "evaluator",
  );
  const matches = items
    .filter(
      (i) =>
        i.type === "state_change" &&
        i.scope === "block_instance" &&
        (i.provenance as { blockName?: string }).blockName === "skill-activator",
    )
    .flatMap((i) => ((i.delta as { skills?: Array<Record<string, unknown>> }).skills ?? []));
  const answered = (row?.output as { value?: { answers?: { skill?: { choice?: string } } } } | undefined)
    ?.value?.answers?.skill?.choice;
  return { error: result.error?.message, ranTier3: row !== undefined, names: matches.map((m) => String(m.name)), answered };
}

const label = (model: string | EvaluationModel) =>
  typeof model === "string" ? model : `${model.provider}/${model.modelId}`;

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];

  for (const [leg, model] of [
    ["a", JEV],
    ["b", ADAPTER],
  ] as const) {
    for (const exchange of fx.targeted) {
      const t = await session(model, exchange);
      const tag = `${leg}: ${label(model)} on "${exchange.followUp}" after the ${exchange.expect} offer`;
      if (t.error !== undefined) {
        failures.push(`${tag}: the activator failed: ${t.error}`);
        continue;
      }
      if (!t.ranTier3) failures.push(`${tag}: no evaluator row, so tier 3 never ran`);
      // Anti-game: one catalog skill, and the one the earlier offer was about.
      if (t.names!.length !== 1 || !catalogNames.has(t.names![0]!) || t.names![0] !== exchange.expect) {
        failures.push(`${tag}: activated ${JSON.stringify(t.names)} (evaluator answered ${String(t.answered)}), expected ["${exchange.expect}"]`);
        continue;
      }
      evidence.push(`${leg} "${exchange.followUp}" -> ${t.names![0]}`);
    }

    const chat = await session(model, fx.smallTalk);
    const tag = `${leg}: ${label(model)} on small talk after the offer`;
    if (chat.error !== undefined) failures.push(`${tag}: the activator failed: ${chat.error}`);
    else if (!chat.ranTier3) failures.push(`${tag}: no evaluator row, so tier 3 never ran`);
    else if (chat.names!.length !== 0) failures.push(`${tag}: activated ${JSON.stringify(chat.names)}, expected nothing`);
    else evidence.push(`${leg} small talk -> ${String(chat.answered)}, nothing activated`);
  }

  return { failures, evidence: evidence.join("; ") };
});
