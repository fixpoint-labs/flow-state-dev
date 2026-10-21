/**
 * How a conversation hears a task it filed end (FIX-1794 S7, FIX-2078): the
 * internal entries its notices arrive on.
 *
 * - **`onTaskSettled`** is orchestration's entry (`taskSettledEntry`), which
 *   admits a notice only while its row still owes it and acknowledges it once
 *   this handling has run. Workforce supplies the handling: deduped by task,
 *   attempt and ending, then the one decision (`decideNotice`): any ending
 *   lands as a line under the delegate's name and, when its coordinator has a
 *   turn of its own (judgment or best-fit routing), wakes that turn to read it
 *   and decide. A task that failed for good is reported to the Error Reporter
 *   first, before the notice is acknowledged, so a report the intake didn't
 *   take goes again with the notice (epic decision (f)). A notice stored before
 *   FIX-2078 for a retry, or for a waited-on row, runs the board's pass, which
 *   starts the attempt or resumes the turn.
 * - **`onPostSettled`** is a post row's (`../coordinator/delegated-post`), until
 *   FIX-2083 routes posts: acknowledged only after the coordinator's handling
 *   has run, so a failure there leaves the answer owed.
 *
 * An ending frees its session (FIX-2080), so each notice also runs the board's
 * pass when a row is startable: the pass, not this entry, starts it.
 *
 * A notice that arrives while the conversation is replying waits for the
 * reply to end, then runs (BR-27): the engine's `defer` patience. At most 32
 * notices wait on a conversation in a process; the engine refuses the next,
 * which stays owed on its row for the conversation's pass, once past due.
 *
 * Refused when the conversation's worker was fired: the flow loads the
 * session's worker before any entry runs. The task's ending stands, and the
 * notice stays owed on its row.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import { withOutcome } from "@flow-state-dev/core/helpers";
import { taskSettledEntry as orchestrationTaskSettledEntry } from "@flow-state-dev/orchestration";
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
import { triggerPass, wakeIfStartable } from "./board";
import { deleteChain, taskChainOf, taskChainResources } from "./chain";
import { filingSessionIdOf } from "./filing-session";
import { CONVERSATION_LEDGER_ID, ownConversationLedger } from "./ledger";
import { sendTaskReport } from "./report-owed";
import { noteTaskAnswer } from "@flow-state-dev/orchestration/task-board";
import { admitOwnTask } from "./task-admission";

/** A notice, as the entries take it. */
export const taskNoticeSchema = z
  .object({
    boardId: z.string().min(1),
    taskId: z.string().min(1),
    attempt: z.number().int().nonnegative(),
    ending: z.enum(["completed", "errored", "parked", "retried", "cancelled"]),
    output: z.unknown().optional(),
    error: z.string().optional(),
    question: z.string().optional(),
    asked: z.literal(true).optional(),
    cancelled: z.array(z.string()).optional()
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

/** {@link conversationBoardStateShape}'s fields, for the flow's `session.serverOwned`: only the board writes them. */
export const CONVERSATION_BOARD_SERVER_OWNED: readonly string[] = [TASK_NOTICES_STATE];

const settledSchema = z.object({
  act: z.enum(["none", "run-board", "wake-turn", "line", "post"]),
  text: z.string().optional(),
  worker: z.string().optional(),
  /** On a post row's ending: what the coordinator's handling is handed. */
  post: z.unknown().optional(),
  /** On a post row's ending: the notice, acknowledged once the coordinator's handling has run. */
  notice: taskNoticeSchema.optional()
});

type Settled = z.infer<typeof settledSchema>;

/** What the entries are built from. */
export interface TaskSettledOptions {
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

/** Set on each entry that waits for the conversation's turn: a task's notice, and a worker's message. */
export const AFTER_REPLY_CONCURRENCY = { policy: "defer", key: replyLine } as const satisfies ConcurrencyConfig;

/** The board's pass, keyed on its session alone: no other entry holds this key. */
const passLine: ConcurrencyKey = (ctx) =>
  ctx.sessionId === undefined ? undefined : `${ctx.tenantId ?? ""}\u0000pass\u0000${ctx.sessionId}`;

/**
 * Set on the board's run entry (FIX-2078): one pass at a time per session. A
 * second waits until the running one ends, then runs as a request of its own,
 * which reads what was written meanwhile: a pass reads its board once per
 * request, so a running pass can't see a retry or an ending another request
 * writes, and a second refused outright would leave that start to the wake.
 */
export const PASS_CONCURRENCY = { policy: "defer", key: passLine } as const satisfies ConcurrencyConfig;

/** Write a notice's dedupe key: `true` the first time. */
function noteSeen(ctx: BlockContext, key: string) {
  return withOutcome(
    (mutator: (state: Readonly<Record<string, unknown>>) => Record<string, unknown>) =>
      ctx.session.atomicState(mutator as never),
    (state: Readonly<Record<string, unknown>>) => {
      const seen = (state[TASK_NOTICES_STATE] ?? []) as string[];
      if (seen.includes(key)) return { state: {}, result: false };
      return { state: { [TASK_NOTICES_STATE]: [...seen, key].slice(-MAX_NOTICE_KEYS) }, result: true };
    }
  );
}

/**
 * What every notice does first, task or post: free the session it ran in, and
 * end the chain count of a top task that ended (FIX-1802 S5).
 */
async function onEnding(ctx: BlockContext, notice: TaskNotice): Promise<void> {
  const ref = await ownConversationLedger(ctx);
  if (ref === undefined) return;
  if (notice.ending !== "retried") await wakeIfStartable(ctx, ref);
  if (notice.ending !== "retried" && notice.ending !== "parked" && taskChainOf(ctx) === undefined) {
    const ended = ref.get(notice.taskId);
    if (ended !== undefined && isTerminalStatus(ended.status)) {
      await deleteChain(ctx, { partition: await filingSessionIdOf(ctx.session), taskId: notice.taskId });
    }
  }
}

/**
 * A final failure's report, before its notice is acknowledged (decision (f)).
 * Throws when the intake didn't take it, so the notice stays owed and the
 * report goes again with it.
 */
async function reportFailure(ctx: BlockContext, notice: TaskNotice): Promise<void> {
  if (notice.ending !== "errored") return;
  const ref = await ownConversationLedger(ctx);
  const row = ref?.get(notice.taskId);
  if (row === undefined) return;
  const outcome = await sendTaskReport(
    ctx,
    row,
    { attempt: notice.attempt, error: notice.error ?? "" },
    { boardId: CONVERSATION_LEDGER_ID, partition: await filingSessionIdOf(ctx.session) },
    "conversation-task-report"
  );
  if (outcome === "not-taken") {
    throw new Error(`The Error Reporter didn't take task "${notice.taskId}"'s failure yet; its notice stays owed.`);
  }
}

/**
 * The turn a notice wakes. In a task session whose task waits on its pieces,
 * its answer is noted as the task's result for the check at the request's end
 * (FIX-2077); anywhere else the note is nothing.
 */
function wokenTurnOf(options: TaskSettledOptions) {
  return sequencer({ name: "conversation-woken-turn", inputSchema: z.object({ message: z.string() }) })
    .step(options.turn)
    .tap(noteTaskAnswer);
}

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

/** Run the board's pass in this conversation: one at a time, never inline. */
const runPass = handler({
  name: "conversation-task-run-pass",
  inputSchema: z.unknown(),
  outputSchema: z.object({}),
  execute: async (_input, ctx) => {
    await triggerPass(ctx as never);
    return {};
  }
});

/**
 * Build the `onTaskSettled` internal entry: orchestration's entry, with the
 * conversation's handling. It defers on the reply line, so the writer's send
 * and the pass's resend wait the same way; two copies of one notice are acted
 * on once by the dedupe, a versioned write.
 */
export function taskSettledEntry(options: TaskSettledOptions) {
  const settle = handler({
    name: "conversation-task-settled",
    inputSchema: taskNoticeSchema,
    outputSchema: settledSchema,
    sessionStateSchema: z.object(conversationBoardStateShape),
    resources: { ...taskChainResources },
    execute: async (notice: TaskNotice, rawCtx): Promise<Settled> => {
      const ctx = rawCtx as unknown as BlockContext;
      if (notice.boardId !== CONVERSATION_LEDGER_ID) return { act: "none" };
      const ref = await ownConversationLedger(ctx);
      const row = ref?.get(notice.taskId);
      if (ref === undefined || row === undefined) return { act: "none" };
      await onEnding(ctx, notice);
      await reportFailure(ctx, notice);
      const first = await noteSeen(ctx, noticeKey(notice));
      // Acknowledged here, once reported and deduped, before what it wakes: the
      // check at this request's end reads a piece whose notice is still owed as
      // holding its task (FIX-2077).
      await ref.patchMetadata(row.id, clearNotice(notice));
      const decision = decideNotice(notice, options.policy(ctx));
      // A waited-on row's turn, or a retry's next attempt: the pass's, which
      // resumes it or starts it. Every copy runs it; the pass is one at a time.
      if (decision.act === "resume-wait" || decision.act === "run-board") return { act: "run-board" };
      if (first !== true) return { act: "none" };
      return {
        act: decision.act,
        text: noticeText(notice, row),
        ...(row.assignee !== undefined ? { worker: row.assignee } : {})
      };
    }
  });

  const handling = sequencer({ name: "conversation-on-task-settled", inputSchema: taskNoticeSchema })
    // In a task session whose task waits (its pieces, FIX-2077): this request
    // runs for the task, and the task is checked at its end, after any turn
    // this notice wakes, with that turn's answer. First, before any await.
    .tap(admitOwnTask("conversation-task-settled-admission", true))
    .step(settle)
    .tapIf((settled: Settled) => settled.act === "line" || settled.act === "wake-turn", line)
    .tapIf(
      (settled: Settled) => settled.act === "wake-turn",
      (settled: Settled) => ({ message: settled.text ?? "" }),
      wokenTurnOf(options)
    )
    .tapIf((settled: Settled) => settled.act === "run-board", runPass);

  return orchestrationTaskSettledEntry({ block: handling, concurrency: AFTER_REPLY_CONCURRENCY });
}

/**
 * Build the `onPostSettled` internal entry: a post row's ending, deduped, acted
 * on by the coordinator's handling, and acknowledged once that has run, queued
 * on the session rather than deferred on the reply line, so a delegate's answer
 * lands while a reply runs. A post that failed for good is reported to the
 * Error Reporter first, best effort (decision (f), FIX-2010): the coordinator
 * hears the ending whether or not the intake took it. Until FIX-2083.
 */
export function postSettledEntry(options: TaskSettledOptions & { readonly onPost: BlockDefinition<any, any> }) {
  const settle = handler({
    name: "conversation-post-settled",
    inputSchema: taskNoticeSchema,
    outputSchema: settledSchema,
    sessionStateSchema: z.object(conversationBoardStateShape),
    resources: { ...taskChainResources },
    execute: async (notice: TaskNotice, rawCtx): Promise<Settled> => {
      const ctx = rawCtx as unknown as BlockContext;
      if (notice.boardId !== CONVERSATION_LEDGER_ID) return { act: "none" };
      const ref = await ownConversationLedger(ctx);
      if (ref === undefined) return { act: "none" };
      await onEnding(ctx, notice);
      const row = ref.get(notice.taskId);
      if (!isPostRow(row)) return { act: "none" };
      // A post row a user cancelled: its handling only closes what the cancel
      // lets close, so a copy sent again changes nothing.
      if (row!.status === "cancelled" && notice.ending === "cancelled" && !isNoticeOwed(row!, notice)) {
        const post = postRowOf(row);
        if (post === undefined) return { act: "none" };
        return { act: "post", post: { taskId: row!.id, ending: "cancelled", post } satisfies PostEnding };
      }
      // A notice its row doesn't owe was delivered already, or was never owed.
      if (!isNoticeOwed(row!, notice)) return { act: "none" };
      // Best effort on a post (FIX-2010): the coordinator hears its ending
      // whether or not the intake took the report.
      await reportFailure(ctx, notice).catch(() => undefined);
      const key = noticeKey(notice);
      const acknowledged = ((ctx.session.state as Record<string, unknown>)[TASK_NOTICES_STATE] ?? []) as string[];
      const post = postRowOf(row);
      // Acknowledged already, by a run that stopped before clearing the
      // marker. A post that doesn't read can't be landed: its round closes at its deadline.
      if (
        acknowledged.includes(key) ||
        post === undefined ||
        (notice.ending !== "completed" && notice.ending !== "errored" && notice.ending !== "cancelled")
      ) {
        await noteSeen(ctx, key);
        await ref.patchMetadata(row!.id, clearNotice(notice));
        return { act: "none" };
      }
      const ending: PostEnding = {
        taskId: row!.id,
        ending: notice.ending,
        ...(notice.output !== undefined ? { output: notice.output } : {}),
        post
      };
      return { act: "post", post: ending, notice: notice as Settled["notice"] };
    }
  });

  /** The coordinator's handling of a post row's ending ran: acknowledge its notice. */
  const acknowledge = handler({
    name: "conversation-post-acknowledged",
    inputSchema: settledSchema,
    outputSchema: z.object({}),
    sessionStateSchema: z.object(conversationBoardStateShape),
    execute: async (settled: Settled, rawCtx) => {
      const ctx = rawCtx as unknown as BlockContext;
      const notice = settled.notice as TaskNotice;
      const ref = await ownConversationLedger(ctx);
      await noteSeen(ctx, noticeKey(notice));
      await ref?.patchMetadata(notice.taskId, clearNotice(notice));
      return {};
    }
  });

  const block = sequencer({ name: "conversation-on-post-settled", inputSchema: taskNoticeSchema })
    .step(settle)
    .tapIf(
      (settled: Settled) => settled.act === "post",
      (settled: Settled) => settled.post as PostEnding,
      options.onPost
    )
    .tapIf((settled: Settled) => settled.act === "post" && settled.notice !== undefined, acknowledge);

  return { inputSchema: taskNoticeSchema, block, concurrency: "queue" as const };
}
