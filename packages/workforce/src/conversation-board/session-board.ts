// FIX-1802 S1 to S3; FIX-2286.
/**
 * `defineSessionBoard`: the filing factory a worker flow carries so its workers
 * file tasks for their delegates.
 *
 * A worker files when its session's delegate list holds one that takes a task
 * (D1): no flag. What its flow carries for that is three things, and this
 * builds them over one installation and one worker flow:
 *
 * - **The model's tools**: `tools`, one capability for the model block's
 *   `uses`, carrying Orchestration's task tools while the session
 *   files and none otherwise, read before each model call. Compose it once
 *   per turn: core refuses a turn with two tools of one name. Beside it,
 *   `questions` and `progress` (a task turn's own two) and `delegateTools`.
 * - **The actions**: `actions`, the same tools as public actions named
 *   `<tool>_tasks`, which answer `no_delegation_board` while the session
 *   doesn't file, and the four delegate actions (`addDelegate`,
 *   `removeDelegate`, `setFallback`, `listDelegates`).
 * - **The view**: `views`, the task list as a session view named
 *   `listTasks_tasks`, which an app watches with `useView`.
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
 *     actions: { respond: { ... }, ...board.actions },
 *     views: board.views,
 *     internal: { actions: board.entries(answer) }
 *   });
 * });
 * ```
 */
import type { BlockContext, BlockDefinition } from "@flow-state-dev/core/types";
import type { NoticePolicy } from "@flow-state-dev/orchestration/internal";
import { z } from "zod";
import { PLAN_WAITING_STATE } from "./plan";
import { DELEGATE_SERVER_OWNED, delegateStateShape, type DelegateRecord } from "../delegates/delegate-list";
import { defineWorkerDelegates, soleTaskDelegate, type TaskDelegates } from "../delegates/worker-delegates";
import type { InferredWork } from "../coordinator/coordinator-keys";
import { INFERRED_FORWARD_METADATA, messageHopStateShape, RECEIVED_FORWARD_STATE, turnForwardOf } from "../messages/hop";
import { workerMessagesResources } from "../messages/message-log";
import { defineSendMessageCapability } from "../messages/message-tool";
import { MESSAGE_RECEIVED_ENTRY } from "../messages/keys";
import { messageDeliveryStateShape, payMessageDebts } from "../messages/delivery";
import { payReplyDebts } from "../messages/owed-replies";
import { messageReceivedEntry, promptedMessageTurn } from "../messages/message-received-entry";
import { recheckRecipient } from "../messages/send-message";
import { fileScheduledTaskEntry } from "../schedules/file-scheduled-task";
import { FILE_SCHEDULED_TASK_ENTRY } from "../schedules/keys";
import { ROUTED_FROM_STATE_KEY, WORK_PROJECT_STATE_KEY } from "../workers/keys";
import { taskChainLimitOf } from "../workers/chain-limit";
import { markRolePiece, takesTasks } from "../worker-roles";
import type { WorkerInstallation } from "../workers/installation";
import { defineConversationBoard, type RoutedFiling } from "./board";
import { CHECK_TASK_ENTRY, DISPATCH_ENTRY, STEER_TURN_ENTRY } from "./board-entries";
import { checkTaskEntry } from "./task-admission";
import { TASK_SETTLED_ENTRY } from "./board-entries";
import { userWaits } from "./user-waits";
import { taskProgress } from "./task-progress";
import { steerTurnEntry } from "./steer";
import { taskSteers } from "./task-steers";
import {
  AFTER_REPLY_CONCURRENCY,
  PASS_CONCURRENCY,
  CONVERSATION_BOARD_SERVER_OWNED,
  conversationBoardStateShape,
  taskSettledEntry
} from "./task-settled";

// FIX-1989, FIX-2240.
/**
 * The session state worker messages keep: the session's
 * hop count, and the messages it sent that are still owed. Both server-owned.
 */
export const workerMessageStateShape = { ...messageHopStateShape, ...messageDeliveryStateShape } as const;

/**
 * The board action a screen files a task through: filed ready, the board
 * woken. A scheduled task files through it too.
 */
