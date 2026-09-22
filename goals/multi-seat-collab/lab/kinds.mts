/**
 * The lab's two kinds — `planner` files, `worker` drains. The framework has no
 * opinion about either; both are this lab's.
 *
 * Every shape here is taken from a shipped sibling rather than invented:
 *
 * - the planner's one dispatch into the channel's own `fileTask` door is
 *   `goals/channel-boards/it-runs-a-row-a-file-declared-board-holds`' `em`
 *   kind;
 * - the worker's same-flow hand-off with a desk-narrowed claim is
 *   `goals/manager-queue-lab/lab/workforce/flows/workers/builder.mts`.
 *
 * What is new here is the one thing this proof is about: a row that stops to
 * ask a person, and a row that, in finishing, files the next one for another
 * desk.
 *
 * ## The routing map is an argument, never the tree
 *
 * `routes` (desk key -> seat id) is the app's. The worker's claim reads it and
 * nothing else; the worker's own `answersFor` line arrives in the seat's config
 * bag and is only ever *reported* back out, from inside the running row, so a
 * check can grade the row against the file of the seat that actually ran it.
 * Grading the map against itself would put the tree on both sides of routing
 * and the leg could not fail however badly a row was routed — the defect
 * `manager-queue-lab`'s README records shipping and fixing.
 *
 * ## The park condition is the one line that is not free
 *
 * A resumed attempt is handed the same `input` that asked the question. A body
 * that decides to park by looking at *what it was asked* therefore parks again
 * forever. What changed is the **answer**, which the unpark wrote onto the row
 * as its `feedback` — so the body reads the row and parks only while no answer
 * is on it. `GOAL_CONTROL=ignore-the-answer` swaps that one decision for the
 * wrong one.
 */

