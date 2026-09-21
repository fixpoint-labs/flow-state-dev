/**
 * Evaluator question / answer shapes. Mirrors AI SDK `experimental_evaluate`:
 * choice, score, and boolean. `noul` is dual-read (TypeSafe's older name for
 * boolean) and maps to boolean on the evaluate path.
 */

import { z } from "zod";

/** Jev on AI Gateway. */
export const DEFAULT_EVALUATE_MODEL = "typesafe-ai/jev";

/** Language-model fallback when the configured model cannot evaluate. */
export const DEFAULT_SYSTEM2_MODEL = "openai/gpt-5.4-mini";

/** @deprecated Use DEFAULT_EVALUATE_MODEL. */
export const DEFAULT_TYPESAFE_MODEL = DEFAULT_EVALUATE_MODEL;

export const booleanQuestionSchema = z.object({
  type: z.literal("boolean"),
  instructions: z.string().min(1),
  criteria: z
    .object({
      true: z.string().optional(),
      false: z.string().optional(),
    })
    .optional(),
});

/** Dual-read of TypeSafe's older boolean name. */
export const noulQuestionSchema = z.object({
  type: z.literal("noul"),
  instructions: z.string().min(1),
  criteria: z
    .object({
      true: z.string().optional(),
      false: z.string().optional(),
    })
    .optional(),
});

export const choiceQuestionSchema = z.object({
  type: z.literal("choice"),
  instructions: z.string().min(1),
  criteria: z.record(z.string(), z.string().nullable()),
});

export const scoreQuestionSchema = z.object({
  type: z.literal("score"),
  instructions: z.string().min(1),
  criteria: z.array(z.string()).min(2),
});

export const questionSchema = z.discriminatedUnion("type", [
  booleanQuestionSchema,
  noulQuestionSchema,
  choiceQuestionSchema,
  scoreQuestionSchema,
]);

export const questionsSchema = z.record(z.string(), questionSchema);

export const stateSchema = z.union([
  z.string(),
  z.array(z.unknown()),
  z.record(z.string(), z.unknown()),
]);

export const booleanAnswerSchema = z.object({
  type: z.literal("boolean"),
  probability: z.number(),
});

export const noulAnswerSchema = z.object({
  type: z.literal("noul"),
  noul: z.number(),
});

export const choiceAnswerSchema = z.object({
  type: z.literal("choice"),
  choice: z.string(),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number(),
});

export const scoreAnswerSchema = z.object({
  type: z.literal("score"),
  score: z.number(),
  legend: z.record(z.string(), z.string()),
  probabilities: z.record(z.string(), z.number()),
  confidence: z.number(),
});

export const answerSchema = z.discriminatedUnion("type", [
  booleanAnswerSchema,
  noulAnswerSchema,
  choiceAnswerSchema,
  scoreAnswerSchema,
]);

export const answersSchema = z.record(z.string(), answerSchema);

export const usageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cost: z.number().optional(),
});

export const evaluatePathSchema = z.enum(["evaluate", "system-2"]);

export const evaluateInputSchema = z.object({
  state: stateSchema,
  questions: questionsSchema.optional(),
});

export const evaluateOutputSchema = z.object({
  model: z.string(),
  answers: answersSchema,
  usage: usageSchema.optional(),
  id: z.string().optional(),
  provider: z.string().optional(),
  path: evaluatePathSchema.optional(),
});

export type BooleanQuestion = z.infer<typeof booleanQuestionSchema>;
export type NoulQuestion = z.infer<typeof noulQuestionSchema>;
export type ChoiceQuestion = z.infer<typeof choiceQuestionSchema>;
export type ScoreQuestion = z.infer<typeof scoreQuestionSchema>;
export type TypeSafeQuestion = z.infer<typeof questionSchema>;
export type TypeSafeQuestions = z.infer<typeof questionsSchema>;
export type TypeSafeState = z.infer<typeof stateSchema>;
export type BooleanAnswer = z.infer<typeof booleanAnswerSchema>;
export type NoulAnswer = z.infer<typeof noulAnswerSchema>;
export type ChoiceAnswer = z.infer<typeof choiceAnswerSchema>;
export type ScoreAnswer = z.infer<typeof scoreAnswerSchema>;
export type TypeSafeAnswer = z.infer<typeof answerSchema>;
export type TypeSafeAnswers = z.infer<typeof answersSchema>;
export type TypeSafeUsage = z.infer<typeof usageSchema>;
export type EvaluatePath = z.infer<typeof evaluatePathSchema>;
export type TypeSafeEvaluateInput = z.infer<typeof evaluateInputSchema>;
export type TypeSafeEvaluateOutput = z.infer<typeof evaluateOutputSchema>;

/** Typed answer for a question declared at the factory. */
export type AnswerFor<Q extends TypeSafeQuestion> = Q extends { type: "boolean" }
  ? BooleanAnswer
  : Q extends { type: "noul" }
    ? NoulAnswer
    : Q extends { type: "choice"; criteria: infer C }
      ? ChoiceAnswer & { choice: keyof C & string }
      : Q extends { type: "score" }
        ? ScoreAnswer
        : TypeSafeAnswer;

/** Answers keyed the same way as a static questions map. */
export type AnswersFor<Q extends TypeSafeQuestions> = {
  [K in keyof Q]: AnswerFor<Q[K]>;
};

/**
 * Build a boolean question. Optional criteria clarify what yes / no mean.
 */
export function boolean(
  instructions: string,
  criteria?: BooleanQuestion["criteria"],
): BooleanQuestion {
  return criteria === undefined
    ? { type: "boolean", instructions }
    : { type: "boolean", instructions, criteria };
}

/**
 * Dual-read alias of `boolean`. TypeSafe called this noul.
 */
export function noul(
  instructions: string,
  criteria?: NoulQuestion["criteria"],
): NoulQuestion {
  return criteria === undefined
    ? { type: "noul", instructions }
    : { type: "noul", instructions, criteria };
}

/**
 * Build a choice question. Criteria keys are the options your code branches on.
 */
export function choice(
  instructions: string,
  criteria: ChoiceQuestion["criteria"],
): ChoiceQuestion {
  return { type: "choice", instructions, criteria };
}

/**
 * Build a score question. Criteria are ordered levels; the score can land between them.
 */
export function score(instructions: string, criteria: string[]): ScoreQuestion {
  return { type: "score", instructions, criteria };
}

/** Narrow a mixed answers map entry. */
export function isBooleanAnswer(answer: TypeSafeAnswer): answer is BooleanAnswer {
  return answer.type === "boolean";
}

/** Narrow a mixed answers map entry. */
export function isNoulAnswer(answer: TypeSafeAnswer): answer is NoulAnswer {
  return answer.type === "noul";
}

/** Narrow a mixed answers map entry. */
export function isChoiceAnswer(answer: TypeSafeAnswer): answer is ChoiceAnswer {
  return answer.type === "choice";
}

/** Narrow a mixed answers map entry. */
export function isScoreAnswer(answer: TypeSafeAnswer): answer is ScoreAnswer {
  return answer.type === "score";
}

/**
 * P(true) from a boolean or legacy noul answer. Undefined for other types.
 */
export function truthProbability(answer: TypeSafeAnswer | undefined): number | undefined {
  if (answer === undefined) return undefined;
  if (answer.type === "boolean") return answer.probability;
  if (answer.type === "noul") return answer.noul;
  return undefined;
}
