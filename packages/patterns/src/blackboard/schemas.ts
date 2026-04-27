import { defineResource } from "@flow-state-dev/core";
import { z, type ZodTypeAny } from "zod";

// ---------------------------------------------------------------------------
// Blackboard Resource Factory
// ---------------------------------------------------------------------------

/**
 * Creates a blackboard resource definition — a thin wrapper around
 * `defineResource()` with `writable: true`. The user provides the full
 * schema for their blackboard state; the pattern imposes no structure.
 */
export function createBlackboard<TStateSchema extends ZodTypeAny>(
  stateSchema: TStateSchema
) {
  return defineResource({
    scope: "session",
    stateSchema,
    writable: true,
  });
}

// ---------------------------------------------------------------------------
// Sequencer Control State (loop metadata — NOT blackboard content)
// ---------------------------------------------------------------------------

export const blackboardControlSchema = z.object({
  iteration: z.number().default(0),
  currentSpecialist: z.string().optional(),
  done: z.boolean().default(false),
  history: z
    .array(
      z.object({
        iteration: z.number(),
        specialist: z.string(),
        reasoning: z.string(),
      })
    )
    .default([]),
});

export type BlackboardControlState = z.infer<typeof blackboardControlSchema>;

// ---------------------------------------------------------------------------
// Controller Output
// ---------------------------------------------------------------------------

export const controllerOutputSchema = z.object({
  specialist: z.string().nullable(),
  done: z.boolean(),
  reasoning: z.string(),
});

export type ControllerOutput = z.infer<typeof controllerOutputSchema>;
