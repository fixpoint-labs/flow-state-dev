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

/**
 * The action a **channel post** reaches — the front door of the third check.
 *
 * Separate from {@link FILE_ENTRY} rather than a widened input on it, because
 * the two have genuinely different inputs: `file` is handed a row, and this is
 * handed a line somebody wrote. Collapsing them would mean either a schema that
 * accepts both shapes and validates neither, or a direct action call wearing a
 * post's clothes — and "the row is filed in answer to a post, not by calling
 * the EM's action directly" is precisely what the channel leg is a proof of.
 */
export const POST_ENTRY = "onPost";

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

/**
 * What one channel delivery carries — exactly the fields the notify block's
 * dispatcher builds, and nothing a poster could widen.
 */
export const postInputSchema = z
  .object({
    /** The channel the line was posted on. */
    channelId: z.string().min(1),
    /** The declared member this delivery was addressed to. */
    member: z.string().min(1),
    /** The line somebody wrote. */
    body: z.string().min(1),
  })
  .strict();

/**
 * The shape a post has to be in for the EM to file from it:
 * `<issue-slug>: <what the feature is>`.
 *
 * Deterministic parsing, not a model. The EM's opinion under test is *that it
 * names no harness* and *that a post is what starts the work* — neither is a
 * judgement, and a model here would double the lab's model surface for a claim
 * that is structural. A line that does not match files nothing and says so,
 * which is the shape BR-9's "the board does not start itself" lives in.
 */
const POST_SHAPE = /^\s*([a-z0-9][a-z0-9-]*)\s*:\s*(\S.*)$/;

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
  /**
   * Put one row on the board, idempotently.
   *
   * Shared by the two doors below rather than written twice: what a row IS does
   * not depend on whether a caller handed it over or somebody posted a line,
   * and two copies of this is how the posted door comes to file a subtly
   * different row than the direct one.
   */
  const addRow = async (
    tasks: any,
    input: { issue: string; goal: string; maxAttempts: number },
  ): Promise<{ taskId: string; existed: boolean }> => {
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
  };

  const fileRow = handler({
    name: "devforce-em-file-row",
    inputSchema: fileInputSchema,
    outputSchema: z.object({ taskId: z.string(), existed: z.boolean() }),
    uses: [board.capability],
    execute: async (input: z.infer<typeof fileInputSchema>, ctx: BlockContext) =>
      await addRow((ctx as { cap: Record<string, any> }).cap[BOARD_ID], input),
  });

  /**
   * File in answer to a line somebody posted on the feature channel.
   *
   * The `member` the delivery names is **not** read as an authority to file:
   * this action is only reachable by a dispatch the notify block addressed to
   * this seat, so the authority is the address map, which is the app's and not
   * caller-controllable (BP-031). The field is carried for the record.
   */
  const fileFromPost = handler({
    name: "devforce-em-file-from-post",
    inputSchema: postInputSchema,
    outputSchema: z.object({
      filed: z.boolean(),
      taskId: z.string().nullable(),
      /** Why nothing was filed. Absent when a row was. */
      reason: z.string().optional(),
    }),
    uses: [board.capability],
    execute: async (input: z.infer<typeof postInputSchema>, ctx: BlockContext) => {
      const match = POST_SHAPE.exec(input.body);
      if (match === null) {
        return {
          filed: false,
          taskId: null,
          reason:
            `the line does not name a feature; this channel files from ` +
            `"<issue-slug>: <what the feature is>"`,
        };
      }
      const filed = await addRow((ctx as { cap: Record<string, any> }).cap[BOARD_ID], {
        issue: match[1]!,
        goal: match[2]!.trim(),
        maxAttempts: fileInputSchema.shape.maxAttempts.parse(undefined),
      });
      return { filed: !filed.existed, taskId: filed.taskId };
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
    internal: {
      actions: {
        // **`internal`, not `actions`, and this is the framework's rule rather
        // than a preference.** A channel's fan-out reaches a seat through an
        // `internal` dispatch, which resolves `flow.internal.actions[action]`
        // and never falls through to the public map — so a public declaration
        // here is refused `no-entry` by name and the post files nothing.
        //
        // It is also where this belongs. The authority to turn a line into a
        // row is the notify block's address map, which is the app's; a caller
        // that could reach this action directly would be filing rows without
        // ever posting, which is the thing the channel leg exists to prove is
        // not how work starts.
        [POST_ENTRY]: { block: fileFromPost, inputSchema: postInputSchema },
      },
    },
  } as never);
}
