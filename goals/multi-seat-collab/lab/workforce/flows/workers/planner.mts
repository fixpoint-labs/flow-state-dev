/**
 * The `planner` kind — one file under `workforce/flows/workers/`, basename =
 * the kind id the planner's `WORKER.md` names in its `flow:` line.
 *
 * One action, a dispatch into the channel's own `fileTask` door, taken from
 * `goals/channel-boards/it-runs-a-row-a-file-declared-board-holds`' `em` kind.
 * No board, no collection, no drain.
 */

import { defineFlow, dispatcher } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { CHANNEL_KIND, workerConfigSchema } from "@flow-state-dev/workforce";
import { z } from "zod";
import type { PieceInput } from "../piece.mts";

/** The kind the planner's `WORKER.md` names in its `flow:` line. **Pinned** — the basename must match. */
export const PLANNER_KIND = "planner";

/** The planner's one action. */
export const FILE_ENTRY = "file";

export interface PlannerFlowOptions {
  /** The channel's id — the session its `fileTask` door runs in. */
  channelId: string;
  /** The board's LOCAL name, as `CHANNEL.md` wrote it. */
  boardName: string;
}

/** What the planner's `file` takes: one piece of work, and the desk it is for. */
export const fileInputSchema = z.object({
  goal: z.string().min(1),
  /** A desk key. Omitted on purpose to file a row for nobody (BR-5). */
  desk: z.string().min(1).optional(),
  asks: z.string().min(1).optional(),
  then: z.object({ goal: z.string().min(1), desk: z.string().min(1) }).optional(),
  maxAttempts: z.number().int().min(1).optional(),
});

export type FileInput = z.infer<typeof fileInputSchema>;

/**
 * Build the `planner` kind: one dispatch into the channel's own `fileTask`.
 * No board, no collection, no drain.
 */
export function definePlannerFlow(options: PlannerFlowOptions) {
  return defineFlow({
    kind: PLANNER_KIND,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    actions: {
      [FILE_ENTRY]: {
        block: dispatcher({
          name: "planner-file-row",
          flowKind: CHANNEL_KIND,
          action: "fileTask",
          inputSchema: fileInputSchema,
          session: { id: () => options.channelId },
          payload: (input: FileInput, ctx: BlockContext) => {
            const piece: PieceInput = {
              ...(input.asks === undefined ? {} : { asks: input.asks }),
              ...(input.then === undefined ? {} : { then: input.then }),
            };
            return {
              board: options.boardName,
              goal: input.goal,
              ...(input.desk === undefined ? {} : { assignee: input.desk }),
              ...(input.maxAttempts === undefined ? {} : { maxAttempts: input.maxAttempts }),
              ...(Object.keys(piece).length === 0 ? {} : { input: piece }),
              author: String((ctx.flow as { id?: string }).id ?? ""),
            };
          },
        }),
        description: "File one row onto the channel's board, naming the desk it is for.",
      },
    },
  } as never);
}
