/**
 * `defineSessionBoard`: the filing kit a worker flow carries so its workers
 * file tasks for their delegates (FIX-1802 S1 to S3).
 *
 * A worker files when its session's delegate list holds one that takes a task
 * (D1): no flag. What its flow carries for that is three things, and this
 * builds them over one installation and one worker flow:
 *
 * - **The model's tools**: `tools`, one capability for the model block's
 *   `uses`, carrying Orchestration's task tools, `dispatchTask` among them, while the session
 *   files and none otherwise, read before each model call. Compose it once
 *   per turn: core refuses a turn with two tools of one name. Beside it,
 *   `questions` and `progress` (a task turn's own two) and `delegateTools`.
 * - **The actions**: `actions`, the same tools as public actions named
 *   `<tool>_tasks`, which answer `no_delegation_board` while the session
 *   doesn't file, and the four delegate actions (`addDelegate`,
 *   `removeDelegate`, `setFallback`, `listDelegates`).
 * - **The entries**: `entries(turn)`, the internal entries the board runs on
 *   (a run of the board), its notices arrive on (`onTaskSettled`), and a
 *   worker's message arrives on, and the session state they keep
 *   (`sessionStateShape`, `serverOwned`).
 *
 * The built-in `agent` flow and the coordinator carry it through the agent's
 * shared worker turn. An app's own worker flow carries it the same way:
 *
 * ```ts
 * workerFlow((installation) => {
 *   const board = defineSessionBoard({ installation, flowKind: "em" });
 *   // `board.messages` is what lets the worker send and answer the messages
 *   // `board.entries` delivers to it.
 *   const answer = generator({ name: "em-answer", uses: [board.tools, board.messages], ... });
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
import type { DispatchPostForm } from "@flow-state-dev/orchestration";
import type { NoticePolicy } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { DELEGATE_SERVER_OWNED, delegateStateShape, type DelegateRecord } from "../delegates/delegate-list";
import { defineWorkerDelegates, type TaskDelegates } from "../delegates/worker-delegates";
import { messageHopStateShape } from "../messages/hop";
import { workerMessagesResources } from "../messages/message-log";
import { defineMessageWorkerCapability } from "../messages/message-tool";
import { WORKER_MESSAGE_ENTRY } from "../messages/keys";
import { workerMessageEntry, workerMessageSeenStateShape } from "../messages/worker-message-entry";
import { fileScheduledTaskEntry } from "../schedules/file-scheduled-task";
import { FILE_SCHEDULED_TASK_ENTRY } from "../schedules/keys";
import { taskChainLimitOf } from "../workers/chain-limit";
import type { WorkerInstallation } from "../workers/installation";
import { defineConversationBoard } from "./board";
import { CHECK_TASK_ENTRY, RUN_BOARD_ENTRY } from "./board-entries";
import { checkTaskEntry } from "./task-admission";
import { POST_SETTLED_ENTRY, TASK_SETTLED_ENTRY } from "./notice-delivery";
import { questionPark } from "./question-park";
import { taskProgress } from "./task-progress";
import {
  AFTER_REPLY_CONCURRENCY,
  PASS_CONCURRENCY,
  CONVERSATION_BOARD_SERVER_OWNED,
  conversationBoardStateShape,
  postSettledEntry,
  taskSettledEntry
} from "./task-settled";

/**
 * The session state worker messages keep (FIX-1989): the session's hop count
 * and the message ids it has acted on. Both server-owned.
 */
export const workerMessageStateShape = { ...messageHopStateShape, ...workerMessageSeenStateShape } as const;

/**
 * The board action a screen files a task through, in its goal form: filed
 * ready, the board woken. A scheduled task files through it too.
 */
const SCREEN_FILING_ACTION = "dispatchTask_tasks";

/** {@link workerMessageStateShape}'s fields, for a flow's `session.serverOwned`. */
export const WORKER_MESSAGE_SERVER_OWNED: readonly string[] = Object.keys(workerMessageStateShape);

/**
 * The session-state fields this kit's delegate list and board write, and only
 * they: what a flow declares as `session.serverOwned`. `installation.session()`
 * declares the same set, so every worker flow refuses them on a caller's create.
 */
export const SESSION_BOARD_SERVER_OWNED: readonly string[] = [
  ...DELEGATE_SERVER_OWNED,
  ...CONVERSATION_BOARD_SERVER_OWNED,
  ...WORKER_MESSAGE_SERVER_OWNED
];

/** What a session board is built from. */
export interface SessionBoardOptions {
  /** The worker installation the flow's workers, and their delegates, belong to. */
  readonly installation: WorkerInstallation;
  /**
   * The worker flow that carries the board: its workers are loaded on
   * it, and the tasks it hands over send their notices back to it.
   */
  readonly flowKind: string;
  /**
   * The worker flows a delegated post reaches, for a flow that routes posts.
   * Omitted, every worker flow on the installation that takes one.
   */
  readonly postFlows?: ReadonlySet<string>;
  /**
   * The records a session's delegates start with beside its worker's
   * defaults, copied in the first time they are read or changed. A project
   * coordinator's flow seeds one per workstream its user has open there.
   */
  readonly seed?: (ctx: BlockContext) => Promise<readonly DelegateRecord[] | undefined>;
  /**
   * `dispatchTask`'s post form, for a flow that routes posts: on a turn routing
   * one, the model hands it on with `post: true`.
   */
  readonly posts?: DispatchPostForm;
}

/**
 * Build the filing kit for one worker flow.
 *
 * @param options The installation, the flow's name, and the flows a post reaches.
 */
