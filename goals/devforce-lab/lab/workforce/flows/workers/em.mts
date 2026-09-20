/**
 * The `em` worker kind — one file under `workforce/flows/workers/`, basename =
 * the kind id every coordinating `WORKER.md` names in its `flow:` line.
 *
 * **This kind declares no harness slot, and that is the point.** "The EM seat
 * does no harness work" is a locked DevForce opinion, and it is graded on the
 * kind rather than on behaviour: there is no `task:` entry here and no option
 * through which one could be installed, so the seat cannot run a coding harness
 * — not merely "it happened not to". Search this file for the word harness and
 * the only hits are in this paragraph.
 *
 * What it does have is the feature board, and the board's `coder` worker is a
 * dispatcher naming another flow instance. That one line is D1: the row is
 * handed across flows to the seat a Markdown file declared, rather than to a
 * task entry co-located on this flow.
 *
 * Nothing under `flows/` is read as a convention file — the loader walks
 * `workers/`, `skills/`, `resources/` and `channels/` and ignores the rest
 * (BR-16), which is why the code side of the fence can sit inside the tree.
 */

import { defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import { harnessTaskId } from "@flow-state-dev/harness-manager/checkout";
import { PHASE } from "../../../phase.mts";
import {
  ASSIGNEE,
  BOARD_ID,
  coordinatorBoard,
  featureLedger,
  type FeatureRow,
} from "../../../board.mts";
import {
  INSPECT_ENTRY,
  readOwnFacts,
  seatSettingsSchema,
} from "../../../seat-config.mts";

/** The kind id the coordinating `WORKER.md` names. **Pinned** — the basename must match. */
export const EM_KIND = "em";

/** The action that turns one feature into one row. */
export const FILE_ENTRY = "file";

/** The action that runs the board. */
export const DRAIN_ENTRY = "drain";

/**
 * What filing one feature takes.
 *
 * `phase` is not an input: this board runs one phase, and letting a caller pick
 * one would let a row be filed that the recipient's manager then refuses after
 * the checkout has been cut.
 */
export const fileInputSchema = z.object({
  /** The row's identity, and the leaf of every path derived from it. */
  issue: z.string().min(1),
  /** What the row is, in a sentence. */
  goal: z.string().min(1),
  /**
   * How many attempts the row gets.
   *
   * Stated, because the substrate is single-attempt without it: a reported
   * failure would then cost an attempt and deliver nothing, and BR-14's "back
   * to pending, then errored once the budget is spent" would have no budget to
   * spend.
   */
  maxAttempts: z.number().int().min(1).default(2),
});

export interface EmWorkerFlowOptions {
  /**
   * The hired `coder` seat's instance id — where a claimed row is handed.
   *
   * Passed in rather than named here because the host derives it from the tree:
   * no file, and no seat, is named in this lab's code.
   */
  coderSeatId: string;
  /** The file-declared documents, as `resourcesFromDocs` built them. */
  resources: Record<string, unknown>;
}

/**
 * Build the coordinator kind.
 *
 * @param options The coder seat's address and the documents to install.
 * @returns The flow factory `hireWorkforce` mints one copy of per EM record.
 */
export function defineEmWorkerFlow(options: EmWorkerFlowOptions) {
  const collection = featureLedger();
  const board = coordinatorBoard({ collection, coderSeatId: options.coderSeatId });

  /**
   * File one row, addressed to the board's `coder` assignee.
   *
   * Deterministic, deliberately: the EM's opinion is *that it names no
   * harness*, not that it reasons well, so giving it a model would double this
   * lab's model surface for a claim that is structural.
   *
   * Idempotent per issue-phase — the row id is derived from the payload, so a
   * second filing returns the existing row rather than charging a second coding
   * run for one feature.
   */
  const fileRow = handler({
    name: "devforce-em-file-row",
    inputSchema: fileInputSchema,
    outputSchema: z.object({ taskId: z.string(), existed: z.boolean() }),
    uses: [board.capability],
    execute: async (input: z.infer<typeof fileInputSchema>, ctx: BlockContext) => {
      const tasks = (ctx as { cap: Record<string, any> }).cap[BOARD_ID];

      // **The row id is the issue-phase, not a fresh mint, and not the issue.**
      // The manager derives the checkout, the branch and the run record from the
      // row's typed payload and refuses a row whose id does not match that
      // derivation — because a second row under a different id would run the
      // same work in the same tree. The refusal is the framework's, and it
      // arrives on the recipient after the hand-off, so getting this right here
      // is what keeps the row from erroring on arrival.
      const taskId = harnessTaskId(input.issue, PHASE);
      const existing = await tasks.getTask(taskId);
      if (existing !== undefined) return { taskId, existed: true };

      const row: FeatureRow = {
        id: taskId,
        goal: input.goal,
        // The TYPED payload, never `metadata`: the checkout path and the branch
        // are derived from these two fields, and `metadata` is patchable.
        input: { issue: input.issue, phase: PHASE },
      };
      await tasks.addTask({ ...row, assignee: ASSIGNEE, maxAttempts: input.maxAttempts });
      return { taskId, existed: false };
    },
  });

  return defineFlow({
    kind: EM_KIND,
    // One copy per worker record, each addressed by its own id.
    cardinality: "collection",
    configSchema: seatSettingsSchema(),
    resources: options.resources,
    actions: {
      [FILE_ENTRY]: { block: fileRow, description: "File one feature as a row on the board." },
      [DRAIN_ENTRY]: { block: board.drain, description: "Run the board until it is idle." },
      [INSPECT_ENTRY]: {
        block: readOwnFacts,
        description: "Read what this seat can see of its own configuration. Writes nothing.",
      },
    },
  } as never);
}
