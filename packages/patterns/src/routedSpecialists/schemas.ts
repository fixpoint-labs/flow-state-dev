/**
 * routedSpecialists schemas — control state, controller decision shape,
 * and workspace-resource factory.
 *
 * The pattern's per-iteration record lives in the unified TaskCollection
 * (each iteration is a `Task` whose `assignee` is the picked specialist
 * and whose `output` is the specialist's result). The sequencer-state
 * `tasks` slot below is the substrate's storage for that collection;
 * the loop-control fields (`iteration`, `currentSpecialist`, `done`)
 * are pattern-specific scratch.
 */
import { defineResource } from "@flow-state-dev/core";
import { z, type ZodTypeAny } from "zod";

/**
 * Creates a workspace resource — the shared writable surface specialists
 * read from and contribute to. Renamed from `createBlackboard`; same
 * semantics. The user supplies the full schema; the pattern imposes no
 * structure on the workspace contents.
 */
export function createWorkspace<TStateSchema extends ZodTypeAny>(
  stateSchema: TStateSchema
) {
  return defineResource({
    scope: "session",
    stateSchema,
    writable: true,
  });
}

const tasksRecordSchema: ZodTypeAny = z
  .record(z.string(), z.unknown())
  .default({});

/**
 * Sequencer control state for a routedSpecialists instance.
 *
 * `tasks` is the TaskCollection storage slot (per-iteration `Task`
 * records). `iteration`, `currentSpecialist`, and `done` are loop-
 * control flags written by the controller-record step.
 *
 * `currentAttempt` is the `attempts` value the record-iteration step's
 * own `claim` returned, carried so `recordCompletion` and `recordError`
 * can scope their write-back to that attempt. It must come from the
 * claim's return value, not from `addTask`'s: the claim is what
 * increments `attempts`, so the pre-claim task reads `0` where the
 * claimed one reads `1`, and stamping the wrong one would decline every
 * normal completion. Optional, so a run resumed from a checkpoint taken
 * before this field existed still completes its tasks.
 */
export const routedSpecialistsControlSchema: ZodTypeAny = z.object({
  iteration: z.number().default(0),
  currentSpecialist: z.string().optional(),
  currentTaskId: z.string().optional(),
  currentAttempt: z.number().optional(),
  done: z.boolean().default(false),
  tasks: tasksRecordSchema,
});

export type RoutedSpecialistsControlState = {
  iteration: number;
  currentSpecialist?: string;
  currentTaskId?: string;
  currentAttempt?: number;
  done: boolean;
  tasks: Record<string, unknown>;
};

/**
 * Controller decision shape — what the controller block must return.
 * `specialist` names a registered specialist when `done === false`; it
 * is `null` when `done === true`.
 */
export const controllerOutputSchema = z.object({
  specialist: z.string().nullable(),
  done: z.boolean(),
  reasoning: z.string(),
});

export type ControllerOutput = z.infer<typeof controllerOutputSchema>;
