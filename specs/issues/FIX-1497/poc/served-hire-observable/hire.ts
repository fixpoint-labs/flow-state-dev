/**
 * The hire, assembled once and imported by the four flow modules beside it.
 *
 * **Retained experiment, not production code.** It exists to answer one
 * question this spec rests on: can a hired Workforce — two worker seats and a
 * planner seat across one channel that declares a board — be served by the
 * shipped `fsdev dev`, so that the handoff is reachable in the DevTool without
 * anything written only to make the inspection possible?
 *
 * Every shape here is copied from a shipped lab rather than invented:
 * the same-flow hand-off with an assignee-narrowed claim is
 * `goals/manager-queue-lab/lab/workforce/flows/workers/builder.mts`; filing
 * through the channel's own door is
 * `goals/channel-boards/it-runs-a-row-a-file-declared-board-holds/run.mts`.
 *
 * No ledger id is written anywhere. `CHANNEL.md` declares a board by local
 * name; the framework mints the id from where the folder sits.
 */
// Relative into `packages/*/src`, following the precedent this repo's other
// retained POCs set (`specs/issues/FIX-1481/poc/what-the-tree-can-say/run.mts`):
// a spec folder is not a workspace package, so `@flow-state-dev/*` does not
// resolve from here. It is a limit of the experiment, not a boundary claim.
import { defineFlow, dispatcher, handler } from "../../../../../packages/core/src/index";
import type { BlockContext } from "../../../../../packages/core/src/types/index";
import {
  taskBoard,
  taskWorkerInputSchema,
} from "../../../../../packages/orchestration/src/task-board/index";
import type {
  TaskDispatcher,
  TaskWorkerInput,
} from "../../../../../packages/orchestration/src/tasks/index";
import {
  CHANNEL_KIND,
  channelBoard,
  channelBoardIds,
  channelInstances,
  hireWorkforce,
  workerConfigSchema,
} from "../../../../../packages/workforce/src/index";
import {
  readChannelsDirectory,
  readWorkforce,
} from "../../../../../packages/workforce/src/loader/index";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * The one path this module names. Everything else is walked out of the tree.
 *
 * The env override exists for the `no-tree` control and nothing else: pointing
 * it at a directory that is not there is how the catalog assertions are made to
 * go red without touching the check that makes them.
 */
const TREE = process.env.ER_COLLAB_POC_TREE ?? fileURLToPath(new URL("./workforce", import.meta.url));

/** Who the experiment runs as. One user, one org — the boundary D7 fixed. */
export const POC_USER_ID = "u_er_collab_poc";

const roster = await readWorkforce(TREE);
const channelsRead = await readChannelsDirectory(TREE);
if (roster.errors.length > 0 || channelsRead.errors.length > 0) {
  throw new Error(
    `the tree at ${TREE} did not load cleanly: ` +
      JSON.stringify([...roster.errors, ...channelsRead.errors]),
  );
}

export const channels = channelsRead.channels;
const channel = channels[0]!;
/** The board's LOCAL name, read off the file — never an id. */
export const BOARD_NAME = (channel.declared.boards as string[])[0]!;
export const CHANNEL_ID = channel.id;

/** The channel's ledger, addressed by the mint the framework made. */
const ledger = channelBoard(channel.id, BOARD_NAME);

/**
 * The desk keys the board routes by, read off each worker record's own file.
 *
 * A desk key is not a seat id, deliberately (ER-7): `build` is a routing key on
 * a row, `eng.builder` is a roster slot. The map below is what resolves one to
 * the other, and it is the app's, never the tree's.
 */
const workerRecords = roster.workers.filter(
  (record) => (record.declared as { flow?: string }).flow === "worker",
);
const DESKS = workerRecords.map(
  (record) => String((record.declared as { answersFor?: string }).answersFor),
);
/** seat instance id -> the desk it claims. */
const SEAT_DESKS: Record<string, string> = Object.fromEntries(
  workerRecords.map((record) => [
    record.id,
    String((record.declared as { answersFor?: string }).answersFor),
  ]),
);

