/**
 * The question `createSkillActivator`'s evaluator tier asks, and a helper
 * that builds the evaluator block around it.
 *
 * `skillEvaluator(model)` is the common case: core's `evaluator()` with the
 * activator's one question and the app's model, passed through untouched.
 * Core resolves a model string when the block runs; nothing here resolves or
 * names a model. An app that wants its own block name, state or `uses`
 * builds the evaluator itself with `skillQuestions`.
 *
 * This is the only module in the package that imports core's evaluator
 * values, so an activator built without an evaluator never builds one.
 */

import { z } from "zod";
import { choice, evaluator } from "@flow-state-dev/core";
import type {
  ChoiceQuestion,
  EvaluationModel,
} from "@flow-state-dev/core/types";
import type { EvaluatorDefinition } from "@flow-state-dev/core";
import { NO_SKILL } from "./skill-activation-types";
import type { OfferedSkill } from "./skill-catalog";

/**
 * What the activator hands its evaluator: the user's message and the skills
 * this binding may activate (allowed, model-invocable, capped).
 */
export interface SkillEvaluatorInput {
  message: string;
  skills: OfferedSkill[];
}

/** Runtime schema for {@link SkillEvaluatorInput}. */
export const skillEvaluatorInputSchema = z.object({
  message: z.string(),
  skills: z.array(z.object({ name: z.string(), description: z.string() })),
});

/** The question set the activator reads: one `skill` choice. */
export type SkillQuestions = { skill: ChoiceQuestion<string> };

/**
 * Build the activator's question for one turn: a `skill` choice whose
 * options are the offered skills (each described by its description and
 * `whenToUse`) plus a "no skill" option, so the model never has to force a
 * match.
 *
 * Pass it as an evaluator's `questions` when building the block yourself.
 */
export function skillQuestions(input: SkillEvaluatorInput): SkillQuestions {
  const options: Record<string, string | null> = {};
  for (const skill of input.skills) {
    options[skill.name] = skill.description.length > 0 ? skill.description : null;
  }
  options[NO_SKILL] = "None of these skills fits the message.";
  return {
    skill: choice(
      "Which skill, if any, should be used to answer this user message? " +
        "Pick a skill only when its description clearly fits what the user is asking for.",
      options,
    ),
  };
}

/** The evaluator block {@link skillEvaluator} returns. */
export type SkillEvaluatorBlock = EvaluatorDefinition<
  typeof skillEvaluatorInputSchema,
  SkillEvaluatorInput,
  SkillQuestions
>;

/**
 * Build the evaluator `createSkillActivator` uses for tier 3: it evaluates
 * the user's message against {@link skillQuestions}.
 *
 * @param model - A model string, resolved by core through the app's model
 *   resolver when the block runs, or an evaluation model instance such as
 *   `openai.evaluationModel("gpt-5.4-mini")`, used as given. A model that
 *   can only generate is refused here, by core.
 *
 * @example
 * createSkillActivator({ initialSkills, evaluator: skillEvaluator("typesafe-ai/jev") });
 */
export function skillEvaluator(model: string | EvaluationModel): SkillEvaluatorBlock {
  return evaluator({
    name: "skill-evaluator",
    model,
    inputSchema: skillEvaluatorInputSchema,
    state: (input) => input.message,
    questions: skillQuestions,
  });
}
