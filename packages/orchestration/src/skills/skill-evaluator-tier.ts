/**
 * Tier 3 of `createSkillActivator` when the app passes an evaluator.
 *
 * Three steps: list the catalog this binding may offer and hand it to the
 * evaluator as `{ message, skills }`, plus `recentMessages` read from the
 * session when the block was built with `skillEvaluator(model, {
 * recentMessages })`; run the app's evaluator (skipped when the catalog is
 * empty); read its `skill` answer into the activator's state.
 *
 * The pick is final. A skill activates with the model's own confidence when
 * it reported one and none otherwise; nothing is compared to a threshold and
 * no number is invented. "No skill" activates nothing. An evaluator error
 * fails the tier, and with it the activator: there is no fallback to the
 * generator classifier, which is never built alongside this tier.
 *
 * Imports core's evaluator types only; the block is the app's.
 */

import { z } from "zod";
import { handler, sequencer } from "@flow-state-dev/core";
import type { EvaluatorDefinition } from "@flow-state-dev/core";
import { resolveResourceCollection } from "../tasks";
import { listOfferedSkills } from "./skill-catalog";
import {
  matchedSkillSchema,
  NO_SKILL,
  skillActivatorStateSchema,
} from "./skill-activation-types";
import type { SkillEvaluatorInput } from "./skill-evaluator";
import { readRecentMessages, recentTurnsFor } from "./skill-evaluator-turns";

const inputSchema = z.object({ message: z.string() }).passthrough();

/** Any evaluator block: what `createSkillActivator`'s `evaluator` slot holds. */
export type AnyEvaluatorBlock = EvaluatorDefinition<any, any, any>;

export interface SkillEvaluatorTierOptions {
  collectionKey: string;
  /** Cap on the skills offered as options. */
  maxSkillsInClassifier: number;
  /** When set, only these skill names are offered. */
  allowed?: readonly string[];
  /** The app's evaluator; must ask a `skill` choice question. */
  evaluator: AnyEvaluatorBlock;
}

/**
 * Build the evaluator tier: the sequencer `createSkillActivator`'s
 * `tapIf(!resolved)` targets when an evaluator is passed.
 */
export function createSkillEvaluatorTier(opts: SkillEvaluatorTierOptions) {
  const allowedSet = opts.allowed ? new Set(opts.allowed) : undefined;
  const blockName = opts.evaluator.name;

  const offered = (ctx: Parameters<typeof resolveResourceCollection>[0]) =>
    listOfferedSkills(
      resolveResourceCollection(ctx, opts.collectionKey),
      opts.maxSkillsInClassifier,
      allowedSet,
    );

  // Earlier turns the evaluator asked for; 0 for any block not built by
  // skillEvaluator(model, { recentMessages }).
  const recentTurns = recentTurnsFor(opts.evaluator);

  // The options come from the collection only, never from the action input,
  // which carries the user's message and nothing that chooses skills. Earlier
  // turns come from the session only, and are read only when the evaluator
  // will run: never for an empty catalog.
  const listCatalog = handler({
    name: "list-skill-evaluator-catalog",
    inputSchema,
    execute: async (input, ctx): Promise<SkillEvaluatorInput> => {
      const skills = await offered(ctx);
      if (recentTurns === 0 || skills.length === 0) return { message: input.message, skills };
      return {
        message: input.message,
        skills,
        recentMessages: await readRecentMessages(ctx, recentTurns),
      };
    },
  });

  const apply = handler({
    name: "apply-skill-evaluator-result",
    outputSchema: z.object({ accepted: z.boolean() }),
    sequencerStateSchema: skillActivatorStateSchema,
    execute: async (input: unknown, ctx) => {
      // Empty catalog: the evaluator was skipped and its input passed through.
      if (!isRecord(input) || !("answers" in input)) {
        await ctx.sequencer!.patchState({ resolved: true });
        return { accepted: true };
      }

      const answer = isRecord(input.answers) ? input.answers.skill : undefined;
      if (!isRecord(answer) || answer.type !== "choice" || typeof answer.choice !== "string") {
        throw new Error(
          `Skill activator: evaluator "${blockName}" did not answer a "skill" choice question. ` +
            "Build it with skillEvaluator(model), or pass skillQuestions as its questions.",
        );
      }

      const pick = answer.choice;
      // Re-read the catalog rather than trusting the pre-call snapshot: a
      // skill removed, disabled or taken out of the binding while the call
      // was in flight must not activate. Fails closed, as the classifier's
      // own apply step does.
      const names = new Set((await offered(ctx)).map((s) => s.name));
      const reported = typeof answer.confidence === "number" ? answer.confidence : undefined;
      const matches =
        pick !== NO_SKILL && names.has(pick)
          ? [
              matchedSkillSchema.parse({
                name: pick,
                input: "",
                source: "classifier",
                ...(reported !== undefined ? { confidence: reported } : {}),
              }),
            ]
          : [];

      const existing = ctx.sequencer?.state.skills ?? [];
      await ctx.sequencer!.patchState({
        resolved: true,
        skills: [...existing, ...matches],
        classifierConfidence: matches.length > 0 && reported !== undefined ? reported : null,
      });
      return { accepted: true };
    },
  });

  return sequencer({ name: "skill-evaluator-tier", inputSchema })
    .step(listCatalog)
    .stepIf((input) => (input as SkillEvaluatorInput).skills.length > 0, opts.evaluator)
    .tap(apply);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
