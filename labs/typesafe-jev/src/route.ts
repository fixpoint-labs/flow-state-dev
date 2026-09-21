/**
 * Intent routing + confidence-gated routing on TypeSafe answers.
 *
 * Code owns the branch. The model returns a choice and a confidence; this
 * helper encodes the risk tolerance. See https://docs.typesafe.ai/patterns
 * and https://docs.typesafe.ai/confidence.
 */

import type { BooleanAnswer, ChoiceAnswer, NoulAnswer, TypeSafeAnswer } from "./schemas";
import { truthProbability } from "./schemas";

/** TypeSafe's documented "genuinely unsure" floor. */
export const DEFAULT_MIN_CONFIDENCE = 0.5;

export interface RouteDecision {
  /** Selected option, or `escalate` when the gate fires. */
  destination: string;
  reason: string;
}

export interface RouteByChoiceOptions {
  choice: ChoiceAnswer;
  /** Below this, do not act on the choice. */
  minConfidence?: number;
  /**
   * Extra escalate: a boolean / noul (e.g. urgency) above `whenAbove`,
   * optionally only when the choice matches `andChoice`.
   */
  escalateIf?: {
    truth?: TypeSafeAnswer;
    noul?: NoulAnswer;
    boolean?: BooleanAnswer;
    whenAbove: number;
    andChoice?: string;
  };
}

/**
 * Intent-route a Choice answer, with confidence as a second axis.
 *
 * High confidence → the choice. Low confidence → `escalate`. An optional
 * boolean / noul can force escalate on a high-stakes combination
 * (urgent + billing).
 */
export function routeByChoice(options: RouteByChoiceOptions): RouteDecision {
  const min = options.minConfidence ?? DEFAULT_MIN_CONFIDENCE;
  const { choice } = options.choice;

  if (
    typeof options.choice.confidence !== "number" ||
    !Number.isFinite(options.choice.confidence) ||
    options.choice.confidence < min
  ) {
    return {
      destination: "escalate",
      reason: `confidence ${options.choice.confidence} < ${min} on "${choice}"`,
    };
  }

  const extra = options.escalateIf;
  if (extra !== undefined) {
    const choiceMatches =
      extra.andChoice === undefined || extra.andChoice === choice;
    const probability =
      truthProbability(extra.truth) ??
      truthProbability(extra.boolean) ??
      truthProbability(extra.noul);
    if (choiceMatches && probability !== undefined && probability > extra.whenAbove) {
      return {
        destination: "escalate",
        reason: `truth ${probability} > ${extra.whenAbove} with choice "${choice}"`,
      };
    }
  }

  return {
    destination: choice,
    reason: `choice "${choice}" at confidence ${options.choice.confidence}`,
  };
}