const SCREEN_FILING_ACTION = "createTask_tasks";

/** {@link workerMessageStateShape}'s fields, for a flow's `session.serverOwned`. */
export const WORKER_MESSAGE_SERVER_OWNED: readonly string[] = Object.keys(workerMessageStateShape);

/**
 * The session-state fields this factory's delegate list and board write, and only
 * they: what a flow declares as `session.serverOwned`. `installation.session()`
 * declares the same set, so every worker flow refuses them on a caller's create.
 */
export const SESSION_BOARD_SERVER_OWNED: readonly string[] = [
  ...DELEGATE_SERVER_OWNED,
  ...CONVERSATION_BOARD_SERVER_OWNED,
  ...WORKER_MESSAGE_SERVER_OWNED,
  // The `work` entry writes it when it starts a routed task in a session the routing conversation doesn't own (FIX-2083).
  ROUTED_FROM_STATE_KEY,
  // A plan writes it while it waits on a step in a session of its own (FIX-2113). A seeded key
  // naming a request that never ends here would hold the session's notices with no live wait.
  PLAN_WAITING_STATE,
  // Not the board's: the work-project action writes it after a membership check (FIX-2161). Here so
  // every flow declaring this list, with a board or without, refuses it on a caller's create.
  WORK_PROJECT_STATE_KEY
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
   * The records a session's delegates start with beside its worker's
   * defaults, copied in the first time they are read or changed. A project
   * coordinator's flow seeds one per workstream its user has open there.
   */
  readonly seed?: (ctx: BlockContext) => Promise<readonly DelegateRecord[] | undefined>;
  // FIX-2083.
  /**
   * How a flow that routes messages files a routed task from its model's
   * turn: on a turn routing one, a filing whose result goes to the
   * conversation is handed here, which attaches the message.
   */
  readonly routes?: RoutedFiling;
  // FIX-2538 D2.
  /**
   * What the running session may do with work nobody asked for: an inferred
   * forward (an event no other subscription heard). `off` lands it as a line
   * with no turn; `observe` runs the turn, and every task it files waits on
   * the user's yes, and it sends no message; `auto` runs it as any turn. Read
   * at the turn. Unset reads `observe`: a flow that never set it holds.
   */
  readonly inferredWork?: (ctx: BlockContext) => InferredWork;
}

/** The most of a goal a confirm's prompt quotes. */
const CONFIRM_GOAL_CHARS = 600;

/** The confirm an inferred task waits on: its goal, and the event it came from. */
function inferredConfirmPrompt(goal: string, url: string): string {
  const quoted = goal.length <= CONFIRM_GOAL_CHARS ? goal : `${goal.slice(0, CONFIRM_GOAL_CHARS - 1)}…`;
  return `Nobody asked for this: it was inferred from ${url}. Run it? ${quoted}`;
}

/**
 * Build the filing factory for one worker flow.
 *
 * @param options The installation, the flow's name, its seed and its routing.
 */
