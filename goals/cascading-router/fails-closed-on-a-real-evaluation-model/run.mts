/**
 * Goal check — a two-level `cascadingRouter` routes on confidence a real
 * evaluation model measured, and fails closed on one that reports none
 * (FIX-1558).
 *
 * Real models, real path, out of CI. See goal.md for the contract.
 *
 * Leg (j): the tree runs through the engine (`runAction`) on the app's
 * default model resolver with `model: "typesafe-ai/jev"` via Vercel's AI
 * Gateway. A clear billing-urgent ticket must reach the gated leaf with the
 * ticket as its input, and each walked level must carry Jev's confidence.
 *
 * Leg (o): the same tree on `openai.evaluationModel("gpt-5.4-mini")`. Every
 * ticket must land on `ambiguous` with reason `no-confidence`, at level 1.
 *
 * Run: pnpm tsx goals/cascading-router/fails-closed-on-a-real-evaluation-model/run.mts
 * Control: GOAL_CONTROL=open-on-missing (must FAIL leg o)
 */
import { createOpenAI, openai } from "@ai-sdk/openai";
import {
  choice,
  createModelResolver,
  defineFlow,
  evaluator,
  handler,
  utility,
  DEFAULT_ORG_ID,
  type EvaluationModel,
} from "@flow-state-dev/core";
import type { BlockTraceItem, OutputItem } from "@flow-state-dev/core/items";
import { buildItemLookup } from "@flow-state-dev/core/items";
import { resolveBlockValueInternal } from "@flow-state-dev/core/items/internal";
import { createInMemoryStores, createResponseEmitter, runAction } from "@flow-state-dev/engine";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { fail, loadFixture, runGoal, stripIntentOverrides } from "../../lib/index.mts";

type Ticket = { id: string; message: string };
type Fixture = {
  clearTicket: Ticket;
  tickets: Ticket[];
  team: { instructions: string; options: Record<string, string> };
  urgency: { instructions: string; options: Record<string, string> };
};
type Verdict = { level: string; on: string; edge?: string; confidence?: number; ambiguous?: string; choice?: string };

const fx = loadFixture<Fixture>(import.meta.url);
// The default resolver declares no intents; ambient intent pins would make it throw.
stripIntentOverrides();
const JEV = "typesafe-ai/jev";
const OPENAI_MODEL = "gpt-5.4-mini";
const CONTROL = process.env.GOAL_CONTROL;
if (CONTROL !== undefined && CONTROL !== "open-on-missing") {
  fail(`unknown GOAL_CONTROL "${CONTROL}" (known: open-on-missing)`);
}
if (!process.env.AI_GATEWAY_API_KEY) {
  fail("AI_GATEWAY_API_KEY is not set: this goal needs Vercel's AI Gateway to reach Jev");
}

/**
 * OpenAI's evaluation adapter. Direct with `OPENAI_API_KEY`; otherwise the same
 * adapter pointed at the gateway's OpenAI-compatible endpoint, so the answer
 * still comes back through `@ai-sdk/openai`'s evaluation wrapper.
 */
function openaiEvaluationModel(): { model: EvaluationModel; via: string } {
  if (process.env.OPENAI_API_KEY) {
    return { model: openai.evaluationModel(OPENAI_MODEL) as unknown as EvaluationModel, via: "OpenAI direct" };
  }
  const viaGateway = createOpenAI({
    baseURL: "https://ai-gateway.vercel.sh/v1",
    apiKey: process.env.AI_GATEWAY_API_KEY,
  });
  return {
    model: viaGateway.evaluationModel(`openai/${OPENAI_MODEL}`) as unknown as EvaluationModel,
    via: "@ai-sdk/openai through the gateway's OpenAI-compatible endpoint",
  };
}

/**
 * The control: stands in for a gate that opens on a missing confidence, by
 * filling every missing confidence with 1 before the gate sees the answer. The
 * cascade exposes no gate to swap, so this is the one seam a run can reach
 * that produces the same routing.
 */
function openOnMissing(model: EvaluationModel): EvaluationModel {
  const inner = model as EvaluationModel & {
    doEvaluate(o: unknown): PromiseLike<{ answers: Record<string, unknown>; providerMetadata?: Record<string, Record<string, unknown>> }>;
  };
  return {
    specificationVersion: inner.specificationVersion,
    provider: inner.provider,
    modelId: inner.modelId,
    supportedQuestionTypes: inner.supportedQuestionTypes,
    async doEvaluate(options: unknown) {
      const result = await inner.doEvaluate(options);
      const reported = (result.providerMetadata?.typesafe?.confidence ?? {}) as Record<string, number>;
      const confidence = Object.fromEntries(Object.keys(result.answers).map((id) => [id, reported[id] ?? 1]));
      return { ...result, providerMetadata: { ...result.providerMetadata, typesafe: { confidence } } };
    },
  } as unknown as EvaluationModel;
}

