/**
 * Map lab questions/answers ↔ AI SDK `experimental_evaluate` shapes.
 *
 * SDK question types are choice / score / boolean. Lab `noul` is boolean
 * on the wire and noul again on the way back when the question was noul.
 */

import type {
  BooleanQuestion,
  NoulQuestion,
  TypeSafeAnswer,
  TypeSafeAnswers,
  TypeSafeEvaluateOutput,
  TypeSafeQuestion,
  TypeSafeQuestions,
} from "./schemas";

export type SdkQuestion =
  | { type: "boolean"; instructions: string; criteria?: BooleanQuestion["criteria"] }
  | { type: "choice"; instructions: string; criteria: Record<string, string | null> }
  | { type: "score"; instructions: string; criteria: string[] };

export type SdkAnswer =
  | { type: "boolean"; probability: number }
  | { type: "choice"; choice: string; probabilities?: Record<string, number> }
  | { type: "score"; score: number; probabilities?: Record<string, number> };

export interface SdkEvaluateResult {
  answers: Record<string, SdkAnswer>;
  providerMetadata?: {
    typesafe?: { confidence?: Record<string, number> };
  };
  usage?: { inputTokens?: number; outputTokens?: number };
}

function booleanLike(question: BooleanQuestion | NoulQuestion): SdkQuestion {
  return question.criteria === undefined
    ? { type: "boolean", instructions: question.instructions }
    : { type: "boolean", instructions: question.instructions, criteria: question.criteria };
}

/** Lab questions → SDK questions. `noul` becomes `boolean`. */
export function toSdkQuestions(questions: TypeSafeQuestions): Record<string, SdkQuestion> {
  const out: Record<string, SdkQuestion> = {};
  for (const [id, question] of Object.entries(questions)) {
    out[id] = toSdkQuestion(question);
  }
  return out;
}

function toSdkQuestion(question: TypeSafeQuestion): SdkQuestion {
  if (question.type === "noul" || question.type === "boolean") {
    return booleanLike(question);
  }
  if (question.type === "choice") {
    return {
      type: "choice",
      instructions: question.instructions,
      criteria: question.criteria,
    };
  }
  return {
    type: "score",
    instructions: question.instructions,
    criteria: question.criteria,
  };
}

/** SDK answers → lab answers. Confidence is lifted from providerMetadata. */
export function fromSdkResult(
  questions: TypeSafeQuestions,
  result: SdkEvaluateResult,
  model: string,
): TypeSafeEvaluateOutput {
  const confidence = result.providerMetadata?.typesafe?.confidence ?? {};
  const answers: TypeSafeAnswers = {};
  for (const [id, question] of Object.entries(questions)) {
    const raw = result.answers[id];
    if (raw === undefined) continue;
    answers[id] = fromSdkAnswer(question, raw, confidence[id]);
  }
  const usage =
    result.usage?.inputTokens !== undefined || result.usage?.outputTokens !== undefined
      ? {
          input_tokens: result.usage.inputTokens ?? 0,
          output_tokens: result.usage.outputTokens ?? 0,
        }
      : undefined;
  return {
    model,
    answers,
    usage,
    path: "evaluate",
  };
}

function fromSdkAnswer(
  question: TypeSafeQuestion,
  raw: SdkAnswer,
  confidence: number | undefined,
): TypeSafeAnswer {
  if (raw.type === "boolean") {
    if (question.type === "noul") {
      return { type: "noul", noul: raw.probability };
    }
    return { type: "boolean", probability: raw.probability };
  }
  if (raw.type === "choice") {
    return {
      type: "choice",
      choice: raw.choice,
      ...(raw.probabilities !== undefined ? { probabilities: raw.probabilities } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
    };
  }
  const legend: Record<string, string> =
    question.type === "score"
      ? Object.fromEntries(question.criteria.map((label, index) => [String(index), label]))
      : {};
  return {
    type: "score",
    score: raw.score,
    legend,
    ...(raw.probabilities !== undefined ? { probabilities: raw.probabilities } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
  };
}