export function defineSessionBoard(options: SessionBoardOptions) {
  const delegates = defineWorkerDelegates(options);
  const board = defineConversationBoard({
    delegates: delegates.taskDelegates,
    flowKind: options.flowKind,
    chainLimit: () => taskChainLimitOf(options.installation),
    ...(options.posts === undefined ? {} : { posts: options.posts }),
    // A post row's delegate is checked again at hand-over, for a post: one
    // fired or moved to a flow that takes none since its filing is refused.
    postFlow: async (ctx, worker) => {
      const checked = await delegates.check(ctx as never, worker, "post");
      if (!checked.ok) throw new Error(`The post wasn't handed to "${worker}": ${checked.message}`);
      return checked.worker.flow;
    }
  });

  const messages = defineMessageWorkerCapability(options.installation, options.flowKind);

  return {
    /** The session's delegates: the one check, the list a task sees, the four actions and tools. */
    delegates,
    /** The board itself: its resolver, its roster and its run. */
    board,
    /** The model's task tools, granted per call: one entry for the model block's `uses`. */
    tools: board.tools,
    /**
     * `parkOnQuestion`, on a task turn that may park its row on a question
     * (FIX-1817): one entry for the model block's `uses`, beside `tools`.
     */
    questions: questionPark,
    /**
     * `reportProgress`, on a task turn holding a running row (FIX-2081 D3):
     * one entry for the model block's `uses`, beside `tools`.
     */
    progress: taskProgress,
    /**
     * The delegate tools a model's turn is offered (FIX-2081): `listDelegates`
     * always, and `addDelegate`, `removeDelegate` and `setFallback` only on a
     * coordinator set to `editsOwnDelegates`. One entry for `uses`.
     */
    delegateTools: delegates.toolsCapability,
    /**
     * `messageWorker` (FIX-1989), on every turn of a session that runs a
     * worker: one entry for the model block's `uses`, beside `tools`.
     */
    messages,
    /**
     * Wrap a turn so the steps the worker files for itself run in its request
     * (FIX-2076): `{ message }` in, the answer out. Wrap each turn the flow
     * runs as the worker, and pass the wrapped turn to {@link entries}: a
     * worker is offered its steps only on a flow that wraps one.
     */
    planned: board.planned,
    /** Whether the running session files now: one of its delegates takes a task. A task session files its task's pieces. */
    files: board.files as (ctx: BlockContext) => Promise<boolean>,
    /** The session's delegates as a task sees them, read now. */
    taskDelegates: delegates.taskDelegates as (ctx: BlockContext) => Promise<TaskDelegates>,
    /** File a post row and start it: the coordinator's one way to hand a post on. */
    filePost: board.filePost,
    /** The task actions (`<tool>_tasks`) and the four delegate actions, for the flow's `actions`. */
    actions: { ...board.actions, ...delegates.actions },
    /** The ledger, the chain records and the message log, for the flow's `resources`. */
    resources: { ...board.resources, ...workerMessagesResources },
    /** The session state the delegates, the board and worker messages keep, for `installation.session(...)`. */
    sessionStateShape: { ...delegateStateShape, ...conversationBoardStateShape, ...workerMessageStateShape },
    /** The session-state fields only this kit writes, for the flow's `session.serverOwned`. */
    serverOwned: SESSION_BOARD_SERVER_OWNED,
    /**
     * The internal entries the board needs on its flow: a run of the board,
     * the notice of a task the session filed, a worker's message
     * (`onWorkerMessage`, FIX-1989), which always wakes the turn: `policy` is
     * the notices' only, and a scheduled task's filing (`fileScheduledTask`,
     * FIX-2085), through the board's own `dispatchTask_tasks`. Spread into
     * `internal: { actions: ... }`.
     *
     * @param turn The flow's turn for one message (`{ message }` in), woken
     *   with a notice as its message.
     * @param policy Whether a notice wakes the turn (`judgment`, the default)
     *   or lands as a line only (`fixed`), for the running session.
     * @param onPost A post row's ending, for a flow that hands posts on: the
     *   coordinator's own handling (`PostEnding` in), on its own entry.
     */
    entries(
      turn: BlockDefinition<any, any>,
      policy: (ctx: BlockContext) => NoticePolicy = () => "judgment",
      onPost?: BlockDefinition<any, any>
    ) {
      return {
        // One pass at a time per session (FIX-2078): a second waits its turn,
        // and runs once the first ends.
        [RUN_BOARD_ENTRY]: { inputSchema: z.object({}).strict(), block: board.runBoard, concurrency: PASS_CONCURRENCY },
        [TASK_SETTLED_ENTRY]: taskSettledEntry({ turn, policy, ...(onPost === undefined ? {} : { onPost }) }),
        // A check of the session's waiting task, on the notices' line: what
        // the upgrade's backfill wakes for a split an older host parked.
        [CHECK_TASK_ENTRY]: checkTaskEntry(AFTER_REPLY_CONCURRENCY),
        ...(onPost === undefined ? {} : { [POST_SETTLED_ENTRY]: postSettledEntry({ turn, policy, onPost }) }),
        [WORKER_MESSAGE_ENTRY]: workerMessageEntry({ turn, installation: options.installation, flowKind: options.flowKind }),
        [FILE_SCHEDULED_TASK_ENTRY]: fileScheduledTaskEntry(board.actions[SCREEN_FILING_ACTION]!)
      };
    }
  };
}

export type SessionBoard = ReturnType<typeof defineSessionBoard>;
