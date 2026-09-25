/**
 * Goal check — the skill activator's third tier picks a skill on a real
 * evaluation model, and its pick is final (FIX-1559).
 *
 * Real models, real path, out of CI. See goal.md for the contract.
 *
 * Each turn runs a flow whose action is `createSkillActivator({ initialSkills,
 * evaluator: skillEvaluator(model) })` through the engine (`runAction`) on the
 * app's default model resolver. The messages match no slash command and no
 * keyword, so every activation comes from the evaluator.
 *
 * Leg (a) Jev, which reports confidence: a targeted message activates its skill
 *   with a numeric confidence; small talk activates nothing.
 * Leg (b) an OpenAI evaluation model (`openai.evaluationModel("openai/gpt-5.4-mini")`,
 *   pointed at the gateway's OpenAI-compatible endpoint), which reports no
 *   confidence: the same messages activate the same way, with no confidence on
 *   the match. The gateway's own evaluation ids cover Jev only, so the adapter
 *   leg is an instance, which the activator uses as given.
 *
 * Run: pnpm tsx goals/skill-activator/evaluator-picks-a-skill/run.mts
 * Control: GOAL_CONTROL=fail-closed (must FAIL on leg b)
 */
import { createOpenAI } from "@ai-sdk/openai";
import {
  defineFlow,
  sequencer,
  DEFAULT_ORG_ID,
  type EvaluationModel,
  type InitialSkill,
  type ModelResolver,
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

type Fixture = {
  skills: Array<{ name: string; description: string; whenToUse: string; keywords: string[] }>;
  targeted: Array<{ message: string; expect: string }>;
  smallTalk: string;
};

const fx = loadFixture<Fixture>(import.meta.url);
// The default resolver declares no intents; ambient intent pins would make it throw.
stripIntentOverrides();
const JEV = "typesafe-ai/jev";
const ADAPTER_ID = "openai/gpt-5.4-mini";
const CONTROL = process.env.GOAL_CONTROL;
if (CONTROL !== undefined && CONTROL !== "fail-closed") {
  fail(`unknown GOAL_CONTROL "${CONTROL}" (known: fail-closed)`);
}
if (!process.env.AI_GATEWAY_API_KEY) {
  fail("AI_GATEWAY_API_KEY is not set: this goal needs Vercel's AI Gateway to reach Jev");
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

// Held-out guard: a message that trips a keyword or a slash never reaches tier 3.
for (const message of [...fx.targeted.map((t) => t.message), fx.smallTalk]) {
  const lower = message.toLowerCase();
  if (lower.startsWith("/") || fx.skills.some((s) => s.keywords.some((k) => lower.includes(k)))) {
    fail(`fixture message would resolve before tier 3: ${JSON.stringify(message)}`);
  }
}

/**
 * Under the fail-closed control, an evaluation model whose picks that carry no
 * confidence become "no skill": the reading of "absent confidence fails
 * closed" this goal exists to reject. Otherwise the model, untouched.
 */
function control(model: EvaluationModel): EvaluationModel {
  if (CONTROL !== "fail-closed") return model;
  const inner = model as EvaluationModel & {
    doEvaluate(o: unknown): PromiseLike<{
      answers: Record<string, { type: string; choice?: string }>;
      providerMetadata?: Record<string, Record<string, unknown>>;
    }>;
  };
  return {
    specificationVersion: inner.specificationVersion,
    provider: inner.provider,
    modelId: inner.modelId,
    supportedQuestionTypes: inner.supportedQuestionTypes,
    async doEvaluate(options: unknown) {
      const result = await inner.doEvaluate(options);
      const reported = (result.providerMetadata?.typesafe?.confidence ?? {}) as Record<string, number>;
      if (result.answers.skill?.type === "choice" && reported.skill === undefined) {
        return { ...result, answers: { ...result.answers, skill: { type: "choice", choice: "NO_SKILL" } } };
      }
      return result;
    },
  } as EvaluationModel;
}

/** The app's default resolver, with the control applied to what it resolves. */
const base = createModelResolver();
const resolver = ((id: string, block?: string) => base(id, block)) as ModelResolver;
resolver.resolveId = (id) => base.resolveId(id);
resolver.resolveEvaluationModel = async (id, block) => control(await base.resolveEvaluationModel!(id, block));

const openai = createOpenAI({
  baseURL: "https://ai-gateway.vercel.sh/v1",
  apiKey: process.env.AI_GATEWAY_API_KEY,
});
const ADAPTER = control(openai.evaluationModel(ADAPTER_ID) as unknown as EvaluationModel);
let seq = 0;

/** One turn through the real activator; returns what it activated and whether tier 3 ran. */
async function turn(model: string | EvaluationModel, message: string) {
  const requestId = `req_skill_goal_${++seq}`;
  const flow = defineFlow({
    kind: `skill-activator-goal-${seq}`,
    resources: { skills: defineSkillsCollection({ scope: "session" }) },
    actions: {
      run: {
        inputSchema: z.object({ message: z.string() }),
        block: sequencer({
          name: "turn",
          inputSchema: z.object({ message: z.string() }),
        }).step(createSkillActivator({ initialSkills, evaluator: skillEvaluator(model) })),
      },
    },
  })();
  const response = createResponseEmitter({ requestId, now: () => Date.now() });
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input: { message },
    requestId,
    userId: "goal_user",
    sessionId: `goal_session_${seq}`,
    stores: createInMemoryStores(),
    responseEmitter: response,
    runtimeConfig: { modelResolver: resolver },
  });
  const items = response.getItems() as unknown as Array<Record<string, unknown>>;
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
  return { error: result.error?.message, ranTier3: row !== undefined, matches, answered, row };
}