/** The SPEC's two-level tree on one model, with leaves that record what they received. */
function buildTree(model: string | EvaluationModel) {
  const received: Record<string, unknown[]> = {};
  const leaf = (name: string) =>
    handler({
      name,
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: (input) => {
        (received[name] ??= []).push(input);
        return { handledBy: name };
      },
    });
  const department = evaluator({
    name: "department",
    model,
    state: (input: Ticket) => input.message,
    questions: { team: choice(fx.team.instructions, fx.team.options) },
  });
  const urgency = evaluator({
    name: "billing-urgency",
    model,
    state: (input: Ticket) => input.message,
    questions: { urgency: choice(fx.urgency.instructions, fx.urgency.options) },
  });
  const triage = utility.cascadingRouter({
    name: "triage",
    ambiguous: leaf("review"),
    root: {
      ask: department,
      on: "team",
      branches: {
        billing: {
          minConfidence: 0.6,
          next: {
            ask: urgency,
            on: "urgency",
            branches: {
              high: { minConfidence: 0.7, block: leaf("escalate") },
              low: { block: leaf("billing-queue") },
            },
          },
        },
        technical: { minConfidence: 0.6, block: leaf("tech-queue") },
      },
    },
  });
  return { triage, received };
}

async function run(model: string | EvaluationModel, ticket: Ticket, requestId: string) {
  const { triage, received } = buildTree(model);
  const flow = defineFlow({
    kind: "cascading-router-goal",
    actions: { run: { inputSchema: z.any(), block: triage } },
  })();
  const response = createResponseEmitter({ requestId, now: () => Date.now() });
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input: ticket,
    requestId,
    userId: "goal_user",
    sessionId: "goal_session",
    stores: createInMemoryStores(),
    responseEmitter: response,
    runtimeConfig: { modelResolver: createModelResolver() },
  });
  const items = response.getItems() as OutputItem[];
  const lookup = buildItemLookup(items);
  const rows = (items as unknown as BlockTraceItem[]).filter((i) => i.type === "block_trace");
  const outputOf = (row: BlockTraceItem) => (row.output === undefined ? undefined : resolveBlockValueInternal(row.output, lookup));
  const verdicts = rows
    .filter((r) => r.blockName.endsWith("/gate"))
    .map((r) => (outputOf(r) as { verdict: Verdict }).verdict);
  const answers = rows
    .filter((r) => r.blockKind === "evaluator")
    .map((r) => ({ block: r.blockName, answers: (outputOf(r) as { answers?: Record<string, { confidence?: unknown }> })?.answers }));
  return { result, received, verdicts, answers };
}

const inRange = (c: unknown) => typeof c === "number" && c >= 0 && c <= 1;

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];

  // ---- Leg (j): Jev reports confidence, and a clear ticket reaches the gated leaf ----
  {
    const ticket = fx.clearTicket;
    const { result, received, verdicts, answers } = await run(JEV, ticket, "req_cascade_jev");
    if (result.error !== undefined) {
      failures.push(`j0: the Jev run failed: ${result.error.message}`);
    } else {
      if ((result.output as { handledBy?: string })?.handledBy !== "escalate") {
        failures.push(`j1: a clear billing-urgent ticket did not reach the gated leaf: ${JSON.stringify({ output: result.output, verdicts })}`);
      }
      if (!isDeepStrictEqual(received.escalate, [ticket])) {
        failures.push(`j1: the leaf did not receive the ticket: ${JSON.stringify(received.escalate)}`);
      }
      const levels = verdicts.map((v) => v.level);
      if (!isDeepStrictEqual(levels, ["root", "root/billing"]) || verdicts.some((v) => v.edge === undefined)) {
        failures.push(`j2: expected an opened edge at both levels: ${JSON.stringify(verdicts)}`);
      }
      const walked = answers.map((a) => a.block);
      const missing = answers.filter((a) => !inRange(Object.values(a.answers ?? {})[0]?.confidence));
      if (!isDeepStrictEqual(walked, ["department", "billing-urgency"]) || missing.length > 0) {
        failures.push(`j3: each walked level's answer must carry Jev's confidence: ${JSON.stringify(answers)}`);
      }
      evidence.push(
        `Jev: ${ticket.id} → ${verdicts.map((v) => `${v.level}:${v.edge ?? v.ambiguous}(${String(v.confidence ?? "-")})`).join(" → ")} → escalate got the ticket`
      );
    }
  }

  // ---- Leg (o): OpenAI reports no confidence, so every ticket goes to ambiguous at level 1 ----
  {
    const { model, via } = openaiEvaluationModel();
    const gated = CONTROL === "open-on-missing" ? openOnMissing(model) : model;
    const routed: string[] = [];
    for (const ticket of fx.tickets) {
      const { result, received, verdicts, answers } = await run(gated, ticket, `req_cascade_openai_${ticket.id}`);
      if (result.error !== undefined) {
        failures.push(`o0: the OpenAI run for ${ticket.id} failed: ${result.error.message}`);
        continue;
      }
      if ((result.output as { handledBy?: string })?.handledBy !== "review" || !isDeepStrictEqual(received.review, [ticket])) {
        failures.push(`o1: ${ticket.id} did not land on ambiguous with its ticket: ${JSON.stringify({ output: result.output, verdicts })}`);
      }
      if (verdicts.length !== 1 || verdicts[0]!.level !== "root" || verdicts[0]!.ambiguous !== "no-confidence") {
        failures.push(`o2: ${ticket.id} expected one verdict, ambiguous/no-confidence at root: ${JSON.stringify(verdicts)}`);
      }
      if (answers.some((a) => a.block === "billing-urgency")) {
        failures.push(`o3: ${ticket.id} asked level 2 after level 1 failed closed`);
      }
      routed.push(`${ticket.id} chose ${verdicts.map((v) => `${v.choice ?? v.edge}, ${v.ambiguous ?? "edge opened"}`).join(" → ")}`);
    }
    evidence.push(`OpenAI ${OPENAI_MODEL} (${via}): ${routed.join("; ")}; all → review`);
  }

  return { failures, evidence: evidence.join("; ") };
});
