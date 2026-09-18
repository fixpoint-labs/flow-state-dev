/**
 * TypeSafe question / answer shapes. Mirrors
 * https://docs.typesafe.ai/api and the OpenRouter Decisions body.
 */

import { z } from "zod";

/** Jev alias OpenRouter documents. Always the latest Jev family member. */
export const DEFAULT_TYPESAFE_MODEL = "~typesafe/jev-latest";

/** OpenRouter's System One / Decisions endpoint (not chat completions). */
export const OPENROUTER_DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";

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
});

export type NoulQuestion = z.infer<typeof noulQuestionSchema>;
export type ChoiceQuestion = z.infer<typeof choiceQuestionSchema>;
export type ScoreQuestion = z.infer<typeof scoreQuestionSchema>;
export type TypeSafeQuestion = z.infer<typeof questionSchema>;
export type TypeSafeQuestions = z.infer<typeof questionsSchema>;
export type TypeSafeState = z.infer<typeof stateSchema>;
export type NoulAnswer = z.infer<typeof noulAnswerSchema>;
export type ChoiceAnswer = z.infer<typeof choiceAnswerSchema>;
export type ScoreAnswer = z.infer<typeof scoreAnswerSchema>;
export type TypeSafeAnswer = z.infer<typeof answerSchema>;
export type TypeSafeAnswers = z.infer<typeof answersSchema>;
export type TypeSafeUsage = z.infer<typeof usageSchema>;
export type TypeSafeEvaluateInput = z.infer<typeof evaluateInputSchema>;
export type TypeSafeEvaluateOutput = z.infer<typeof evaluateOutputSchema>;

/** Typed answer for a question declared at the factory. */
export type AnswerFor<Q extends TypeSafeQuestion> = Q extends { type: "noul" }
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
 * Build a noul question. Optional criteria clarify what yes / no mean.
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