const label = (model: string | EvaluationModel) =>
  typeof model === "string" ? model : `${model.provider}/${model.modelId}`;

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];

  for (const [leg, model, reportsConfidence] of [
    ["a", JEV, true],
    ["b", ADAPTER, false],
  ] as const) {
    for (const { message, expect } of fx.targeted) {
      const t = await turn(model, message);
      const tag = `${leg}: ${label(model)} on "${message.slice(0, 32)}…"`;
      if (t.error !== undefined) {
        failures.push(`${tag}: the activator failed: ${t.error}`);
        continue;
      }
      if (!t.ranTier3) failures.push(`${tag}: no evaluator row, so tier 3 never ran`);
      const names = t.matches.map((m) => String(m.name));
      // Anti-game: one catalog skill, and the one the message is about.
      if (names.length !== 1 || !catalogNames.has(names[0]!) || names[0] !== expect) {
        failures.push(`${tag}: activated ${JSON.stringify(names)} (evaluator answered ${String(t.answered)}), expected ["${expect}"]`);
        continue;
      }
      const match = t.matches[0]!;
      if (reportsConfidence) {
        const c = match.confidence;
        if (typeof c !== "number" || c < 0 || c > 1) failures.push(`${tag}: no reported confidence on the match: ${JSON.stringify(match)}`);
      } else if ("confidence" in match) {
        failures.push(`${tag}: the match carries a confidence the model never reported: ${JSON.stringify(match)}`);
      }
      evidence.push(`${leg} ${names[0]}${"confidence" in match ? ` (${String(match.confidence)})` : " (no confidence)"}`);
    }

    const chat = await turn(model, fx.smallTalk);
    const tag = `${leg}: ${label(model)} on small talk`;
    if (chat.error !== undefined) failures.push(`${tag}: the activator failed: ${chat.error}`);
    else if (!chat.ranTier3) failures.push(`${tag}: no evaluator row, so tier 3 never ran`);
    else if (chat.matches.length !== 0) failures.push(`${tag}: activated ${JSON.stringify(chat.matches.map((m) => m.name))}, expected nothing`);
    else evidence.push(`${leg} small talk -> ${String(chat.answered)}, nothing activated`);
  }

  return { failures, evidence: evidence.join("; ") };
});
