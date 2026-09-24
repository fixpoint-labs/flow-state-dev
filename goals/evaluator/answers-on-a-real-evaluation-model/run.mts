/**
 * Goal check — an evaluator answers typed questions on a real evaluation
 * model, and refuses a model that can only generate (FIX-1554).
 *
 * Real model, real path, out of CI. See goal.md for the contract.
 *
 * Leg (a): a flow whose action is an `evaluator` with `model: "typesafe-ai/jev"`
 * runs through the engine (`runAction`) on the app's default model resolver,
 * which routes the string to Vercel's AI Gateway. The answers must be typed by
 * their questions, carry Jev's confidence on the choice and score, and none on
 * the boolean. The block_trace row must record the evaluator kind, the model
 * that answered and its usage.
 *
 * Leg (b): the same block with `openai("gpt-5.4-mini")`, a real text model, is
 * refused when it is built, and no request leaves the process.
 *
 * Run: pnpm tsx goals/evaluator/answers-on-a-real-evaluation-model/run.mts
 * Control: GOAL_CONTROL=synthetic-confidence (must FAIL on leg a3)
 */
import { openai } from "@ai-sdk/openai";
import {
  boolean,
  choice,
  defineFlow,
  evaluator,
  score,
  DEFAULT_ORG_ID,
  type EvaluationModel,
  type ModelResolver,
} from "@flow-state-dev/core";
import type { BlockTraceItem } from "@flow-state-dev/core/items";
import {
  createInMemoryStores,
  createModelResolver,
  createResponseEmitter,
  runAction,
} from "@flow-state-dev/engine";
import { z } from "zod";
import { fail, loadFixture, runGoal, stripIntentOverrides } from "../../lib/index.mts";

type Fixture = {
  ticket: string;
  team: { instructions: string; options: Record<string, string> };
  frustration: { instructions: string; levels: string[] };
  urgent: { instructions: string };
};

const fx = loadFixture<Fixture>(import.meta.url);
// The default resolver declares no intents; ambient intent pins would make it throw.
stripIntentOverrides();
const MODEL = "typesafe-ai/jev";
const CONTROL = process.env.GOAL_CONTROL;
if (CONTROL !== undefined && CONTROL !== "synthetic-confidence") {
  fail(`unknown GOAL_CONTROL "${CONTROL}" (known: synthetic-confidence)`);
}
if (!process.env.AI_GATEWAY_API_KEY) {
  fail("AI_GATEWAY_API_KEY is not set: this goal needs Vercel's AI Gateway to reach Jev");
}

const questions = {
  team: choice(fx.team.instructions, fx.team.options),
  frustration: score(fx.frustration.instructions, fx.frustration.levels),
  urgent: boolean(fx.urgent.instructions),
};

/**
 * The app's default resolver. Under the synthetic-confidence control, the
 * evaluation model it returns is wrapped so every answer gets a confidence
 * whether or not the model reported one: the seam behaviour this goal must
 * catch.
 */
function resolverFor(control: string | undefined): ModelResolver {
  const base = createModelResolver();
  if (control !== "synthetic-confidence") return base;
  const wrapped = ((id: string, block?: string) => base(id, block)) as ModelResolver;
  wrapped.resolveId = (id) => base.resolveId(id);
  wrapped.resolveEvaluationModel = async (id, block) => {
    const model = (await base.resolveEvaluationModel!(id, block)) as EvaluationModel & {
      doEvaluate(o: unknown): PromiseLike<{ answers: Record<string, unknown>; providerMetadata?: Record<string, Record<string, unknown>> }>;
    };
    return {
      ...model,
      specificationVersion: model.specificationVersion,
      provider: model.provider,
      modelId: model.modelId,
      supportedQuestionTypes: model.supportedQuestionTypes,
      async doEvaluate(options: unknown) {
        const result = await model.doEvaluate(options);
        const reported = (result.providerMetadata?.typesafe?.confidence ?? {}) as Record<string, number>;
        const confidence = Object.fromEntries(Object.keys(result.answers).map((qid) => [qid, reported[qid] ?? 0]));
        return { ...result, providerMetadata: { ...result.providerMetadata, typesafe: { confidence } } };
      },
    } as EvaluationModel;
  };
  return wrapped;
}

