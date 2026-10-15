/**
 * How a conversation hears a task it filed end (FIX-1794 S7): the internal
 * entry its notices arrive on, `onTaskSettled`.
 *
 * Deduped by task, attempt and ending, which absorbs the replays the board's
 * outbox sends: a notice is acted on only while its row still owes it, and
 * only once. Then the one decision (`decideNotice`) is acted on: a retried
 * attempt runs the board again with no turn; a waited-on row's ending resumes
 * the turn parked on it (`dispatchTask` with `wait`), with no line and no turn woken;
 * a post row's ending (a delegate's answer to a post its coordinator handed
 * on, `../coordinator/delegated-post`) goes to the coordinator's own
 * handling, which lands it as the delegate's line or ends its part of the
 * round, with no generic line and no turn woken; any other ending lands as a
 * line under the delegate's name and, when its coordinator has a turn of its
 * own (judgment or best-fit routing), wakes that turn to read it and decide
 * what to do.
 *
 * A notice that arrives while the conversation is replying waits for the
 * reply to end, then runs (BR-27). It waits for the replies running when it
 * arrives and any that start in its first 30 seconds of waiting; after that
 * it waits only for the replies running at that moment, so a reply that
 * starts later can run beside it. That is the engine's `defer` patience,
 * which keeps a stream of replies from holding a notice back forever.
 *
 * At most 32 notices wait on a conversation in a process; the engine refuses
 * the next, which stays owed on its row. So every notice run sends again what
 * the rows still owe: the last one to run has room in the line, and nothing
 * owed waits for a later touch of the board.
 *
 * Refused when the conversation's worker was fired: the flow loads the
 * session's worker before any entry runs. The task's ending stands, and the
 * notice stays owed on its row.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import { withOutcome } from "@flow-state-dev/core/helpers";
import { resumeOwedWaits } from "@flow-state-dev/orchestration";
import {
  clearNotice,
  decideNotice,
  isTerminalStatus,
  isNoticeOwed,
  noticeKey,
  noticeText,
  type NoticePolicy,
  type TaskNotice
} from "@flow-state-dev/orchestration/tasks";
import type { BlockContext, BlockDefinition, ConcurrencyConfig, ConcurrencyKey } from "@flow-state-dev/core/types";
import { z } from "zod";
import { isPostRow, postRowOf, postRowSchema } from "../coordinator/delegated-post";
import { replayNotices } from "./board";
import { deleteChain, taskChainOf, taskChainResources } from "./chain";
import { filingSessionIdOf } from "./filing-session";
import { CONVERSATION_LEDGER_ID, ownConversationLedger } from "./ledger";
import { noteFailedPiece, noteWokenAnswer, PARENT_BINDING_STATE, settleSplitBlock, splitStateShape } from "./split";

/** A notice, as the entry takes it. */
export const taskNoticeSchema = z
  .object({
    boardId: z.string().min(1),
    taskId: z.string().min(1),
    attempt: z.number().int().nonnegative(),
    ending: z.enum(["completed", "errored", "parked", "retried", "cancelled"]),
    output: z.unknown().optional(),
    error: z.string().optional(),
    question: z.string().optional(),
    asked: z.literal(true).optional()
  })
  .strict();

/** Server-written session state: the notices this conversation has acted on, by dedupe key, newest last. */
export const TASK_NOTICES_STATE = "taskNotices";

/** The most dedupe keys a conversation keeps. A notice older than these is no longer owed on its row. */
const MAX_NOTICE_KEYS = 500;

/** The session-state fields a flow that keeps a conversation's board declares, server-owned. */
export const conversationBoardStateShape = {
  [TASK_NOTICES_STATE]: z.array(z.string()).default([]),
  ...splitStateShape
} as const;

/** {@link conversationBoardStateShape}'s fields, for the flow's `session.serverOwned`: only the board writes them. */
export const CONVERSATION_BOARD_SERVER_OWNED: readonly string[] = [TASK_NOTICES_STATE, PARENT_BINDING_STATE];

