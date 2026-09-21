/**
 * One-shot evaluator wrappers. Each is a handler: the input is the state,
 * the output is one typed answer. Prefer these when you need a single
 * judgment; use `evaluator` when you want several questions at once.
 */

import { handler, type BlockDefinition } from "@flow-state-dev/core";
import type { ZodTypeAny } from "zod";
import type { EvaluateClient } from "./client";
import { TypeSafeError } from "./errors";
import { asTypeSafeState, runEvaluate } from "./run-evaluate";
import {
  boolean,
  booleanAnswerSchema,
  choice,
  choiceAnswerSchema,
  isBooleanAnswer,
  isChoiceAnswer,
  isNoulAnswer,
  isScoreAnswer,
  noul,
  noulAnswerSchema,
  score,
  scoreAnswerSchema,
  type BooleanAnswer,
  type BooleanQuestion,
  type ChoiceAnswer,
  type NoulAnswer,
  type NoulQuestion,
  type ScoreAnswer,
} from "./schemas";

interface OneshotBase<TInputSchema extends ZodTypeAny> {
  name: string;
  inputSchema: TInputSchema;
  model?: unknown;
  fallbackModel?: string;
  mode?: "evaluate" | "system-2";
  apiKey?: string;
  client?: EvaluateClient;
}

export interface SystemOneChoiceConfig<TInputSchema extends ZodTypeAny = ZodTypeAny>
  extends OneshotBase<TInputSchema> {
  instructions: string;
  criteria: Record<string, string | null>;
}

export interface SystemOneNoulConfig<TInputSchema extends ZodTypeAny = ZodTypeAny>
  extends OneshotBase<TInputSchema> {
  instructions: string;
  criteria?: NoulQuestion["criteria"];
}

export interface SystemOneBooleanConfig<TInputSchema extends ZodTypeAny = ZodTypeAny>
  extends OneshotBase<TInputSchema> {
  instructions: string;
  criteria?: BooleanQuestion["criteria"];
}

export interface SystemOneScoreConfig<TInputSchema extends ZodTypeAny = ZodTypeAny>
  extends OneshotBase<TInputSchema> {
  instructions: string;
  criteria: string[];
}

/**
 * One Choice question. Input is the state; output is the Choice answer.
 */
export function systemOneChoice<TInputSchema extends ZodTypeAny>(
  config: SystemOneChoiceConfig<TInputSchema>,
): BlockDefinition<TInputSchema, typeof choiceAnswerSchema, unknown, ChoiceAnswer> {
  return handler({
    name: config.name,
    inputSchema: config.inputSchema,
    outputSchema: choiceAnswerSchema,
    execute: async (input) => {
      const result = await runEvaluate({
        state: asTypeSafeState(input),
        questions: {
          [config.name]: choice(config.instructions, config.criteria),
        },
        model: config.model,
        fallbackModel: config.fallbackModel,
        mode: config.mode,
        apiKey: config.apiKey,
        client: config.client,
      });
      const answer = result.answers[config.name];
      if (!isChoiceAnswer(answer)) {
        throw new TypeSafeError(
          "unexpected_answer",
          `systemOneChoice "${config.name}" expected a choice answer.`,
        );
      }
      return answer;
    },
  });
}

/**
 * One Noul question. Input is the state; output is `{ type: "noul", noul }`.
 */
export function systemOneNoul<TInputSchema extends ZodTypeAny>(
  config: SystemOneNoulConfig<TInputSchema>,
): BlockDefinition<TInputSchema, typeof noulAnswerSchema, unknown, NoulAnswer> {
  return handler({
    name: config.name,
    inputSchema: config.inputSchema,
    outputSchema: noulAnswerSchema,
    execute: async (input) => {
      const result = await runEvaluate({
        state: asTypeSafeState(input),
        questions: {
          [config.name]: noul(config.instructions, config.criteria),
        },
        model: config.model,
        fallbackModel: config.fallbackModel,
        mode: config.mode,
        apiKey: config.apiKey,
        client: config.client,
      });
      const answer = result.answers[config.name];
      if (!isNoulAnswer(answer)) {
        throw new TypeSafeError(
          "unexpected_answer",
          `systemOneNoul "${config.name}" expected a noul answer.`,
        );
      }
      return answer;
    },
  });
}

/**
 * One boolean question. Input is the state; output is `{ type: "boolean", probability }`.
 */
export function systemOneBoolean<TInputSchema extends ZodTypeAny>(
  config: SystemOneBooleanConfig<TInputSchema>,
): BlockDefinition<TInputSchema, typeof booleanAnswerSchema, unknown, BooleanAnswer> {
  return handler({
    name: config.name,
    inputSchema: config.inputSchema,
    outputSchema: booleanAnswerSchema,
    execute: async (input) => {
      const result = await runEvaluate({
        state: asTypeSafeState(input),
        questions: {
          [config.name]: boolean(config.instructions, config.criteria),
        },
        model: config.model,
        fallbackModel: config.fallbackModel,
        mode: config.mode,
        apiKey: config.apiKey,
        client: config.client,
      });
      const answer = result.answers[config.name];
      if (!isBooleanAnswer(answer)) {
        throw new TypeSafeError(
          "unexpected_answer",
          `systemOneBoolean "${config.name}" expected a boolean answer.`,
        );
      }
      return answer;
    },
  });
}

/**
 * One Score question. Input is the state; output is the Score answer.
 */
export function systemOneScore<TInputSchema extends ZodTypeAny>(
  config: SystemOneScoreConfig<TInputSchema>,
): BlockDefinition<TInputSchema, typeof scoreAnswerSchema, unknown, ScoreAnswer> {
  return handler({
    name: config.name,
    inputSchema: config.inputSchema,
    outputSchema: scoreAnswerSchema,
    execute: async (input) => {
      const result = await runEvaluate({
        state: asTypeSafeState(input),
        questions: {
          [config.name]: score(config.instructions, config.criteria),
        },
        model: config.model,
        fallbackModel: config.fallbackModel,
        mode: config.mode,
        apiKey: config.apiKey,
        client: config.client,
      });
      const answer = result.answers[config.name];
      if (!isScoreAnswer(answer)) {
        throw new TypeSafeError(
          "unexpected_answer",
          `systemOneScore "${config.name}" expected a score answer.`,
        );
      }
      return answer;
    },
  });
}
