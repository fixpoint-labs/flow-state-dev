/**
 * Goal check — with an evaluator installed, memory observes a turn if and only
 * if a real evaluation model says it is worth remembering (FIX-1555).
 *
 * Real model, real path, out of CI. See goal.md for the contract.
 *
 * A conversation of held-out turns, some stating facts and some small talk,
 * runs through the engine one request per turn, with capture as a side chain
 * and `captureEvaluator(model)` in `system({ evaluator })`. Per turn the check
 * reads the evaluator's answer from the trace, whether the observer ran, and
 * what was added to working and episodic memory.
 *
 * Evaluation model: `typesafe-ai/jev` through Vercel's AI Gateway by default.
 * `GOAL_EVALUATION_MODEL=openai` uses `openai.evaluationModel("gpt-5.4-mini")`
 * instead: through the gateway's OpenAI-compatible endpoint when
 * `AI_GATEWAY_API_KEY` is set, else OpenAI directly. With no gateway key at
 * all, the OpenAI leg is the one that runs.
 *
 * Run: pnpm tsx goals/memory-evaluator-seam/evaluator-decides-observation/run.mts
 * Control: GOAL_CONTROL=ignore-evaluator (must FAIL on d1)
 */
import { createOpenAI } from "@ai-sdk/openai";
import type { EvaluationModel } from "@flow-state-dev/core";
import { DEFAULT_MODEL, fail, loadFixture, runGoal, stripIntentOverrides } from "../../lib/index.mts";
import { captureEvaluator } from "../../../packages/memory/src/index.ts";
import { conversation, type Turn } from "../harness.mts";

const fx = loadFixture<{ turns: string[] }>(import.meta.url);
// The default resolver declares no intents; ambient intent pins would make it throw.
stripIntentOverrides();
const CONTROL = process.env.GOAL_CONTROL;
if (CONTROL !== undefined && CONTROL !== "ignore-evaluator") {
  fail(`unknown GOAL_CONTROL "${CONTROL}" (known: ignore-evaluator)`);
}
const gatewayKey = process.env.AI_GATEWAY_API_KEY;
if (!gatewayKey && !process.env.OPENAI_API_KEY) {
  fail("neither AI_GATEWAY_API_KEY nor OPENAI_API_KEY is set: this goal needs a real evaluation model");
}

/** The evaluation model this run uses, and how it was reached. */
function evaluationModel(): { model: string | EvaluationModel; label: string } {
  const wantOpenAI = process.env.GOAL_EVALUATION_MODEL === "openai" || !gatewayKey;
  if (!wantOpenAI) return { model: "typesafe-ai/jev", label: "typesafe-ai/jev (Vercel AI Gateway)" };
  if (gatewayKey) {
    const viaGateway = createOpenAI({ baseURL: "https://ai-gateway.vercel.sh/v1", apiKey: gatewayKey });
    return {
      model: viaGateway.evaluationModel("openai/gpt-5.4-mini") as unknown as EvaluationModel,
      label: 'openai.evaluationModel("openai/gpt-5.4-mini") (gateway OpenAI-compatible endpoint)',
    };
  }
  return {
    model: createOpenAI().evaluationModel("gpt-5.4-mini") as unknown as EvaluationModel,
    label: 'openai.evaluationModel("gpt-5.4-mini") (OpenAI direct)',
  };
}

await runGoal(async () => {
  const { model, label } = evaluationModel();
  const gate = captureEvaluator(model);
  const chat = await conversation({
    model: DEFAULT_MODEL,
    // Under the control, the evaluator runs before capture and is never
    // given to it: the answers still trace, and capture ignores them.
    ...(CONTROL === "ignore-evaluator" ? { ignoredEvaluator: gate } : { evaluator: gate }),
  });

  const turns: Turn[] = [];
  for (const text of fx.turns) turns.push(await chat.say(text));

  const failures: string[] = [];
  turns.forEach((turn, i) => {
    const at = `turn ${i + 1} ${JSON.stringify(turn.text.slice(0, 40))}`;
    // d0: the capture succeeded and the evaluator answered with one of its options.
    if (turn.captureError !== undefined) failures.push(`d0: ${at}: the capture failed: ${turn.captureError}`);
    if (turn.answer !== "remember" && turn.answer !== "skip") {
      failures.push(`d0: ${at}: no evaluator answer in the trace (rows ${JSON.stringify(turn.rows)})`);
      return;
    }
    // d1: the observer ran if and only if the evaluator answered remember.
    if (turn.observed !== (turn.answer === "remember")) {
      failures.push(`d1: ${at}: answered ${turn.answer} but the observer ${turn.observed ? "ran" : "did not run"}`);
    }
    // d2: a skipped turn wrote nothing.
    if (turn.answer === "skip" && (turn.addedEntries.length > 0 || turn.addedEpisodes > 0)) {
      failures.push(`d2: ${at}: skipped, yet added ${turn.addedEntries.length} entries and ${turn.addedEpisodes} episodes`);
    }
  });
  // d3: the check is not vacuous. Which turn gets which answer is the model's
  // call and is never asserted, but a run where every turn got the same answer
  // exercised only one branch and proves nothing about the other.
  const answers = new Set(turns.map((t) => t.answer));
  if (!(answers.has("remember") && answers.has("skip"))) {
    failures.push(`d3: every turn got the same answer (${[...answers].join(", ")}): only one branch was exercised`);
  }

  const remembered = turns.filter((t) => t.answer === "remember").length;
  const skipped = turns.filter((t) => t.answer === "skip").length;
  return {
    failures,
    evidence:
      `${label}: ${remembered} remember / ${skipped} skip over ${turns.length} held-out turns; ` +
      `observer ran on exactly the ${turns.filter((t) => t.observed).length} remember turns; ` +
      `skipped turns added 0 entries and 0 episodes; ` +
      `per turn: ${turns.map((t) => `${t.answer}${t.observed ? "+observed" : ""}`).join(", ")}.`,
  };
});