export function defineSessionBoard(options: SessionBoardOptions) {
  const delegates = defineWorkerDelegates(options);
  /** The running turn's inferred forward's mode, or `undefined` on any other turn (an addressed one's included). */
  const inferredOn = (ctx: BlockContext): InferredWork | undefined =>
    turnForwardOf(ctx)?.as === "inferred" ? (options.inferredWork?.(ctx) ?? "observe") : undefined;
  const board = defineConversationBoard({
    delegates: delegates.taskDelegates,
    flowKind: options.flowKind,
    // A worker's step filed `session: "new"` runs through its own `work` entry (FIX-2082 D2).
    takesOwnTasks: () => takesTasks(options.installation.workerFlows()[options.flowKind]),
    chainLimit: () => taskChainLimitOf(options.installation),
    // A coding flow's task is refused when it is filed with no project (FIX-2333).
    needsProject: (flow) => options.installation.workerFlows()[flow]?.needsProject === true,
    // The messages the session sent that haven't landed (FIX-2240): the pass sends them again.
    // And the reply-requested messages it landed that its turns never answered (FIX-2310): the pass says "no answer".
    messages: {
      resources: { ...options.installation.resources, ...workerMessagesResources },
      payDebts: async (ctx) => {
        const sends = await payMessageDebts(ctx, (inner, row) => recheckRecipient(inner, options.installation, row));
        const replies = await payReplyDebts(ctx, options.installation, options.flowKind);
        // The earlier of the two next looks, if either owes one.
        const due = [sends, replies].filter((at): at is number => at !== undefined);
        return due.length === 0 ? undefined : Math.min(...due);
      }
    },
    ...(options.routes === undefined ? {} : { routes: options.routes }),
    // On an inferred turn in `observe`, every filing waits on the user's yes.
    holdsFiling: (ctx, init) => {
      const forward = turnForwardOf(ctx);
      if (forward === undefined || inferredOn(ctx) !== "observe") return undefined;
      const prompt = inferredConfirmPrompt(init.goal, forward.url);
      // The marker names the confirm by its prompt, so a retry can tell whether the user said yes.
      return { prompt, metadata: { [INFERRED_FORWARD_METADATA]: { ...forward, confirm: prompt } } };
    }
  });

  // A message would hand inferred work on without the yes the board's filings wait on.
  const messages = defineSendMessageCapability(options.installation, options.flowKind, (ctx) =>
    inferredOn(ctx) === "observe"
      ? "inferred_work_waits: nobody asked for this, so what you hand on from this turn waits on the user's yes. File it as a task for a delegate; it starts once they say yes. Nothing was sent."
      : undefined
  );

  // The manager's pieces: a flow that spreads any of them declares `manager` (`../worker-roles`).
  const managerActions = { ...board.actions, ...delegates.actions };
  for (const action of Object.values(managerActions)) markRolePiece(action, "manager");

  return {
    /** The session's delegates: the one check, the list a task sees, the four actions and tools. */
    delegates,
    /** The board itself: its resolver, its roster and its run. */
    board,
    /** The model's task tools, granted per call: one entry for the model block's `uses`. */
    tools: board.tools,
    // FIX-2131.
    /**
     * `holdTaskForUser` on a task turn, and `suspendForUser` for an approval, a review
     * or (with no task) input: one entry for the model block's
     * `uses`, beside `tools`.
     */
    questions: userWaits,
    // FIX-2081 D3.
    /**
     * `reportProgress`, on a task turn holding a running row:
     * one entry for the model block's `uses`, beside `tools`.
     */
    progress: taskProgress,
    // FIX-2086.
    /**
     * The steers a running task took, in the worker's context, read
     * before each model call: one entry for the model block's `uses`, beside
     * `tools`.
     */
    steers: taskSteers,
    // FIX-2081.
    /**
     * The delegate tools a model's turn is offered: `listDelegates`
     * always, and `addDelegate`, `removeDelegate` and `setFallback` only on a
     * coordinator set to `editsOwnDelegates`. One entry for `uses`.
     */
    delegateTools: delegates.toolsCapability,
    // FIX-1989.
    /**
     * `sendMessage`, on every turn of a session that runs a
     * worker: one entry for the model block's `uses`, beside `tools`.
     */
    messages,
    // FIX-2076.
    /**
     * Wrap a turn so the steps the worker files for itself run in its request:
     * `{ message }` in, the answer out. Wrap each turn the flow
     * runs as the worker, and pass the wrapped turn to {@link entries}: a
     * worker is offered its steps only on a flow that wraps one.
     */
    planned: board.planned,
    /** Whether the running session files now: one of its delegates takes a task. A task session files its task's pieces. */
    files: board.files as (ctx: BlockContext) => Promise<boolean>,
    /** The session's delegates as a task sees them, read now. */
    taskDelegates: delegates.taskDelegates as (ctx: BlockContext) => Promise<TaskDelegates>,
    // FIX-2083.
    /** File a routed task and start it: the write under a coordinator's one filing step. */
    fileRouted: board.fileRouted,
    /** The task actions (`<tool>_tasks`) and the four delegate actions, for the flow's `actions`. A manager's. */
    actions: managerActions,
    // FIX-2623.
    /** The task list as a session view, `listTasks_tasks`, for the flow's `views`. */
    views: board.views,
    /** The ledger, the chain records and the message log, for the flow's `resources`. */
    resources: { ...board.resources, ...workerMessagesResources },
    /** The session state the delegates, the board and worker messages keep, for `installation.session(...)`. */
    sessionStateShape: { ...delegateStateShape, ...conversationBoardStateShape, ...workerMessageStateShape },
    /** The session-state fields only this factory writes, for the flow's `session.serverOwned`. */
    serverOwned: SESSION_BOARD_SERVER_OWNED,
    // FIX-2086; FIX-1989; FIX-2085; FIX-2083.
    /**
     * The internal entries the board needs on its flow, in this order: a run
     * of the board (`dispatch`); the notice of a task the session filed
     * (`onTaskSettled`), the two a flow declaring `manager` is checked for; a check of the
     * session's waiting task (`CHECK_TASK_ENTRY`); the turn a late steer is
     * owed (`STEER_TURN_ENTRY`); a worker's message
     * (`onMessageReceived`), which always wakes the turn; and a
     * scheduled task's filing (`fileScheduledTask`), through the
     * board's own `createTask_tasks`. Spread into `internal: { actions: ... }`.
     *
     * @param turn The flow's turn for one message (`{ message }` in), woken
     *   with a notice as its message.
     * @param policy For the notice entry: whether a notice wakes the turn
     *   (`judgment`, the default) or lands as a line only (`fixed`), for the
     *   running session.
     * @param onRouted For a flow that routes messages: a conversation-result
     *   task's completion, failure or cancel (`RoutedEnding` in), handed to
     *   the flow's own handling instead of a line.
     */
    entries(
      turn: BlockDefinition<any, any>,
      policy: (ctx: BlockContext) => NoticePolicy = () => "judgment",
      onRouted?: BlockDefinition<any, any>
    ) {
      return {
        // One pass at a time per session (FIX-2078): a second waits its turn,
        // and runs once the first ends.
        [DISPATCH_ENTRY]: markRolePiece(
          { inputSchema: z.object({}).strict(), block: board.runBoard, concurrency: PASS_CONCURRENCY },
          "manager"
        ),
        [TASK_SETTLED_ENTRY]: markRolePiece(
          taskSettledEntry({
            turn,
            policy,
            ...(onRouted === undefined ? {} : { onRouted }),
            // A task filed on an inferred turn wakes its filer's turn as that forward's turn did (a No's
            // cancel included), so the work the user declined isn't filed again unheld.
            turnStateOf: (task) => {
              const forward = task.metadata?.[INFERRED_FORWARD_METADATA] as { as?: unknown; url?: unknown } | undefined;
              return forward?.as === "inferred" && typeof forward.url === "string"
                ? { [RECEIVED_FORWARD_STATE]: { as: "inferred", url: forward.url } }
                : undefined;
            }
          }),
          "manager"
        ),
        // A check of the session's waiting task, on the notices' line: what
        // the upgrade's backfill wakes for a row an older host held open.
        [CHECK_TASK_ENTRY]: checkTaskEntry(AFTER_REPLY_CONCURRENCY),
        // The turn a steer no request took is owed (FIX-2086 D2), on the
        // notices' line: the claim gate's check and the steer's write start it.
        [STEER_TURN_ENTRY]: steerTurnEntry({ name: "conversation-steer-turn", turn }),
        [MESSAGE_RECEIVED_ENTRY]: messageReceivedEntry({
          turn: promptedMessageTurn(turn),
          installation: options.installation,
          flowKind: options.flowKind,
          // `off`: an inferred forward lands as a line, and no model runs on it.
          landsOnly: (ctx, message) => message.forward?.as === "inferred" && (options.inferredWork?.(ctx) ?? "observe") === "off"
        }),
        [FILE_SCHEDULED_TASK_ENTRY]: fileScheduledTaskEntry(board.actions[SCREEN_FILING_ACTION]!, async (ctx) =>
          soleTaskDelegate(await delegates.taskDelegates(ctx))
        )
      };
    }
  };
}

export type SessionBoard = ReturnType<typeof defineSessionBoard>;
