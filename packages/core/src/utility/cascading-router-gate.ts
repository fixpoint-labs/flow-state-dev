/**
 * The gate `cascadingRouter` puts on every edge of its tree: one pure
 * function that reads one evaluator answer and decides whether an edge opens.
 *
 * Every level of every cascade is decided here and nowhere else. An edge
 * opens only when the answer is a choice that has a branch, the model
 * reported a confidence (a finite number in [0, 1]), and that confidence
 * reaches the edge's `minConfidence` when one is set. Anything else is
 * `ambiguous`, with the reason. A choice's `probabilities` and a boolean's
 * `probability` are never read: neither is the model's confidence.
 */
import type { EvaluatorAnswer } from "../types/evaluation";

/** Why a gate did not open an edge. */
export type CascadeAmbiguousReason = "no-confidence" | "below-floor" | "no-branch";

/** What the gate needs to know about one branch. */
export type CascadeGateBranch = {
  /** The edge's floor, inclusive. Absent: any reported confidence opens it. */
  minConfidence?: number;
};

/** The gate's decision for one level: the edge to take, or `ambiguous` and why. */
export type CascadeGateDecision =
  | { edge: string; confidence: number }
  | { ambiguous: CascadeAmbiguousReason };

/** A confidence the model actually reported: a finite number in [0, 1]. */
function reportedConfidence(answer: { confidence?: unknown }): number | undefined {
  const value = answer.confidence;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : undefined;
}

/**
 * Decide one level of a cascade from the answer to the question it routes on.
 *
 * @param answer - The evaluator's answer to the level's `on` question, if any.
 * @param branches - The level's branches, keyed by option. Only own keys count.
 */
export function cascadeGate(
  answer: EvaluatorAnswer | undefined,
  branches: Readonly<Record<string, CascadeGateBranch>>
): CascadeGateDecision {
  if (
    answer === undefined ||
    answer === null ||
    answer.type !== "choice" ||
    typeof answer.choice !== "string" ||
    !Object.prototype.hasOwnProperty.call(branches, answer.choice)
  ) {
    return { ambiguous: "no-branch" };
  }
  const confidence = reportedConfidence(answer);
  if (confidence === undefined) return { ambiguous: "no-confidence" };
  const floor = branches[answer.choice]!.minConfidence;
  if (floor !== undefined && confidence < floor) return { ambiguous: "below-floor" };
  return { edge: answer.choice, confidence };
}
