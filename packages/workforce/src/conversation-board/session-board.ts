/**
 * `defineSessionBoard`: the filing kit a worker flow carries so its workers
 * file tasks for their delegates (FIX-1802 S1 to S3).
 *
 * A worker files when its session's delegate list holds one that takes a task
 * (D1): no flag. What its flow carries for that is three things, and this
 * builds them over one installation and one flow kind:
 *
 * - **The model's tools**: `tools`, one capability for the model block's
 *   `uses`, carrying Orchestration's nine task tools while the session
 *   files and none otherwise, read before each model call. Compose it once
 *   per turn: core refuses a turn with two tools of one name.
 * - **The actions**: `actions`, the nine as public actions named
 *   `<tool>_tasks`, which answer `no_delegation_board` while the session
 *   doesn't file, and the four delegate actions (`addDelegate`,
 *   `removeDelegate`, `setFallback`, `listDelegates`).
 * - **The entries**: `entries(turn)`, the internal entries the board runs on
 *   (a run of the board), its notices arrive on (`onTaskSettled`), and a
 *   split task settles and cancels its pieces on, and the session state they
 *   keep (`sessionStateShape`, `serverOwned`).
 *
 * The built-in `agent` flow and the coordinator carry it through the agent's
 * shared worker turn. An app's own worker flow carries it the same way:
 *
 * ```ts
 * workerFlow((installation) => {
 *   const board = defineSessionBoard({ installation, flowKind: "em" });
 *   const answer = generator({ name: "em-answer", uses: [board.tools], ... });
 *   return defineFlow({
 *     kind: "em",
 *     configSchema: workerConfigSchema().extend({ ... }),
 *     session: { ...installation.session(board.sessionStateShape), serverOwned: board.serverOwned },
 *     resources: { ...installation.resources, ...board.resources },
 *     actions: { run: { ... }, ...board.actions },
 *     internal: { actions: board.entries(answer) }
 *   });
 * });
 * ```
 */
import type { BlockContext, BlockDefinition } from "@flow-state-dev/core/types";
import type { NoticePolicy } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { DELEGATE_SERVER_OWNED, delegateStateShape } from "../delegates/delegate-list";
import { defineWorkerDelegates, type TaskDelegates } from "../delegates/worker-delegates";
import { taskChainLimitOf } from "../workers/chain-limit";
import type { WorkerInstallation } from "../workers/installation";
import { defineConversationBoard } from "./board";
import { CANCEL_PIECES_ENTRY, RUN_BOARD_ENTRY, SETTLE_SPLIT_ENTRY } from "./board-entries";
import { TASK_SETTLED_ENTRY } from "./notice-delivery";
import { questionPark } from "./question-park";
import { cancelPiecesBlock, cancelPiecesInputSchema, settleSplitBlock } from "./split";
import {
  AFTER_REPLY_CONCURRENCY,
  CONVERSATION_BOARD_SERVER_OWNED,
  conversationBoardStateShape,
  taskSettledEntry
} from "./task-settled";

/** What a session board is built from. */
export interface SessionBoardOptions {
  /** The worker installation the flow's workers, and their delegates, belong to. */
  readonly installation: WorkerInstallation;
  /**
   * The kind of the flow that carries the board: its workers are loaded on
   * it, and the tasks it hands over send their notices back to it.
   */
  readonly flowKind: string;
  /**
   * The worker flows a delegated post reaches, for a flow that routes posts.
   * Omitted, every worker flow on the installation that takes one.
   */
  readonly postFlows?: ReadonlySet<string>;
}

/**
 * Build the filing kit for one worker flow.
 *
 * @param options The installation, the flow's kind, and the flows a post reaches.
 */
export function defineSessionBoard(options: SessionBoardOptions) {
  const delegates = defineWorkerDelegates(options);
  const board = defineConversationBoard({
    delegates: delegates.taskDelegates,
    flowKind: options.flowKind,
    chainLimit: () => taskChainLimitOf(options.installation)
  });

  return {
    /** The session's delegates: the one check, the list a task sees, the four actions and tools. */
    delegates,
    /** The board itself: its resolver, its roster and its run. */
    board,
    /** The model's nine task tools, granted per call: one entry for the model block's `uses`. */
    tools: board.tools,
    /**
     * `parkOnQuestion`, on a task turn that may park its row on a question
     * (FIX-1817): one entry for the model block's `uses`, beside `tools`.
     */
    questions: questionPark,
    /** Whether the running session files now: one of its delegates takes a task. A task session files its task's pieces. */
    files: board.files as (ctx: BlockContext) => Promise<boolean>,
    /** The session's delegates as a task sees them, read now. */
    taskDelegates: delegates.taskDelegates as (ctx: BlockContext) => Promise<TaskDelegates>,
    /** The nine task actions (`<tool>_tasks`) and the four delegate actions, for the flow's `actions`. */
    actions: { ...board.actions, ...delegates.actions },
    /** The ledger, for the flow's `resources`. */
    resources: board.resources,
    /** The session state the delegates and the board keep, for `installation.session(...)`. */
    sessionStateShape: { ...delegateStateShape, ...conversationBoardStateShape },
    /** The session-state fields only this kit writes, for the flow's `session.serverOwned`. */
    serverOwned: [...DELEGATE_SERVER_OWNED, ...CONVERSATION_BOARD_SERVER_OWNED] as readonly string[],
    /**
     * The internal entries the board needs on its flow: a run of the board,
     * the notice of a task the session filed, and a split task's settle and
     * the cancel of its pieces. Spread into `internal: { actions: ... }`.
     *
     * @param turn The flow's turn for one message (`{ message }` in), woken
     *   with a notice as its message.
     * @param policy Whether a notice wakes the turn (`judgment`, the default)
     *   or lands as a line only (`fixed`), for the running session.
     */
    entries(turn: BlockDefinition<any, any>, policy: (ctx: BlockContext) => NoticePolicy = () => "judgment") {
      return {
        [RUN_BOARD_ENTRY]: { inputSchema: z.object({}).strict(), block: board.runBoard },
        [TASK_SETTLED_ENTRY]: taskSettledEntry({ runBoard: board.runBoard, turn, policy }),
        [SETTLE_SPLIT_ENTRY]: { inputSchema: z.object({}).strict(), block: settleSplitBlock, concurrency: AFTER_REPLY_CONCURRENCY },
        [CANCEL_PIECES_ENTRY]: { inputSchema: cancelPiecesInputSchema, block: cancelPiecesBlock, concurrency: AFTER_REPLY_CONCURRENCY }
      };
    }
  };
}

export type SessionBoard = ReturnType<typeof defineSessionBoard>;