await runGoal(async () => {
  const failures: string[] = [];

  // ---- Leg (a): Jev through the gateway answers a held-out ticket ----------
  const triage = evaluator({
    name: "triage",
    model: MODEL,
    inputSchema: z.object({ ticket: z.string() }),
    state: (input) => input.ticket,
    questions,
  });
  const flow = defineFlow({
    kind: "evaluator-goal",
    actions: { run: { inputSchema: z.object({ ticket: z.string() }), block: triage } },
  })();
  const response = createResponseEmitter({ requestId: "req_evaluator_goal", now: () => Date.now() });
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input: { ticket: fx.ticket },
    requestId: "req_evaluator_goal",
    userId: "goal_user",
    sessionId: "goal_session",
    stores: createInMemoryStores(),
    responseEmitter: response,
    runtimeConfig: { modelResolver: resolverFor(CONTROL) },
  });

  if (result.error !== undefined) {
    return { failures: [`a0: the evaluator run failed: ${result.error.message}`], evidence: "" };
  }
  const answers = (result.output as { answers: Record<string, Record<string, unknown>> }).answers;

  // a1: the choice is one of the declared option keys (shape, never a specific option).
  const declared = Object.keys(fx.team.options);
  if (answers.team?.type !== "choice" || !declared.includes(String(answers.team.choice))) {
    failures.push(`a1: team is not a choice among ${declared.join("/")}: ${JSON.stringify(answers.team)}`);
  }
  // a2: choice and score carry the confidence Jev reported, as numbers in [0, 1].
  for (const id of ["team", "frustration"] as const) {
    const c = answers[id]?.confidence;
    if (typeof c !== "number" || c < 0 || c > 1) {
      failures.push(`a2: ${id} has no reported confidence: ${JSON.stringify(answers[id])}`);
    }
  }
  const s = answers.frustration?.score;
  if (typeof s !== "number" || s < 0 || s > fx.frustration.levels.length - 1) {
    failures.push(`a2: frustration score out of range: ${JSON.stringify(answers.frustration)}`);
  }
  // a3: the boolean has P(true) and no confidence key at all.
  const p = answers.urgent?.probability;
  if (typeof p !== "number" || p < 0 || p > 1) {
    failures.push(`a3: urgent has no probability: ${JSON.stringify(answers.urgent)}`);
  }
  if (answers.urgent !== undefined && "confidence" in answers.urgent) {
    failures.push(`a3: urgent carries a confidence Jev does not report for booleans: ${JSON.stringify(answers.urgent)}`);
  }
  // a4: the trace records the kind, the model that answered, and usage.
  const row = (response.getItems() as unknown as BlockTraceItem[]).find(
    (i) => i.type === "block_trace" && i.blockName === "triage",
  );
  if (row?.blockKind !== "evaluator" || row.evaluator?.model !== MODEL || row.model?.actual === undefined) {
    failures.push(`a4: trace row lacks kind/model: ${JSON.stringify({ kind: row?.blockKind, evaluator: row?.evaluator?.model, model: row?.model })}`);
  }

  // ---- Leg (b): a text model is refused before any call --------------------
  let requests = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    requests += 1;
    return realFetch(...args);
  }) as typeof fetch;
  let refusal = "";
  try {
    evaluator({ name: "triage", model: openai("gpt-5.4-mini") as never, questions });
  } catch (err) {
    refusal = err instanceof Error ? err.message : String(err);
  } finally {
    globalThis.fetch = realFetch;
  }
  if (!/can generate but not evaluate/.test(refusal) || !/evaluationModel\(/.test(refusal)) {
    failures.push(`b1: a text model was not refused with the fix named: ${JSON.stringify(refusal)}`);
  }
  if (requests !== 0) failures.push(`b2: ${requests} request(s) left the process for a refused model`);

  return {
    failures,
    evidence:
      `Jev via gateway answered team=${String(answers.team?.choice)} (confidence ${String(answers.team?.confidence)}), ` +
      `frustration=${String(answers.frustration?.score)} (confidence ${String(answers.frustration?.confidence)}), ` +
      `urgent P(true)=${String(answers.urgent?.probability)} with no confidence; answered by ${row?.model?.actual}, ` +
      `${row?.modelUsage?.totalTokens ?? "?"} tokens. openai("gpt-5.4-mini") refused at build with 0 requests.`,
  };
});
