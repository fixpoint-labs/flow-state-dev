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
import { supervisorStateSchema } from "../schemas";

export interface CreateSynthesizeOptions {
  name: string;
  synthesizer: BlockDefinition<any, any>;
}

/** Build the synthesize sequencer. */
export function createSynthesize(options: CreateSynthesizeOptions) {
  const { name, synthesizer } = options;
  const collectionId = name;

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

  // No phase-meta emissions here. Both a `synthesizing` mark and a
  // post-synthesizer `completed` re-emit would keep the same `key:
  // collectionId`, and the chat-thread renderer mounts `<TaskPlan />`
  // at the position of the latest task-board-meta — so emitting them
  // would drag the board mount past the synthesizer's streamed output
  // and back. The substrate's own `boardMetaCompleted` (fired during
  // board drain) is the canonical anchor.
  return sequencer({
    name: `${name}-synthesize`,
    stateSchema: supervisorStateSchema,
  })
    .then(buildResults)
    .then(synthesizer);
}
