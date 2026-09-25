/**
 * The check behind `captures-without-an-evaluator`, as a function, so the
 * evaluator epic's assembled goal can run it as its leg (f) without copying it.
 *
 * Memory built with no evaluator captures a turn that states a durable fact on
 * a real observer model: the capture succeeds, working memory gains an entry,
 * and no evaluator row appears in the trace.
 *
 * `control: "throwing-evaluator"` builds the same capture with an evaluator
 * whose model throws. The capture must then fail, so this check must FAIL:
 * it proves the check reads the capture's outcome rather than passing on a
 * pipeline it never looked at.
 */
import type { EvaluationModel } from "@flow-state-dev/core";
import type { GoalResult } from "../../lib/index.mts";
import { captureEvaluator } from "../../../packages/memory/src/index.ts";
import { conversation } from "../harness.mts";

export type CapturesWithoutAnEvaluatorOptions = {
  /** The turn to capture. It must state at least one durable fact. */
  turn: string;
  /** The observer's model, e.g. `openai/gpt-5.4-mini`. */
  model: string;
  /** `throwing-evaluator` degrades the capture on purpose; see the file header. */
  control?: "throwing-evaluator";
};

/** An evaluation model whose every call fails. */
function throwingModel(): EvaluationModel {
  return {
    specificationVersion: "v4",
    provider: "goal.control",
    modelId: "throwing-evaluator",
    supportedQuestionTypes: ["choice", "score", "boolean"],
    doEvaluate: async () => {
      throw new Error("GOAL_CONTROL=throwing-evaluator: the evaluation model failed");
    },
  } as unknown as EvaluationModel;
}

export async function checkCapturesWithoutAnEvaluator(
  options: CapturesWithoutAnEvaluatorOptions,
): Promise<GoalResult> {
  const chat = await conversation({
    model: options.model,
    ...(options.control === "throwing-evaluator" ? { evaluator: captureEvaluator(throwingModel()) } : {}),
  });
  const turn = await chat.say(options.turn);

  const failures: string[] = [];
  // f1: the capture itself succeeded.
  if (turn.captureError !== undefined) failures.push(`f1: the capture failed: ${turn.captureError}`);
  // f2: a durable fact landed in working memory. Existence only, never its wording.
  if (turn.addedEntries.length === 0) failures.push("f2: no working-memory entry was added for a turn that states a durable fact");
  // f3: the observer ran, and no evaluator row is anywhere in the trace.
  if (!turn.observed) failures.push(`f3: the observer did not run; capture traced ${JSON.stringify(turn.rows)}`);
  if (turn.kinds.includes("evaluator")) failures.push(`f3: an evaluator row traced with no evaluator installed: ${JSON.stringify(turn.rows)}`);

  return {
    failures,
    evidence:
      `no evaluator installed; capture traced ${JSON.stringify(turn.rows.filter((r) => r !== "turn"))}, ` +
      `no evaluator row; ${turn.addedEntries.length} working-memory entr${turn.addedEntries.length === 1 ? "y" : "ies"} ` +
      `and ${turn.addedEpisodes} episode(s) added on ${options.model}.`,
  };
}
