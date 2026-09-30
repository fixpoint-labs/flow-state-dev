/**
 * The feature board's two declarations: the EM's, whose worker hands a row to
 * the coder seat, and the coder's, which only lets that hand-off in.
 *
 * **The board itself belongs to the channel.** The feature channel's
 * `CHANNEL.md` names it by a plain local name (`boards: [work]`), and the
 * framework mints its id from where the channel sits (`<channel id>.<name>`),
 * so no file in the tree, and no line of this lab, writes that id.
 * The host resolves the ledger with `channelBoard(channel.id, boardName)`,
 * reading both off the tree, and hands it to the two kinds below. The ledger
 * is kept per organization, which is what lets App Lab show the workstream's
 * board to everyone working it.
 *
 * Two shapes, because the row crosses flows (D1 of the lab's own spec):
 *
 * - {@link coordinatorBoard} sits on the `em` kind. Its `coder` worker is a
 *   dispatcher naming *another flow instance* — the hired coder seat — so the
 *   row it claims is handed to the seat a `WORKER.md` declared.
 * - {@link recipientBoard} sits on the `coder` kind, and **is the framework's
 *   tax, not a convention.** It drains nothing. It exists because `defineFlow`
 *   refuses a flow that declares a task entry with no board reachable that
 *   hands off to it, and because the claim gate refuses a dispatch whose
 *   `boardId` differs from the one the recipient's own board was built with.
 *   Same `boardId`, same ledger, its own same-flow dispatcher.
 *
 * **Do not copy the second shape as "how boards are declared."** Where the
 * board lives is settled: on the channel, as its file says. The second
 * declaration is the cross-flow hand-off's cost, and removing it is the
 * framework's to do — FIX-1408 closed with it in place, and nothing owns it
 * now. `packages/orchestration/test/task-board/hand-off-cross-flow.test.ts`
 * documents the same constraint in its own header.
 */

import { dispatcher } from "@flow-state-dev/core";
import type { DefinedTaskCollection, TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { runOwnerDispatcher } from "@flow-state-dev/harness-manager";

/**
 * The board's own id, shared by both declarations.
 *
 * Not the ledger's id: this names the board (the claim gate compares it, so
 * the two declarations cannot drift), while the ledger it reads and writes is
 * the channel's, whose id the framework mints.
 */
export const BOARD_ID = "devforce-feature-board";

/**
 * The board's assignee key — **pinned**. It is the routing key written on the
 * row, and BR-5/BR-8 grade on it.
 *
 * An assignee is not a Workforce seat (FIX-1385). It is the name the board
 * knows a worker slot by; which seat that slot reaches is the dispatcher's
 * `flowKind`, and keeping the two separable is what lets BR-8 be graded at all.
 */
export const ASSIGNEE = "coder";

/** The task entry the hand-off addresses on the recipient flow. */
export const WORK_ENTRY = "work";

/**
 * The ledger both declarations read and write, with the id it is registered
 * under.
 *
 * The host builds it — `channelBoard(channel.id, boardName)` — and passes the
 * one object to both kinds, so the channel, the EM's board and the coder's
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
  /** The ledger this board reads and writes — the channel's. */
  collection: DefinedTaskCollection;
  /**
   * The hired coder seat's **instance id** — where the row is handed.
   *
   * A static string, because `flowKind` on a dispatcher is an instance id and
   * not a function: "look the assignee up and dispatch to it" is not a shape
   * this seam offers. The host derives it from the tree rather than naming it,
   * so no file is named in code.
   */
  coderSeatId: string;
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
    boardId: BOARD_ID,
    collection: options.collection,
    concurrency: 1,
    dispatcher: runOwnerDispatcher(),
    workers: {
      [ASSIGNEE]: dispatcher<TaskWorkerInput>({
        name: `${BOARD_ID}-hand-off`,
        // The seat's own flow instance. This one line is the whole of D1.
        flowKind: options.coderSeatId,
        action: WORK_ENTRY,
        session: "per-task",
      }),
    },
    ...(options.initialTasks === undefined ? {} : { initialTasks: options.initialTasks }),
  });
}

/**
 * The recipient's board — declared so the claim gate has something to verify
 * against, and drained by nobody.
 *
 * **The framework's tax.** See this module's header.
 */
export function recipientBoard(collection: DefinedTaskCollection) {
  return taskBoard({
    name: BOARD_ID,
    boardId: BOARD_ID,
    collection,
    concurrency: 1,
    workers: {
      [ASSIGNEE]: dispatcher<TaskWorkerInput>({
        name: `${BOARD_ID}-gate`,
        action: WORK_ENTRY,
        session: "per-task",
      }),
    },
  });
}
