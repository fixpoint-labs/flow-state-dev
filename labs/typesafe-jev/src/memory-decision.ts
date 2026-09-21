/**
 * Sketch: evaluator decisions for memory capture.
 *
 * Store / salience / a coarse kind tag on a candidate snippet. Memory
 * does not import this module — the host passes the block as
 * `memory.system({ classifier })`. Omit it and capture stays on today's
 * generator. Optional = model capability, not package mount. This is
 * the inject seam only; capture is not rewritten here.
 */

import { handler, type BlockDefinition } from "@flow-state-dev/core";
import { z } from "zod";
import type { EvaluateClient } from "./client";
import { asTypeSafeState, runEvaluate } from "./run-evaluate";
import {
  boolean,
  choice,
  isChoiceAnswer,
  isScoreAnswer,
  score,
  truthProbability,
} from "./schemas";

export const MEMORY_STORE_QUESTION = "store";
export const MEMORY_SALIENCE_QUESTION = "salience";
export const MEMORY_KIND_QUESTION = "kind";

export const MEMORY_KIND_NONE = "skip";

export const memoryDecisionInputSchema = z.object({
  text: z.string(),
});

export const memoryDecisionOutputSchema = z.object({
  store: z.boolean(),
  salience: z.number().min(0).max(1).nullable(),
  kind: z.string().nullable(),
});

export type MemoryDecisionInput = z.infer<typeof memoryDecisionInputSchema>;
export type MemoryDecisionOutput = z.infer<typeof memoryDecisionOutputSchema>;

export interface SystemOneMemoryDecisionOptions {
  client?: EvaluateClient;
  apiKey?: string;
  model?: unknown;
  name?: string;
  storeThreshold?: number;
}

/**
 * Jev block a host can pass to `memory.system({ classifier })`.
 */
export function createSystemOneMemoryDecision(
  options: SystemOneMemoryDecisionOptions = {},
): BlockDefinition<typeof memoryDecisionInputSchema, typeof memoryDecisionOutputSchema> {
  const storeThreshold = options.storeThreshold ?? 0.5;

  return handler({
    name: options.name ?? "system-one-memory-decision",
    inputSchema: memoryDecisionInputSchema,
    outputSchema: memoryDecisionOutputSchema,
    execute: async (input): Promise<MemoryDecisionOutput> => {
      const result = await runEvaluate({
        state: asTypeSafeState(input.text),
        questions: {
          [MEMORY_STORE_QUESTION]: boolean(
            "Should this be stored as a memory, or discarded?",
            {
              true: "This is a durable fact, preference, or identity detail worth keeping.",
              false: "This is transient chatter, a one-off task, or nothing new.",
            },
          ),
          [MEMORY_SALIENCE_QUESTION]: score(
            "How important is this if stored?",
            ["trivial", "useful", "critical"],
          ),
          [MEMORY_KIND_QUESTION]: choice(
            "What kind of memory is this?",
            {
              identity: "Who someone is — name, role, place.",
              preference: "A stated like, dislike, or style choice.",
              task: "Something the user asked to do this session.",
              [MEMORY_KIND_NONE]: "Do not tag — nothing to store.",
            },
          ),
        },
        client: options.client,
        apiKey: options.apiKey,
        model: options.model,
      });

      const storeAnswer = result.answers[MEMORY_STORE_QUESTION];
      const salienceAnswer = result.answers[MEMORY_SALIENCE_QUESTION];
      const kindAnswer = result.answers[MEMORY_KIND_QUESTION];

      const storeScore = truthProbability(storeAnswer) ?? 0;
      const store = storeScore >= storeThreshold;
      const salience = isScoreAnswer(salienceAnswer)
        ? Math.min(1, Math.max(0, salienceAnswer.score / 2))
        : null;
      const kind =
        isChoiceAnswer(kindAnswer) && kindAnswer.choice !== MEMORY_KIND_NONE
          ? kindAnswer.choice
          : null;

      return {
        store,
        salience: store ? salience : null,
        kind: store ? kind : null,
      };
    },
  });
}