const settledSchema = z.object({
  act: z.enum(["none", "run-board", "wake-turn", "line", "resume-wait", "post"]),
  text: z.string().optional(),
  worker: z.string().optional(),
  /** On a post row's ending: what the coordinator's handling is handed. */
  post: z.unknown().optional(),
  /** On a post row's ending: the notice, acknowledged once the coordinator's handling has run. */
  notice: taskNoticeSchema.optional()
});

type Settled = z.infer<typeof settledSchema>;

/** What the entry is built from. */
export interface TaskSettledOptions {
  /** The conversation's board run, for a retried attempt. */
  readonly runBoard: BlockDefinition<any, any>;
  /** The coordinator's turn, woken with the notice as its message. */
  readonly turn: BlockDefinition<any, any>;
  /** Whether the running conversation's coordinator has a turn that reads a notice, or hears it as a line only. */
  readonly policy: (ctx: BlockContext) => NoticePolicy;
  /**
   * A post row's ending, acted on once like any notice, and handed here
   * instead of a line or a turn ({@link PostEnding}). Only a coordinator's
   * conversation files post rows.
   */
  readonly onPost?: BlockDefinition<any, any>;
}

/** What a post row's ending hands {@link TaskSettledOptions.onPost}. */
export const postEndingSchema = z.object({
  taskId: z.string(),
  ending: z.enum(["completed", "errored", "cancelled"]),
  /** The row's output: the delegate's reply, on a completed row. */
  output: z.unknown().optional(),
  /** The row's server-written post, read once here. */
  post: postRowSchema
});

export type PostEnding = z.infer<typeof postEndingSchema>;

/**
 * Not `"session"`. Delegate answers are `queue` on that key, and a queued
 * request gives up after 30 seconds. NUL bytes stay off any session id.
 */
const replyLine: ConcurrencyKey = (ctx) =>
  ctx.sessionId === undefined ? undefined : `${ctx.tenantId ?? ""}\u0000reply\u0000${ctx.sessionId}`;

/** Set on each entry that runs the conversation's turn: a task's notice waits for it, within the bound above. */
export const REPLY_CONCURRENCY = { policy: "hold", key: replyLine } as const satisfies ConcurrencyConfig;

/** Set on each entry that waits for the conversation's turn: a task's notice, and a split task's settle and cancel (FIX-1802 S4). */
export const AFTER_REPLY_CONCURRENCY = { policy: "defer", key: replyLine } as const satisfies ConcurrencyConfig;

/**
 * Build the `onTaskSettled` internal entry: spread it as
 * `internal: { actions: { [TASK_SETTLED_ENTRY]: taskSettledEntry({ ... }) } }`.
 * It defers on the reply line, so the task session's send and the board's
 * replay wait the same way. Two copies of one notice racing are acted on
 * once by the dedupe, a versioned write.
 */
export function taskSettledEntry(options: TaskSettledOptions) {
  return settledEntry(options, false);
}

/**
 * Both entries. On `onPostSettled` (`posts`) a post row's notice is
 * acknowledged (its dedupe key written, its marker cleared) only after the
 * coordinator's handling has run, so a failure there leaves it owed for the
 * board's next touch rather than losing the answer. The entry is queued on
 * the session, so a second copy waits behind the first and finds it no
 * longer owed.
 */
