/**
 * The feature board, and the door the coder takes its rows through.
 *
 * **The board itself belongs to the mailbox.** The feature mailbox's
 * `MAILBOX.md` names it by a plain local name (`boards: [work]`), and the
 * framework mints its id from where the mailbox sits (`<mailbox id>.<name>`),
 * so no file in the tree, and no line of this lab, writes that id.
 * The host resolves the ledger with `mailboxBoard(mailbox.id, boardName)`,
 * reading both off the tree, and hands it to the two kinds below. The ledger
 * is kept per organization, which is what lets Shift Manager show the workstream's
 * board to everyone working it.
 *
 * The row crosses flows (D1 of the lab's own spec):
 *
 * - {@link coordinatorBoard} sits on the `em` kind and drains the ledger. Its
 *   `coder` worker is a dispatcher naming *another flow instance* (the hired
 *   coder worker), so the row it claims is handed to the worker a `WORKER.md`
 *   declared. A row for any other name falls to the board's fallback, which
 *   asks the Workforce lookup which worker holds that name right now.
 * - {@link ledgerDoor} is the coder's side: its task entry takes rows from
 *   this ledger, by the ledger's id, with no board of its own. The board
 *   hands off under that id (`boardId: ledger.id`) for the door to find it.
 */

import { defineCapability, dispatcher } from "@flow-state-dev/core";
import type { TaskBinding, TaskFlowTarget } from "@flow-state-dev/core/types";
import {
  getOrCreateTaskCollection,
  hasFrozenLedgerAssignee,
  resolveResourceCollection,
  type DefinedTaskCollection,
  type TaskWorkerInput,
} from "@flow-state-dev/orchestration/tasks";
import { taskBoard, taskLedgers } from "@flow-state-dev/orchestration/task-board";
import { runOwnerDispatcher } from "@flow-state-dev/harness-manager";

/**
 * The board's name: the capability key the EM's doors file through. It hands
 * off under the ledger's id, not this one.
 */
export const BOARD_ID = "devforce-feature-board";

/**
 * The board's assignee key — **pinned**. It is the routing key written on the
 * row, and BR-5/BR-8 grade on it.
 *
 * The board routes this name itself, to the worker the host names in
 * `coderWorkerId`, which is what lets BR-8 be graded at all: a control that
 * points it at the wrong worker turns the check red. Every other name goes to
 * the board's fallback and the Workforce lookup.
 */
export const ASSIGNEE = "coder";

/** The task entry the hand-off addresses on the recipient flow. */
export const WORK_ENTRY = "work";

/**
 * The coordinator's `internal` entry that runs its board's drain. The coder
 * seat's message door dispatches it into the EM session that claimed a run's
 * row, so the run's next attempt is handed off into the session it ran in.
 */
export const RESUME_ENTRY = "resume";

/**
 * The ledger both declarations read and write, with the id it is registered
 * under.
 *
 * The host builds it — `mailboxBoard(mailbox.id, boardName)` — and passes the
 * one object to both kinds, so the mailbox, the EM's board and the coder's
 * manager all hold the same declaration.
 */
export interface FeatureLedger {
  /** The minted ledger id — the manager derives every checkout and branch from it. */
  id: string;
  /** The declaration itself. */
  collection: DefinedTaskCollection;
}

/** One row as the EM seat files it. */
export interface FeatureRow {
  id: string;
  goal: string;
  input: { issue: string; phase: string };
}

export interface CoordinatorBoardOptions {
  /** The ledger this board reads and writes — the mailbox's. */
  ledger: FeatureLedger;
  /**
   * The hired coder worker's **instance id**, where a `coder` row is handed.
   * The host derives it from the tree rather than naming it, so no file is
   * named in code.
   */
  coderSeatId: string;
  /**
   * Which worker any other assignee names, asked per row: the Workforce
   * lookup's `flowKind`. Absent, a row for any other name is never claimed.
   */
  findWorker?: TaskFlowTarget;
  /** Rows the board starts with. The EM files through the capability instead. */
  initialTasks?: FeatureRow[];
}

/**
 * The coordinator's board — the one that hands a row across flows.
 *
 * `concurrency: 1` is stated rather than inherited: the substrate's default is
 * 4, and a drain that launched four supervised coding runs at once would make
 * this check's cost and its evidence both four times harder to read.
 *
 * `runOwnerDispatcher` because this is the board that DRAINS, and its ledger is
 * kept per organization: a row's coding run belongs to the member who started
 * it, and another member's drain is refused before it claims — so it charges
 * the row nothing.
 */
export function coordinatorBoard(options: CoordinatorBoardOptions) {
  return taskBoard({
    name: BOARD_ID,
    // The ledger's id, which is what the coder's door resolves.
    boardId: options.ledger.id,
    collection: options.ledger.collection,
    concurrency: 1,
    dispatcher: runOwnerDispatcher(),
    workers: {
      [ASSIGNEE]: dispatcher<TaskWorkerInput>({
        name: `${BOARD_ID}-hand-off`,
        // The worker's own flow instance. This one line is the whole of D1.
        flowKind: options.coderSeatId,
        action: WORK_ENTRY,
        session: "per-task",
      }),
    },
    ...(options.findWorker === undefined
      ? {}
      : {
          defaultWorker: dispatcher<TaskWorkerInput>({
            name: `${BOARD_ID}-hand-over`,
            flowKind: options.findWorker,
            action: WORK_ENTRY,
            session: "per-task",
          }),
        }),
    ...(options.initialTasks === undefined ? {} : { initialTasks: options.initialTasks }),
  });
}

/**
 * The coder's door: its task entry takes rows from this ledger, read by the
 * id each hand-off carries. Any other id is refused before a row is read.
 *
 * Pass as the entry's `from`; the flow then needs no board of its own.
 */
export function ledgerDoor(ledger: FeatureLedger): TaskBinding {
  return taskLedgers({
    name: `${BOARD_ID}-door`,
    resolve: async (id, ctx) => {
      if (id !== ledger.id) return undefined;
      const collection = resolveResourceCollection(ctx, id);
      return collection === undefined
        ? undefined
        : getOrCreateTaskCollection({
            ctx,
            backing: "resource",
            collectionId: id,
            collection,
            // The EM's board hands rows off, which freezes their assignee; the
            // door must agree, as every board-mediated path to the ledger does.
            immutableAssignee: hasFrozenLedgerAssignee(ledger.collection),
          });
    },
    uses: [defineCapability({ name: `${BOARD_ID}-ledger`, resources: { [ledger.id]: ledger.collection } })],
  });
}
