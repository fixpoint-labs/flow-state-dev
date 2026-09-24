/**
 * Public types for the `evaluator` block kind: the evaluation model an
 * evaluator calls, the questions it asks, and the typed answers it returns.
 *
 * These are FSD's own shapes. The AI SDK's evaluation contract is
 * experimental and may change in patch releases, so exactly one module
 * (`models/evaluate.ts`) imports the SDK's evaluation types and maps them
 * into these. Nothing else in the framework, and no consumer, reads the
 * SDK's shapes directly.
 */
import type { JsonObject, JsonValue } from "../schema/common";

/**
 * Text or structured JSON an evaluation model reads: the evaluated state, a
 * question's instructions, or an option's description.
 */
export type EvaluationInput = string | JsonObject | JsonValue[];

/** The question types an evaluation model can be asked. */
export type EvaluationQuestionType = "choice" | "score" | "boolean";

/**
 * An AI SDK evaluation model: what a provider's `evaluationModel(id)`
 * returns (for example `openai.evaluationModel("gpt-5.4-mini")`, or Jev's
 * `typeSafeAi.evaluationModel("jev-latest")`).
 *
 * Kept structural and opaque on purpose: FSD checks only what it needs to
 * tell an evaluation model from a text model and to report its identity.
 * The call contract (`doEvaluate`) is the SDK's.
 */
export interface EvaluationModel {
  readonly specificationVersion: string;
  /** Provider id reported by the model, e.g. `"openai.evaluation"`. */
  readonly provider: string;
  /** Model id, e.g. `"gpt-5.4-mini"` or `"jev-latest"`. */
  readonly modelId: string;
  /** The question types this model answers. */
  readonly supportedQuestionTypes: readonly EvaluationQuestionType[];
  /** The SDK's evaluation call. Invoked only through `experimental_evaluate`. */
  doEvaluate(options: never): PromiseLike<unknown>;
}

/** A multiple-choice question. `TOption` is the union of option keys. */
export type ChoiceQuestion<TOption extends string = string> = {
  readonly type: "choice";
  readonly instructions: EvaluationInput;
  /** Option key → description (`null` for no description). */
  readonly criteria: Readonly<Record<TOption, EvaluationInput | null>>;
};

/** An ordered-scale question. Levels are indexed from 0. */
export type ScoreQuestion = {
  readonly type: "score";
  readonly instructions: EvaluationInput;
  /** At least two ordered level descriptions (`null` for no description). */
  readonly criteria: readonly (EvaluationInput | null)[];
};

/** A yes/no question, answered as P(true). */
export type BooleanQuestion = {
  readonly type: "boolean";
  readonly instructions: EvaluationInput;
  /** Optional descriptions of what true and false mean. */
  readonly criteria?: {
    readonly true?: EvaluationInput | null;
    readonly false?: EvaluationInput | null;
  };
};

/** Any one evaluator question. */
export type EvaluatorQuestion = ChoiceQuestion<string> | ScoreQuestion | BooleanQuestion;

/** A question set: question id → question. Ids become the keys of `answers`. */
export type EvaluatorQuestions = Record<string, EvaluatorQuestion>;

/**
 * The answer to a choice question. `confidence` is present only when the
 * model reported one; the evaluator never supplies it.
 */
export type ChoiceAnswer<TOption extends string = string> = {
  type: "choice";
  /** One of the question's option keys. */
  choice: TOption;
  /** Distribution over the option keys, when the model returned one. */
  probabilities?: Record<TOption, number>;
  /** The model's own reported confidence in this answer, when it gave one. */
  confidence?: number;
};

/** The answer to a score question. */
export type ScoreAnswer = {
  type: "score";
  /** Position in `[0, levels - 1]`. May be fractional. */
  score: number;
  /** Distribution keyed by level index (`"0"`, `"1"`, …), when returned. */
  probabilities?: Record<string, number>;
  /** The model's own reported confidence in this answer, when it gave one. */
  confidence?: number;
};

/** The answer to a boolean question. */
export type BooleanAnswer = {
  type: "boolean";
  /**
   * The model's estimate that the answer is yes: P(true). It is an answer,
   * not the model's confidence in it.
   */
  probability: number;
  /** The model's own reported confidence in this answer, when it gave one. */
  confidence?: number;
};

/** The answer type for one question, typed by that question. */
export type EvaluatorAnswer<TQuestion extends EvaluatorQuestion = EvaluatorQuestion> =
  TQuestion extends ChoiceQuestion<infer TOption>
    ? ChoiceAnswer<TOption>
    : TQuestion extends ScoreQuestion
      ? ScoreAnswer
      : BooleanAnswer;

/** Answers for a whole question set, keyed by question id. */
export type EvaluatorAnswers<TQuestions extends EvaluatorQuestions = EvaluatorQuestions> = {
  [TId in keyof TQuestions]: EvaluatorAnswer<TQuestions[TId]>;
};

/** An evaluator block's output. */
export type EvaluatorOutput<TQuestions extends EvaluatorQuestions = EvaluatorQuestions> = {
  answers: EvaluatorAnswers<TQuestions>;
};
