/**
 * How a conversation hears a task it filed end (FIX-1794 S7): the internal
 * entry its notices arrive on, `onTaskSettled`.
 *
 * Deduped by task, attempt and ending, which absorbs the replays the board's
 * outbox sends: a notice is acted on only while its row still owes it, and
 * only once. Then the one decision (`decideNotice`) is acted on: a retried
 * attempt runs the board again with no turn; an asked row's ending resumes
 * the turn parked on it (`waitForResponse`), with no line and no turn woken;
 * any other ending lands as a line under the delegate's name and, when its
 * coordinator has a turn of its own (judgment or best-fit routing), wakes
 * that turn to read it and decide what to do.
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
import { resumeOwedAsks } from "@flow-state-dev/orchestration";
import {
  clearNotice,
  decideNotice,
  isNoticeOwed,
  noticeKey,
  noticeText,
  type NoticePolicy,
  type TaskNotice
} from "@flow-state-dev/orchestration/tasks";
import type { BlockContext, BlockDefinition, ConcurrencyConfig, ConcurrencyKey } from "@flow-state-dev/core/types";
import { z } from "zod";
import { isTaskSession, replayNotices } from "./board";
import { CONVERSATION_LEDGER_ID, ownConversationLedger } from "./ledger";

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
  [TASK_NOTICES_STATE]: z.array(z.string()).default([])
} as const;

const settledSchema = z.object({
  act: z.enum(["none", "run-board", "wake-turn", "line", "resume-ask"]),
  text: z.string().optional(),
  worker: z.string().optional()
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
}

/**
 * Not `"session"`. Delegate answers are `queue` on that key, and a queued
 * request gives up after 30 seconds. NUL bytes stay off any session id.
 */
const replyLine: ConcurrencyKey = (ctx) =>
  ctx.sessionId === undefined ? undefined : `${ctx.tenantId ?? ""}\u0000reply\u0000${ctx.sessionId}`;

/** Set on each entry that runs the conversation's turn: a task's notice waits for it, within the bound above. */
export const REPLY_CONCURRENCY = { policy: "hold", key: replyLine } as const satisfies ConcurrencyConfig;

/**
 * Build the `onTaskSettled` internal entry: spread it as
 * `internal: { actions: { [TASK_SETTLED_ENTRY]: taskSettledEntry({ ... }) } }`.
 * It defers on the reply line, so the task session's send and the board's
 * replay wait the same way. Two copies of one notice racing are acted on
 * once by the dedupe, a versioned write.
 */
export function taskSettledEntry(options: TaskSettledOptions) {
  /** Is the notice still owed, and the first time it is acted on? Then what does it do. */
  const settle = handler({
    name: "conversation-task-settled",
    inputSchema: taskNoticeSchema,
    outputSchema: settledSchema,
    sessionStateSchema: z.object(conversationBoardStateShape),
    execute: async (notice: TaskNotice, ctx): Promise<Settled> => {
      if (notice.boardId !== CONVERSATION_LEDGER_ID || isTaskSession(ctx)) return { act: "none" };
      const ref = await ownConversationLedger(ctx as never);
      if (ref === undefined) return { act: "none" };
      // Whatever this run does, the notices still owed go out again behind
      // it, but never this one: its marker is cleared below, or already was.
      // Nor an asked row still owed its resume: its notice stays owed while
      // the resume fails, so two such rows would send each other's forever.
      // A touch of the board retries those, once per touch.
      const replayRest = () =>
        replayNotices(
          ctx as never,
          ref
            .list()
            .filter((task) => !(task.ask != null && task.resumeOwed === true))
            .map((task) =>
              task.id === notice.taskId ? { ...task, metadata: { ...(task.metadata ?? {}), ...clearNotice(notice) } } : task
            )
        );
      const row = ref.get(notice.taskId);
      // A notice its row doesn't owe was delivered already, or was never owed.
      if (row === undefined || !isNoticeOwed(row, notice)) {
        await replayRest();
        return { act: "none" };
      }
      const key = noticeKey(notice);
      const first = await withOutcome(
        (mutator: (state: Readonly<Record<string, unknown>>) => Record<string, unknown>) =>
          ctx.session.atomicState(mutator as never),
        (state: Readonly<Record<string, unknown>>) => {
          const seen = (state[TASK_NOTICES_STATE] ?? []) as string[];
          if (seen.includes(key)) return { state: {}, result: false };
          return { state: { [TASK_NOTICES_STATE]: [...seen, key].slice(-MAX_NOTICE_KEYS) }, result: true };
        }
      );
      const decision = decideNotice(notice, options.policy(ctx as never));
      // An asked row's ending: resume the turn parked on it, with no line and
      // no turn. Every copy tries: the gate admits one answer. The owed notice
      // is what carries the resume across a touch, so it clears only once the
      // row no longer owes it (the resume was accepted, or the gate had
      // already been resolved). A resume turned away (`busy`) or thrown, or a
      // process that dies first, leaves the notice owed, and the board's next
      // touch sends it again (BR-11). The resolver never resumes itself: it
      // runs inside a turn.
      if (decision.act === "resume-ask") {
        try {
          await resumeOwedAsks(ctx as never, ref);
        } catch {
          // Still owed: the notice stays, for the next touch.
        }
        if (ref.get(row.id)?.resumeOwed !== true) await ref.patchMetadata(row.id, clearNotice(notice));
        await replayRest();
        return { act: first === true ? "resume-ask" : "none" };
      }
      // Delivered: the marker clears whichever copy of the notice got here.
      await ref.patchMetadata(row.id, clearNotice(notice));
      await replayRest();
      if (first !== true) return { act: "none" };
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

  const block = sequencer({ name: "conversation-on-task-settled", inputSchema: taskNoticeSchema })
    .step(settle)
    .tapIf((settled: Settled) => settled.act === "line" || settled.act === "wake-turn", line)
    .tapIf(
      (settled: Settled) => settled.act === "wake-turn",
      (settled: Settled) => ({ message: settled.text ?? "" }),
      options.turn
    )
    .tapIf((settled: Settled) => settled.act === "run-board", options.runBoard);

  return { inputSchema: taskNoticeSchema, block, concurrency: { policy: "defer", key: replyLine } as const satisfies ConcurrencyConfig };
}
