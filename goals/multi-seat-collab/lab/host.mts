/**
 * The hire — read the tree, build the two kinds, hire the seats, and hand back
 * what `fsdev.config.mts` serves and what the checks need to read.
 *
 * Every file it reads is found by walking from one root; no seat, channel or
 * board is named in this code. The minted ledger id is not written anywhere
 * under this lab — including in this comment — because a check greps every
 * file for it.
 *
 * ## The three things that are the lab's rather than the framework's
 *
 * 1. **The two kinds** (`kinds.mts`).
 * 2. **The desk -> seat map.** It is the app's, supplied by the caller and
 *    never read off the tree. That is what lets `swapped-desks` and `one-seat`
 *    move the routing while each seat's own `WORKER.md` still says where a row
 *    should have gone.
 * 3. **The refusal policy.** `readDeclaredRoster` collects problems rather than
 *    throwing, which is right for a library and wrong here: a seat that failed
 *    to load is a seat this lab does not have, and a short roster that still
 *    runs proves something other than what is claimed.
 */

import type { FlowInstance } from "@flow-state-dev/core/types";
import {
  channelBoard,
  channelBoardIds,
  channelInstances,
  hireWorkforce,
  type ChannelManifest,
} from "@flow-state-dev/workforce";
import { readDeclaredRoster, type DeclaredRoster } from "@flow-state-dev/workforce/loader";
import { fileURLToPath } from "node:url";
import {
  PLANNER_KIND,
  WORKER_KIND,
  defineWorkerFlow,
  definePlannerFlow,
  type WorkerControl,
} from "./kinds.mts";

/** The authored tree — the one path this code names. Everything else is walked. */
export const LAB_TREE = fileURLToPath(new URL("./workforce", import.meta.url));

/** The lab's own root, so a check can read every file the lab ships. */
export const LAB_DIR = fileURLToPath(new URL(".", import.meta.url));

/** Who the lab runs as — one person, one principal (ER-1, D7). */
export const LAB_USER_ID = "u_multi_seat_collab";

/** Everything the tree says, read once and refused whole if any of it did not load. */
export interface LabTree {
  roster: DeclaredRoster;
  /** The one channel the tree declares. */
  channel: ChannelManifest;
  /** The board's LOCAL name, as `CHANNEL.md` wrote it. */
  boardName: string;
  /** The MINTED ledger id. Appears in no file — a check greps for it. */
  boardId: string;
  /** The planner seat's id, read off the tree. */
  plannerId: string;
  /** The worker seat ids, in tree order. */
  workerIds: string[];
  /**
   * Seat id -> the desk that seat's OWN `WORKER.md` answers for. **The oracle.**
   * Read by the checks, never by the routing.
   */
  declaredDesks: Record<string, string>;
}

/**
 * Read the tree and refuse it whole if anything in it did not load.
 *
 * @throws Naming every problem in one pass, or the first missing fact.
 */
export async function readLabTree(root: string = LAB_TREE): Promise<LabTree> {
  const roster = await readDeclaredRoster(root);
  if (roster.problems.length > 0) {
    const lines = roster.problems.map((problem) => `${problem.layer} ${problem.path}: ${problem.error.message}`);
    throw new Error(`the tree at ${root} did not load cleanly:\n  - ${lines.join("\n  - ")}`);
  }
  if (roster.channels.length !== 1) {
    throw new Error(`the tree at ${root} declares ${roster.channels.length} channels; this lab runs one`);
  }
  const channel = roster.channels[0]!;
  // Read off the FILE. Rename the team, the channel folder or the board and a
  // correct implementation still passes.
  const boardName = (channel.declared.boards as string[] | undefined)?.[0];
  if (boardName === undefined) throw new Error(`channel "${channel.id}" declares no board`);

  const planner = roster.workers.find((worker) => worker.declared.flow === PLANNER_KIND);
  if (planner === undefined) throw new Error(`the tree at ${root} hires no "${PLANNER_KIND}" seat`);
  const workers = roster.workers.filter((worker) => worker.declared.flow === WORKER_KIND);
  if (workers.length < 2) {
    throw new Error(`the tree at ${root} hires ${workers.length} "${WORKER_KIND}" seat(s); a handoff needs two`);
  }
  const declaredDesks: Record<string, string> = {};
  for (const worker of workers) {
    const desk = worker.declared.answersFor;
    if (typeof desk !== "string" || desk.length === 0) {
      throw new Error(`seat "${worker.id}" declares no answersFor`);
    }
    declaredDesks[worker.id] = desk;
  }

  return {
    roster,
    channel,
    boardName,
    boardId: channelBoard(channel.id, boardName).id,
    plannerId: planner.id,
    workerIds: workers.map((worker) => worker.id),
    declaredDesks,
  };
}

export interface HireLabOptions {
  /** The tree, already read. */
  tree: LabTree;
  /** Desk key -> seat id. **The app's routing, and the thing under test.** */
  routes: Readonly<Record<string, string>>;
  /** Where each attempt leaves its line. */
  outbox: string;
  /** A worker-body perturbation, or none. */
  workerControl?: WorkerControl;
}

/**
 * Build the kinds and hire every seat, plus the channel singleton.
 *
 * `hireWorkforce` refuses the WHOLE roster when any record cannot be hired, so
 * a refusal cannot leave a short roster running.
 *
 * @returns The flow instances by address — what a `FlowState` registers.
 */
export function hireLab(options: HireLabOptions): Record<string, FlowInstance> {
  const { tree } = options;
  const board = channelBoard(tree.channel.id, tree.boardName);
  const seats = hireWorkforce(tree.roster.workers, {
    kinds: {
      [WORKER_KIND]: defineWorkerFlow({
        board,
        routes: options.routes,
        outbox: options.outbox,
        ...(options.workerControl === undefined ? {} : { control: options.workerControl }),
      }) as never,
      [PLANNER_KIND]: definePlannerFlow({ channelId: tree.channel.id, boardName: tree.boardName }) as never,
    },
    channelBoards: channelBoardIds([tree.channel]),
  });
  return {
    ...Object.fromEntries(channelInstances([tree.channel]).map((instance) => [instance.kind, instance])),
    ...Object.fromEntries(seats.map((seat) => [seat.id, seat])),
  };
}