function settledEntry(options: TaskSettledOptions, posts: boolean) {
  /** Write the notice's dedupe key: `true` the first time. */
  const noteSeen = (ctx: BlockContext, key: string) =>
    withOutcome(
      (mutator: (state: Readonly<Record<string, unknown>>) => Record<string, unknown>) =>
        ctx.session.atomicState(mutator as never),
      (state: Readonly<Record<string, unknown>>) => {
        const seen = (state[TASK_NOTICES_STATE] ?? []) as string[];
        if (seen.includes(key)) return { state: {}, result: false };
        return { state: { [TASK_NOTICES_STATE]: [...seen, key].slice(-MAX_NOTICE_KEYS) }, result: true };
      }
    );

  /**
   * Whatever a run does, the notices still owed go out again behind it, but
   * never `notice`: its marker is cleared, or stays owed for its own entry.
   * Nor a waited-on row still owed its resume: its notice stays owed while the
   * resume fails, so two such rows would send each other's forever. A touch
   * of the board retries those, once per touch.
   */
  const replayOthers = (ctx: BlockContext, ref: NonNullable<Awaited<ReturnType<typeof ownConversationLedger>>>, notice: TaskNotice) =>
    replayNotices(
      ctx as never,
      ref
        .list()
        .filter((task) => !(task.wait != null && task.resumeOwed === true))
        .map((task) =>
          task.id === notice.taskId ? { ...task, metadata: { ...(task.metadata ?? {}), ...clearNotice(notice) } } : task
        )
    );

  /** Is the notice still owed, and the first time it is acted on? Then what does it do. */
  const settle = handler({
    name: "conversation-task-settled",
    inputSchema: taskNoticeSchema,
    outputSchema: settledSchema,
    sessionStateSchema: z.object(conversationBoardStateShape),
    resources: { ...taskChainResources },
    execute: async (notice: TaskNotice, ctx): Promise<Settled> => {
      if (notice.boardId !== CONVERSATION_LEDGER_ID) return { act: "none" };
      const ref = await ownConversationLedger(ctx as never);
      if (ref === undefined) return { act: "none" };
      // A top task that ended takes its chain's count with it (FIX-1802 S5):
      // a task filed in a session that is no piece of a chain is a top.
      if (notice.ending !== "retried" && notice.ending !== "parked" && taskChainOf(ctx) === undefined) {
        const ended = ref.get(notice.taskId);
        if (ended !== undefined && isTerminalStatus(ended.status)) {
          await deleteChain(ctx as never, { partition: await filingSessionIdOf(ctx.session), taskId: notice.taskId });
        }
      }
      const replayRest = () => replayOthers(ctx as never, ref, notice);
      const row = ref.get(notice.taskId);
      // A post row a user cancelled owes no notice; the board sends its
      // ending when it cancels it, and it is taken from the row's status. Its
      // handling only closes what the cancel lets close, so a copy sent again
      // changes nothing.
      const cancelledPost = posts && options.onPost !== undefined && isPostRow(row) && row!.status === "cancelled";
      if (cancelledPost && notice.ending === "cancelled") {
        const post = postRowOf(row);
        if (post === undefined) return { act: "none" };
        return { act: "post", post: { taskId: row!.id, ending: "cancelled", post } satisfies PostEnding };
      }
      // A notice its row doesn't owe was delivered already, or was never owed.
      if (row === undefined || !isNoticeOwed(row, notice)) {
        await replayRest();
        return { act: "none" };
      }
      const key = noticeKey(notice);
      // A post row's ending is the coordinator's, never the generic line. A
      // post has one attempt and nobody to ask, so it ends only one way of
      // three. Only `onPostSettled` acts on it: a copy sent here any other
      // way leaves it owed, and the replay sends it there.
      if (options.onPost !== undefined && isPostRow(row)) {
        if (!posts) {
          await replayNotices(ctx as never, ref.list().filter((task) => !(task.wait != null && task.resumeOwed === true)));
          return { act: "none" };
        }
        const acknowledged = ((ctx.session.state as Record<string, unknown>)[TASK_NOTICES_STATE] ?? []) as string[];
        const post = postRowOf(row);
        // Acknowledged already, by a run that stopped before clearing the
        // marker. A post that doesn't read can't be landed: its round closes at its deadline.
        if (
          acknowledged.includes(key) ||
          post === undefined ||
          (notice.ending !== "completed" && notice.ending !== "errored" && notice.ending !== "cancelled")
        ) {
          await noteSeen(ctx as never, key);
          await ref.patchMetadata(row.id, clearNotice(notice));
          await replayRest();
          return { act: "none" };
        }
        const ending: PostEnding = {
          taskId: row.id,
          ending: notice.ending,
          ...(notice.output !== undefined ? { output: notice.output } : {}),
          post
        };
        return { act: "post", post: ending, notice };
      }
      const first = await noteSeen(ctx as never, key);
      const decision = decideNotice(notice, options.policy(ctx as never));
      // A waited-on row's ending: resume the turn parked on it, with no line and
      // no turn. Every copy tries: the gate admits one answer. The owed notice
      // is what carries the resume across a touch, so it clears only once the
      // row no longer owes it (the resume was accepted, or the gate had
      // already been resolved). A resume turned away (`busy`) or thrown, or a
      // process that dies first, leaves the notice owed, and the board's next
      // touch sends it again (BR-11). The resolver never resumes itself: it
      // runs inside a turn.
      if (decision.act === "resume-wait") {
        try {
          await resumeOwedWaits(ctx as never, ref);
        } catch {
          // Still owed: the notice stays, for the next touch.
        }
        if (ref.get(row.id)?.resumeOwed !== true) await ref.patchMetadata(row.id, clearNotice(notice));
        await replayRest();
        return { act: first === true ? "resume-wait" : "none" };
      }
      // Delivered: the marker clears whichever copy of the notice got here.
      await ref.patchMetadata(row.id, clearNotice(notice));
      await replayRest();
      if (first !== true) return { act: "none" };
      // A piece's failure for good wakes the turn that may file it again.
      if (decision.act === "wake-turn") await noteFailedPiece(ctx as never, row);
      return {
        act: decision.act,
        text: noticeText(notice, row),
        ...(row.assignee !== undefined ? { worker: row.assignee } : {})
      };
    }
  });

  /** An ending, as a line in the conversation, under the delegate's name. */
  const line = handler({
    name: "conversation-task-line",
    inputSchema: settledSchema,
    outputSchema: z.object({}),
    execute: (settled: Settled, ctx) => {
      ctx.emit.message(settled.text ?? "", settled.worker !== undefined ? { agentName: settled.worker } : {});
      return {};
    }
  });

  /** The coordinator's handling of a post row's ending ran: acknowledge its notice. */
  const acknowledge = handler({
    name: "conversation-post-acknowledged",
    inputSchema: settledSchema,
    outputSchema: z.object({}),
    sessionStateSchema: z.object(conversationBoardStateShape),
    execute: async (settled: Settled, ctx) => {
      const notice = settled.notice as TaskNotice;
      const ref = await ownConversationLedger(ctx as never);
      await noteSeen(ctx as never, noticeKey(notice));
      if (ref === undefined) return {};
      await ref.patchMetadata(notice.taskId, clearNotice(notice));
      await replayOthers(ctx as never, ref, notice);
      return {};
    }
  });

  /** The turn a notice wakes, its answer kept for a split task's settle below. */
  const wokenTurn = sequencer({ name: "conversation-woken-turn", inputSchema: z.object({ message: z.string() }) })
    .step(options.turn)
    .tap(noteWokenAnswer);

  const block = sequencer({ name: "conversation-on-task-settled", inputSchema: taskNoticeSchema })
    .step(settle)
    .tapIf((settled: Settled) => settled.act === "line" || settled.act === "wake-turn", line)
    .tapIf(
      (settled: Settled) => settled.act === "wake-turn",
      (settled: Settled) => ({ message: settled.text ?? "" }),
      wokenTurn
    )
    .tapIf((settled: Settled) => settled.act === "run-board", options.runBoard);
  const withPosts = (
    options.onPost === undefined
      ? block
      : block
          .tapIf(
            (settled: Settled) => settled.act === "post",
            (settled: Settled) => settled.post as PostEnding,
            options.onPost
          )
          .tapIf((settled: Settled) => settled.act === "post" && settled.notice !== undefined, acknowledge)
  )
    // In a task session whose task waits on its pieces: settle it once none
    // is open, after any turn this notice woke, never inside it (FIX-1802
    // S4), with that turn's answer. A turn that failed leaves it for the next
    // touch.
    .tap(settleSplitBlock);

  return { inputSchema: taskNoticeSchema, block: withPosts, concurrency: AFTER_REPLY_CONCURRENCY };
}

/**
 * Build the `onPostSettled` internal entry: {@link taskSettledEntry}'s
 * dedupe and dispatch for a post row's ending, acknowledged once the
 * dispatch has run, and queued on the session rather than deferred on the
 * reply line, so a delegate's answer lands while a reply runs.
 */
export function postSettledEntry(options: TaskSettledOptions & { readonly onPost: BlockDefinition<any, any> }) {
  return { ...settledEntry(options, true), concurrency: "queue" as const };
}
