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
    // FIX-480 §3.3: `resultItems` exposes per-task emission slices so the
    // synthesizer's user prompt can pick `source` / `tool_call` / `message`
    // items directly. Field stays optional in the synthesizer-input
    // contract — user-supplied synthesizers ignoring it keep working.
    outputSchema: z.object({
      goal: z.string(),
      results: z.array(z.unknown()),
      resultItems: z
        .array(
          z.object({
            taskId: z.string(),
            goal: z.string(),
            items: z.array(z.unknown()),
          }),
        )
        .optional(),
    }),
    sequencerStateSchema: supervisorStateSchema,
    execute: async (_input, ctx) => {
      const collection = getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId,
      });
      const goal = ctx.sequencer!.state.goal ?? "";
      const completed = collection.list({ status: "completed" });
      const results = completed
        .map((t) => t.output)
        .filter((o): o is unknown => o !== undefined);
      const resultItems = completed.map((t) => ({
        taskId: t.id,
        goal: t.goal,
        items: [...t.items()],
      }));
      return { goal, results, resultItems };
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
    activeStatusMessage: "Putting it all together",
  })
    .then(buildResults)
    .then(synthesizer);
}
