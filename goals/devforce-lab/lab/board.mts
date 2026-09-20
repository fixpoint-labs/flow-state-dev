/**
 * The feature board — its identity, its ledger, and the two shapes it is
 * declared in.
 *
 * **The board is declared in code, never as a folder in the tree.** The
 * workforce loader walks exactly four things (`workers/`, `skills/`,
 * `resources/`, `channels/`) and silently ignores everything else, so a
 * `boards/` folder would look declared and be read by nobody — which is BR-16,
 * and the reason this file exists at all rather than a `BOARD.md`.
 *
 * Two shapes, because the row crosses flows (D1):
 *
 * - {@link coordinatorBoard} sits on the `em` kind. Its `coder` worker is a
 *   dispatcher naming *another flow instance* — the hired coder seat — so the
 *   row it claims is handed to the seat a `WORKER.md` declared.
 * - {@link recipientBoard} sits on the `coder` kind, and is **the interim L1
 *   tax D1 names**. It drains nothing. It exists because `defineFlow` refuses a
 *   flow that declares a task entry with no board reachable that hands off to
 *   it, and because the claim gate refuses a dispatch whose `boardId` differs
 *   from the one the recipient's own board was built with. Same `boardId`, same
 *   ledger id, its own same-flow dispatcher.
 *
 * **Do not copy the second shape as "how boards are declared."** It is labelled
 * interim on purpose: board *authoring* is a channel-attached `TaskCollection`
 * (FIX-1385), and the cross-flow claim-gate cost is an L1 constraint carved onto
 * FIX-1408. What is settled today is only that the hand-off works and what it
 * costs — `packages/orchestration/test/task-board/hand-off-cross-flow.test.ts`
 * documents the same constraint in its own header.
 */

import { dispatcher } from "@flow-state-dev/core";
import { defineTaskCollection, type TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { harnessTaskInputSchema } from "@flow-state-dev/harness-manager";
import { joinIdentity, tenantSegment } from "@flow-state-dev/harness-manager/checkout";

/**
 * The board's own id, shared by both declarations.
 *
 * The claim gate compares it, so the two spellings cannot drift: a mismatch
 * refuses the hand-off rather than misrouting it.
 */
export const BOARD_ID = "devforce-feature-board";

/**
 * The ledger both boards read and write — one logical board, two declarations.
 *
 * Built with `joinIdentity` rather than written as a literal because the
 * manager derives a checkout path and a git branch from it
 * (`RunLocation.epic`), and that derivation runs `assertDerivedIdentity` over
 * whatever arrives.
 */
export const LEDGER_ID = joinIdentity("devforce-tasks", tenantSegment(undefined), "feature");

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
 * A fresh declaration of the shared ledger.
 *
 * A factory rather than a module-level constant: the two flows each declare
 * their own object with the same id, which is the shape
 * `hand-off-cross-flow.test.ts` proves. Sharing one object across two
 * `defineFlow` calls is not what was settled.
 */
export function featureLedger() {
  return defineTaskCollection({
    id: LEDGER_ID,
    scope: "user" as const,
    stateSchema: harnessTaskInputSchema,
  });
}

/** One row as the EM seat files it. */
export interface FeatureRow {
  id: string;
  goal: string;
  input: { issue: string; phase: string };
}

export interface CoordinatorBoardOptions {
  /** This flow's own declaration of the shared ledger. */
  collection: ReturnType<typeof featureLedger>;
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
 */
export function coordinatorBoard(options: CoordinatorBoardOptions) {
  return taskBoard({
    name: BOARD_ID,
    boardId: BOARD_ID,
    collection: options.collection,
    concurrency: 1,
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
 * **Interim.** See this module's header, and D1's *Locks in*.
 */
export function recipientBoard(collection: ReturnType<typeof featureLedger>) {
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