import { defineFlow, dispatcher, handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import type {
  TaskCollectionRef,
  TaskDispatcher,
  TaskWorkerInput,
} from "@flow-state-dev/orchestration/tasks";
import {
  CHANNEL_KIND,
  workerConfigSchema,
  type ChannelBoardCollection,
} from "@flow-state-dev/workforce";
import { appendFileSync } from "node:fs";
import { z } from "zod";

/** The kind every worker `WORKER.md` names in its `flow:` line. */
export const WORKER_KIND = "worker";
/** The kind the planner's `WORKER.md` names. */
export const PLANNER_KIND = "planner";

/** A worker seat's drain: work this seat's share of the board. */
export const DRAIN_ENTRY = "drain";
/** The person's door on a worker seat — answer a parked row and drain it. */
export const ANSWER_ENTRY = "answer";
/** The planner's one action. */
export const FILE_ENTRY = "file";
/** The task entry the same-flow hand-off addresses. Reachable only through the claim gate. */
export const WORK_ENTRY = "work";

/**
 * The worker-body perturbations, and only those. The routing-map controls
 * (`swapped-desks`, `one-seat`) are the host's, because the map is.
 *
 * - `ignore-the-answer` — the body decides to park on the question in its
 *   input, not on whether the row carries an answer. The answered row re-parks
 *   and never finishes (BR-7a).
 * - `silent-park` — the body parks with no reason at all. Every headless leg
 *   still passes; only the screen that should show *why* goes red (BR-11).
 */
export type WorkerControl = "ignore-the-answer" | "silent-park";

/** One unit of work, as the planner files it and the row carries it. */
export const pieceInputSchema = z.object({
  /** What only a person can settle before this row can finish. */
  asks: z.string().min(1).optional(),
  /** The work this row implies for another desk, filed by whoever finishes it. */
  then: z.object({ goal: z.string().min(1), desk: z.string().min(1) }).optional(),
  /** On a row filed by a finishing seat: the row it follows. */
  follows: z.string().min(1).optional(),
});

export type PieceInput = z.infer<typeof pieceInputSchema>;

/**
 * One line the work leaves behind — a real file, outside the board entirely.
 *
 * The board reports a completion on the very path under test, so execution is
 * proved here instead. Everything in a line is something only the running row
 * could know: which seat it is, what that seat's own file says, which session
 * it woke in, and what the ledger said about the claim it runs under.
 */
export const workLineSchema = z.object({
  event: z.enum(["parked", "finished"]),
  /** The seat instance that ran it, off `ctx.flow.id`. */
  seat: z.string(),
  /** What that seat's OWN FILE says it answers for — the oracle, from the tree. */
  declaredDesk: z.string(),
  taskId: z.string(),
  goal: z.string(),
  /** The child session this attempt ran in. */
  session: z.string(),
  /** The session that CLAIMED the row, as the ledger recorded it. */
  claimedBySession: z.string().nullable(),
  /** The request that claimed it — for an answered row, the answering request. */
  claimedByRequest: z.string().nullable(),
  /** The answer on the row when this attempt ran, if any. */
  answer: z.string().nullable(),
  /** On `finished`: the row this seat filed for the next desk. */
  filed: z.string().nullable(),
  /** On `finished`: what the ledger said when this seat tried to move its own row's assignee. */
  reassign: z.object({ outcome: z.string(), reason: z.string().nullable() }).nullable(),
});

export type WorkLine = z.infer<typeof workLineSchema>;

/**
 * A claim narrowed to the desks the APP routes to this seat.
 *
 * Resolved per seat at claim time off `ctx.flow.id`, because every worker seat
 * shares one kind and therefore one board object.
 *
 * The eligibility is the desk **or no assignee at all**. The second arm is
 * deliberate: the lab declares no `defaultWorker`, so a row filed for nobody
 * has to be *taken* somewhere before the keyed router can refuse it by name
 * (BR-5). Drop it and that row sits `pending` in silence. There is no status
 * arm — claimability is the substrate's call.
 *
 * A seat the map routes nothing to claims nothing, rather than falling back to
 * a bare claim that would eat another desk's rows.
 */
function deskDispatcher(routes: Readonly<Record<string, string>>): TaskDispatcher {
  return {
    async claim(collection, workerId, ctx) {
      const seat = String((ctx.flow as { id?: string }).id ?? "");
      const desks = new Set(
        Object.entries(routes)
          .filter(([, routedSeat]) => routedSeat === seat)
          .map(([desk]) => desk),
      );
      if (desks.size === 0) return null;
      return collection.claim(workerId, {
        eligibility: (task) => task.assignee === undefined || desks.has(task.assignee),
      });
    },
  };
}

export interface WorkerFlowOptions {
  /** The channel's own ledger — the one `CHANNEL.md` declared by name. */
  board: ChannelBoardCollection;
  /**
   * Desk key -> seat id: **the routing under test**, and the app's.
   *
   * Its keys are also the board's desk vocabulary — which keys have a body.
   */
  routes: Readonly<Record<string, string>>;
  /** Where each attempt leaves its line. */
  outbox: string;
  /** A worker-body perturbation, or none. */
  control?: WorkerControl;
}

/**
 * Build the `worker` kind. Every worker seat is hired onto this one factory.
 *
 * @returns The flow factory `hireWorkforce` mints one copy of per worker record.
 */
export function defineWorkerFlow(options: WorkerFlowOptions) {
  const { board: ledger, routes, outbox, control } = options;

  /** The board's name, which is also its capability's key on `ctx.cap`. */
  const BOARD_NAME = `${WORKER_KIND}-desk-board`;

  const board = taskBoard({
    name: BOARD_NAME,
    boardId: BOARD_NAME,
    collection: ledger,
    concurrency: 1,
    dispatcher: deskDispatcher(routes),
    // A parked row is not this drain's to wait on: the drain returns, the row
    // stays parked and durable, and `unparkAndDrain` is the return trip.
    onReview: "exit",
    maxIterations: 200,
    idlePollMs: 25,
    // One hand-off per desk key. A row whose assignee is not among them —
    // including one with no assignee — misses the router and is refused by
    // name. No `defaultWorker`: a floor would make that refusal quiet.
    workers: Object.fromEntries(
      Object.keys(routes).map((desk) => [
        desk,
        dispatcher<TaskWorkerInput>({
          name: `${WORKER_KIND}-hand-off-${desk}`,
          action: WORK_ENTRY,
          session: "per-task",
        }),
      ]),
    ),
  });


  /**
   * One attempt at one row. Parks while the row carries no answer; otherwise
   * does the work, files the next desk's row naming this one, and returns.
   */
  const runRow = handler({
    name: "worker-run-row",
    // Through the board's own capability, so every write below is
    // board-mediated and carries the board's policy — including the frozen
    // assignee a board that hands rows off imposes on its ledger. A ref built
    // by hand over the raw resource would skip it.
    uses: [board.capability],
    inputSchema: taskWorkerInputSchema,
    outputSchema: workLineSchema,
    execute: async (input: TaskWorkerInput, ctx: BlockContext): Promise<WorkLine> => {
      const tasks: TaskCollectionRef = await (
        ctx.cap as unknown as Record<string, { tasks(): Promise<TaskCollectionRef> }>
      )[BOARD_NAME]!.tasks();
      const row = tasks.get(input.taskId);
      if (row === undefined) {
        throw new Error(`row ${input.taskId} is not on the "${ledger.id}" ledger`);
      }
      const piece = pieceInputSchema.parse(input.input ?? {});
      const answer = row.feedback ?? null;
      const base = {
        seat: String((ctx.flow as { id?: string }).id ?? "<unknown>"),
        declaredDesk: String((ctx.flow.config as { answersFor?: unknown }).answersFor),
        taskId: input.taskId,
        goal: input.goal,
        session: String(ctx.session.identity.id),
        claimedBySession: row.claimedBy?.sessionId ?? null,
        claimedByRequest: row.claimedBy?.requestId ?? null,
        answer,
      };

      // THE DECISION. Park while nothing has answered the question. The wrong
      // version — park whenever there is a question — is the control.
      const mustAsk =
        piece.asks !== undefined &&
        (control === "ignore-the-answer" ? true : answer === null);

      if (mustAsk) {
        const line: WorkLine = { event: "parked", ...base, filed: null, reassign: null };
        appendFileSync(outbox, `${JSON.stringify(line)}\n`, "utf8");
        // The seat that owns the row parks it. Nobody drains on the person's
        // behalf; the person answers through an action (ER-1).
        await tasks.awaitReview(input.taskId, control === "silent-park" ? undefined : piece.asks);
        return line;
      }

      // The work implies another desk's: file that row, naming this one. One
      // board, a second row, a second assignee — that is the handoff (D2).
      let filed: string | null = null;
      let reassign: WorkLine["reassign"] = null;
      if (piece.then !== undefined) {
        const next = await tasks.addTask({
          goal: piece.then.goal,
          assignee: piece.then.desk,
          input: { follows: input.taskId },
        });
        filed = next.id;
        // The tempting shortcut — hand THIS row over by moving its assignee —
        // is tried and its answer recorded, so a board that ever permitted it
        // is caught (BR-14). Nothing below depends on it succeeding.
        const moved = await tasks.setAssignee(input.taskId, piece.then.desk);
        reassign = {
          outcome: moved.outcome,
          reason: moved.outcome === "declined" ? String(moved.reason) : null,
        };
      }
      const line: WorkLine = { event: "finished", ...base, filed, reassign };
      appendFileSync(outbox, `${JSON.stringify(line)}\n`, "utf8");
      return line;
    },
  });

  return defineFlow({
    kind: WORKER_KIND,
    cardinality: "collection",
    configSchema: workerConfigSchema().extend({ answersFor: z.string().min(1) }),
    actions: {
      [DRAIN_ENTRY]: {
        block: board.drain,
        description: "Work this seat's share of the channel's board.",
      },
      // The person's door. An ordinary action on an ordinary session, so it
      // carries the request's own principal and nothing derives a second one.
      [ANSWER_ENTRY]: {
        block: board.unparkAndDrain,
        description: "Answer a parked row this seat owns, and put it back to work.",
      },
    },
    task: { actions: { [WORK_ENTRY]: { block: runRow } } },
  } as never);
}

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