/** A claim narrowed to one seat's desk, resolved per seat off `ctx.flow.id`. */
function deskDispatcher(): TaskDispatcher {
  return {
    async claim(collection, workerId, ctx) {
      const seat = String((ctx.flow as { id?: string }).id ?? "");
      const desk = SEAT_DESKS[seat];
      if (desk === undefined) return null;
      return collection.claim(workerId, {
        eligibility: (task) => task.assignee === desk,
      });
    },
  };
}

const workerSettings = () =>
  workerConfigSchema().extend({ answersFor: z.string().min(1) });

/**
 * The work a row becomes.
 *
 * `park: true` on the row's input is how the experiment reaches the one branch
 * that matters: the seat parks its own row with a reason rather than settling
 * it, which is what `awaitReview` is for and what the Reason column renders.
 */
const runRow = handler({
  name: "worker-run-row",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ seat: z.string(), session: z.string(), did: z.string() }),
  execute: async (input: TaskWorkerInput, ctx: BlockContext) => {
    const seat = String((ctx.flow as { id?: string }).id ?? "<unknown>");
    const session = String(ctx.session.identity.id);
    const asks = (input.input as { asks?: string } | undefined)?.asks;
    if (typeof asks === "string" && asks.length > 0) {
      // The seat that owns the row parks it. Nobody drains on the person's
      // behalf; the person answers through an action (ER-1).
      await input.tasks.awaitReview(asks);
    }
    return { seat, session, did: input.goal };
  },
});

const board = taskBoard({
  name: "er-collab-poc-board",
  boardId: "er-collab-poc-board",
  collection: ledger,
  concurrency: 1,
  dispatcher: deskDispatcher(),
  // Parked rows are excused from the drain's waitable count, so the drain
  // returns while the row stays parked and durable.
  onReview: "exit",
  maxIterations: 40,
  idlePollMs: 25,
  workers: Object.fromEntries(
    DESKS.map((desk) => [
      desk,
      dispatcher<TaskWorkerInput>({
        name: `worker-hand-off-${desk}`,
        action: "work",
        session: "per-task",
      }),
    ]),
  ),
});

const workerKind = defineFlow({
  kind: "worker",
  cardinality: "collection",
  configSchema: workerSettings(),
  resources: { [ledger.id]: ledger },
  actions: {
    drain: { block: board.drain, description: "Work this seat's share of the board." },
    // The person's door. It carries the request's own principal because it is
    // an ordinary action on an ordinary session — nothing derives a second one.
    //
    // The `no-answer` control removes it: the server still starts, every seat
    // is still registered, and only the answer assertion goes red. That is the
    // isolating red state the coarse `no-tree` control does not give.
    ...(process.env.ER_COLLAB_POC_CONTROL === "no-answer"
      ? {}
      : {
          answer: {
            block: board.unparkAndDrain,
            description: "Answer a parked row and put it back in the queue.",
          },
        }),
  },
  task: { actions: { work: { block: runRow } } },
} as never);

const plannerKind = defineFlow({
  kind: "planner",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: {
    file: {
      // No board, no collection, no drain — one dispatch into the channel's
      // own `fileTask` door.
      block: dispatcher({
        name: "planner-file-row",
        flowKind: CHANNEL_KIND,
        action: "fileTask",
        inputSchema: z.object({
          goal: z.string(),
          assignee: z.string(),
          asks: z.string().optional(),
        }),
        session: { id: () => CHANNEL_ID },
        payload: (input: { goal: string; assignee: string; asks?: string }) => ({
          board: BOARD_NAME,
          goal: input.goal,
          assignee: input.assignee,
          author: "eng.planner",
          ...(input.asks === undefined ? {} : { input: { asks: input.asks } }),
        }),
      }),
      description: "File one row onto the channel's board.",
    },
  },
} as never);

export const seats = hireWorkforce(roster.workers, {
  kinds: { worker: workerKind as never, planner: plannerKind as never },
  channelBoards: channelBoardIds(channels),
});

export const channelKinds = channelInstances(channels);

/** One instance by id, for the flow module that default-exports it. */
export function seat(id: string) {
  const found = seats.find((instance) => instance.id === id);
  if (found === undefined) {
    throw new Error(`no seat "${id}" was hired (have: ${seats.map((s) => s.id).join(", ")})`);
  }
  return found;
}
