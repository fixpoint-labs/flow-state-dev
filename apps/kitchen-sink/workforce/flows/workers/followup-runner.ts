/**
 * A worker kind that runs the rows a channel's board holds.
 *
 * The wiring is four things, and all four are here on purpose — a seat reaches
 * a board because it named one, never because it happened to be hired
 * alongside it:
 *
 *   1. `channelBoard("support.desk", "followups")` — the channel's id and the
 *      board's local name, the pair a `CHANNEL.md` declared. The ledger's own
 *      id is minted from that pair and is written in no file.
 *   2. the board declared as a flow resource, under its own `id`.
 *   3. `taskBoard({ collection })` over that same declaration.
 *   4. the board's drain exposed as an action.
 *
 * One seat runs this kind — `support.wren`. The team's four other seats are on
 * other kinds and see neither board, which is what "explicitly wired" buys:
 * the boards a seat can reach are the boards its kind named.
 *
 * The channel declares a second board, `escalations`, and nothing here names
 * it. That is deliberate, and the boot says so — see the app's README.
 */
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import type { DeclaredResourceEntry } from "@flow-state-dev/core/types";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import type { TaskWorker, TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";
import { channelBoard, workerConfigSchema } from "@flow-state-dev/workforce";
import { z } from "zod";

/**
 * The board this kind runs: the `followups` board held by the `support.desk`
 * channel.
 *
 * Two plain names, exactly as the `CHANNEL.md` wrote them. Rename either
 * folder and this pair stops resolving to the board the tree declares, which
 * is the cost of explicit wiring and the reason the boot warns about a board
 * nobody names.
 */
const followups = channelBoard("support.desk", "followups");

/**
 * The board, as a flow-level declaration keyed by its own minted id.
 *
 * Widened to the framework's own entry type on purpose: a computed key infers
 * a map so specific that the flow it lands on no longer satisfies the kinds
 * map `hireWorkforce` takes, which is a typing artefact rather than anything
 * about this board.
 */
const followupResources: Record<string, DeclaredResourceEntry> = {
  [followups.id]: followups,
};

/**
 * What a run of a followup leaves behind, so the work is visible somewhere
 * other than the board that asked for it.
 *
 * Org-scoped, because a followup belongs to the organization whose desk raised
 * it rather than to the session that happened to drain the board — the same
 * scope the board's own rows live in, so a note and its row are readable by
 * the same reader.
 */
export const followupNotes = defineResourceCollection({
  pattern: "support-followup-notes/*",
  scope: "org",
  stateSchema: z.object({
    /** The row's goal, as the desk filed it. */
    followup: z.string(),
    /** What the run did about it. */
    outcome: z.string(),
    /** Epoch milliseconds at write. */
    at: z.number(),
  }),
});

/**
 * The body one row runs through.
 *
 * It records a note and returns what it did. The note is the point: a board
 * reports "1 task completed" whether or not anything happened, so the evidence
 * that a followup ran has to sit outside the board.
 */
const runFollowup = handler({
  name: "followup-runner-run",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ noted: z.string() }),
  // Declared on the body rather than on the kind: writing the note is this
  // block's own effect, and a resource declared here still reaches the hired
  // instance.
  resources: { notes: followupNotes },
  execute: async (input: TaskWorkerInput, ctx) => {
    const outcome = `closed by ${ctx.session.identity.id}`;
    await ctx.resources.notes.upsert(input.taskId, {
      followup: input.goal,
      outcome,
      at: Date.now(),
    });
    return { noted: outcome };
  },
}) as TaskWorker;

const board = taskBoard({
  name: "support-followups",
  boardId: "support-followups",
  collection: followups,
  concurrency: 1,
  // Keyed by the row's assignee. A row filed for somebody this map does not
  // name is not this seat's to run.
  workers: { "followup-runner": runFollowup },
});

export default defineFlow({
  kind: "followup-runner",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  // Declared under the board's own minted id, never a string typed here: the
  // id is the framework's and reading it off the declaration is what keeps it
  // out of this tree.
  resources: followupResources,
  actions: {
    drain: {
      block: board.drain,
      description: "Claim and run every followup row waiting on the support desk's board.",
    },
  },
});
