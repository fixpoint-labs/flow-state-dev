/**
 * The `planner` kind — one file under `workforce/flows/workers/`, basename =
 * the kind id the planner's `WORKER.md` names in its `flow:` line.
 *
 * One action, a dispatch into the mailbox's own `fileTask` door, taken from
 * `goals/mailbox-boards/it-runs-a-row-a-file-declared-board-holds`' `em` kind.
 * No board, no collection, no drain.
 */

import { defineFlow, dispatcher } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { MAILBOX_KIND, workerConfigSchema, type WorkerInstallation } from "@flow-state-dev/workforce";
import { WORKER_ID_STATE_KEY } from "@flow-state-dev/workforce/browser";
import { z } from "zod";
import type { PieceInput } from "../piece.mts";
import { hearingDoor } from "../../../../hearing-door.mts";

/** The kind the planner's `WORKER.md` names in its `flow:` line. **Pinned** — the basename must match. */
export const PLANNER_KIND = "planner";

/** The planner's one action. */
export const FILE_ENTRY = "file";

export interface PlannerFlowOptions {
  /** The installation whose workers run on this kind. */
  installation: WorkerInstallation;
  /** The mailbox's id — the session its `fileTask` door runs in. */
  mailboxId: string;
  /** The board's LOCAL name, as `MAILBOX.md` wrote it. */
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
 * Build the `planner` kind: one dispatch into the mailbox's own `fileTask`.
 * No board, no collection, no drain.
 */
export function definePlannerFlow(options: PlannerFlowOptions) {
  return defineFlow({
    kind: PLANNER_KIND,
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    session: options.installation.session(),
    resources: { ...options.installation.resources },
    actions: {
      ...hearingDoor,
      [FILE_ENTRY]: {
        block: dispatcher({
          name: "planner-file-row",
          flowKind: MAILBOX_KIND,
          action: "fileTask",
          inputSchema: fileInputSchema,
          session: { id: () => options.mailboxId },
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
              // The worker the session names, which its create check confirmed.
              author: String((ctx.session.state as Record<string, unknown>)[WORKER_ID_STATE_KEY] ?? ""),
            };
          },
        }),
        description: "File one row onto the mailbox's board, naming the desk it is for.",
      },
    },
  } as never);
}
