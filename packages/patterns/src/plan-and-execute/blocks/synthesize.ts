/**
 * `synthesize` — final step in the plan-and-execute pipeline.
 *
 * After the replan loop exits, the request-scoped TaskCollection holds
 * the finished work. `synthesize`:
 *
 *   1. Emits a `task-board-meta` `status: "synthesizing"` extension
 *      (via `boardMetaSynthesizing`).
 *   2. Builds the legacy P&E output shape — `{ goal, status, tasks,
 *      completedSteps, totalSteps }` — from the collection.
 *   3. When a synthesizer block is configured, feeds that legacy shape
 *      to it; otherwise returns the shape directly (the
 *      `synthesizer: false` short-circuit).
 *
 * Status translation back to legacy strings is centralised in
 * `normalizeOutputStatus` so the public output shape stays compatible
 * with pre-migration consumers.
 */
import { sequencer, handler } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import { getOrCreateTaskCollection, type Task } from "@flow-state-dev/tasks";
import { TASK_BOARD_META_COMPONENT_TYPE } from "../../task-board/blocks/board-meta";
import { planAndExecuteStateSchema } from "../schemas";

/**
 * Translate a substrate `Task` to its legacy P&E status string.
 *
 * The substrate uses `pending | in_progress | completed | errored |
 * cancelled | blocked | awaiting_review`. The legacy P&E vocabulary
 * — what external consumers depend on — is `pending | in-progress |
 * completed | failed | skipped`. The mapping:
 *
 *   - `errored`       → `failed`
 *   - `cancelled` w/ `"skipped"` label → `skipped`
 *   - `cancelled` (no skipped label)   → `skipped` (treated as cascade-skip)
 *   - `in_progress`   → `in-progress`
 *   - everything else → pass through (`pending`, `completed`)
 */
export function normalizeOutputStatus(t: Task): string {
  if (t.status === "errored") return "failed";
  if (t.status === "cancelled") return "skipped";
  if (t.status === "in_progress") return "in-progress";
  return t.status;
}

/**
 * Build the legacy `{ goal, status, tasks, completedSteps, totalSteps }`
 * output shape from the request-scoped collection. Wired both as a
 * standalone return value (when `synthesizer: false`) and as the input
 * to a configured synthesizer.
 */
export function createBuildPlanOutput(options: { name: string }) {
  const { name } = options;
  const collectionId = name;

  return handler({
    name: `${name}-build-output`,
    inputSchema: z.unknown(),
    outputSchema: z.object({
      goal: z.string(),
      status: z.enum(["completed", "failed"]),
      tasks: z.array(
        z.object({
          id: z.string(),
          goal: z.string(),
          status: z.string(),
          result: z.unknown().optional(),
          error: z.string().optional(),
        }),
      ),
      completedSteps: z.number(),
      totalSteps: z.number(),
    }),
    sequencerStateSchema: planAndExecuteStateSchema,
    execute: async (_input, ctx) => {
      const collection = getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId,
      });
      const tasks = collection.list();
      const goal = (ctx.sequencer!.state.goal as string | undefined) ?? "";

      const legacyTasks = tasks.map((t) => ({
        id: t.id,
        goal: t.goal,
        status: normalizeOutputStatus(t),
        result: t.output,
        error: t.error ?? t.feedback,
      }));

      const completedSteps = legacyTasks.filter(
        (t) => t.status === "completed",
      ).length;

      // "failed" only when every non-skipped task ended in failure (or
      // the plan was empty and we never got anywhere). Mirrors the
      // pre-migration semantic where any successful step let the plan
      // status resolve to "completed".
      const overallStatus: "completed" | "failed" = (() => {
        if (legacyTasks.length === 0) return "completed";
        const nonSkipped = legacyTasks.filter((t) => t.status !== "skipped");
        if (nonSkipped.length === 0) return "failed";
        return nonSkipped.some((t) => t.status === "completed")
          ? "completed"
          : "failed";
      })();

      return {
        goal,
        status: overallStatus,
        tasks: legacyTasks,
        completedSteps,
        totalSteps: tasks.length,
      };
    },
  });
}

export interface CreateSynthesizeOptions {
  /** Pattern name. */
  name: string;
  /**
   * The configured synthesizer block, or `false` to disable LLM
   * synthesis and return the legacy plan object directly.
   */
  synthesizer: BlockDefinition<any, any> | false;
}

/**
 * Build the `synthesize` block.
 *
 * - `synthesizer: false` → just `buildPlanOutput`. Output is the legacy
 *   plan shape.
 * - synthesizer present → sequencer composing
 *   `boardMetaSynthesizing → buildPlanOutput → synthesizer`.
 */
export function createSynthesize(options: CreateSynthesizeOptions) {
  const { name, synthesizer } = options;
  const collectionId = name;
  const buildPlanOutput = createBuildPlanOutput({ name });

  if (synthesizer === false) return buildPlanOutput;

  const boardMetaSynthesizing = handler({
    name: `${name}-meta-synthesizing`,
    inputSchema: z.unknown(),
    sequencerStateSchema: planAndExecuteStateSchema,
    execute: async (_input, ctx) => {
      await ctx.sequencer!.patchState({ status: "synthesizing" });
      ctx.emitComponent(
        TASK_BOARD_META_COMPONENT_TYPE,
        { collectionId, status: "synthesizing" },
        { key: collectionId },
      );
    },
  });

  return sequencer({
    name: `${name}-synthesize`,
    stateSchema: planAndExecuteStateSchema,
  })
    .tap(boardMetaSynthesizing)
    .then(buildPlanOutput)
    .then(synthesizer);
}
