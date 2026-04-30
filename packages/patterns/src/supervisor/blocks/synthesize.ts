/**
 * `synthesize` — final step in the supervisor pipeline.
 *
 *   .tap(boardMetaSynthesizing)  — fire `task-board-meta` "synthesizing"
 *   .then(buildResults)          — `{ goal, results: <completed outputs> }`
 *   .then(synthesizer)           — produces the supervisor's final output
 *
 * BP-011 / BP-012 clean: synthesizer is composed as `.then(...)`,
 * `boardMetaSynthesizing` is `.tap()`-shaped (no return).
 */
import { sequencer, handler } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import { getOrCreateTaskCollection } from "@flow-state-dev/tasks";
import { TASK_BOARD_META_COMPONENT_TYPE } from "../../task-board/blocks/board-meta";
import { supervisorStateSchema } from "../schemas";

export interface CreateSynthesizeOptions {
  name: string;
  synthesizer: BlockDefinition<any, any>;
}

/** Build the synthesize sequencer. */
export function createSynthesize(options: CreateSynthesizeOptions) {
  const { name, synthesizer } = options;
  const collectionId = name;

  const boardMetaSynthesizing = handler({
    name: `${name}-meta-synthesizing`,
    inputSchema: z.unknown(),
    sequencerStateSchema: supervisorStateSchema,
    execute: async (_input, ctx) => {
      await ctx.sequencer!.patchState({ status: "synthesizing" });
      ctx.emitComponent(
        TASK_BOARD_META_COMPONENT_TYPE,
        { collectionId, status: "synthesizing" },
        { key: collectionId },
      );
    },
  });

  const buildResults = handler({
    name: `${name}-build-results`,
    inputSchema: z.unknown(),
    outputSchema: z.object({
      goal: z.string(),
      results: z.array(z.unknown()),
    }),
    sequencerStateSchema: supervisorStateSchema,
    execute: async (_input, ctx) => {
      const collection = getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId,
      });
      const goal = (ctx.sequencer!.state.goal as string | undefined) ?? "";
      const results = collection
        .list({ status: "completed" })
        .map((t) => t.output)
        .filter((o): o is unknown => o !== undefined);
      return { goal, results };
    },
  });

  // Latest task-board-meta wins per collectionId, so without a final
  // re-emit the renderer would stay on "synthesizing" forever after
  // the synthesizer returns. Re-emit `completed` with current counts so
  // the badge clears.
  const boardMetaFinal = handler({
    name: `${name}-meta-final`,
    inputSchema: z.unknown(),
    sequencerStateSchema: supervisorStateSchema,
    execute: async (_input, ctx) => {
      const collection = getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId,
      });
      const counts = {
        total: collection.list().length,
        completed: collection.count({ status: "completed" }),
        errored: collection.count({ status: "errored" }),
        cancelled: collection.count({ status: "cancelled" }),
        blocked: collection.count({ status: "blocked" }),
        awaiting_review: collection.count({ status: "awaiting_review" }),
        in_progress: collection.count({ status: "in_progress" }),
        pending: collection.count({ status: "pending" }),
      };
      await ctx.sequencer!.patchState({ status: "completed" });
      ctx.emitComponent(
        TASK_BOARD_META_COMPONENT_TYPE,
        { collectionId, status: "completed", counts },
        { key: collectionId },
      );
    },
  });

  return sequencer({
    name: `${name}-synthesize`,
    stateSchema: supervisorStateSchema,
  })
    .tap(boardMetaSynthesizing)
    .then(buildResults)
    .then(synthesizer)
    .tap(boardMetaFinal);
}
