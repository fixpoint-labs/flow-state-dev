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
 * - **A task whose result goes to the conversation** (`resultTo:
 *   "conversation"`, a routed task among them, FIX-2083): its answer wakes no
 *   turn, and lands as a line under the delegate's name. A conversation that
 *   routes messages hands its completion to its own handling instead
 *   ({@link TaskSettledOptions.onRouted}: the line, and the rounds it feeds),
 *   and a routed round's failure or cancel too, and acknowledges the notice
 *   only once that has run, so a failure there leaves the answer owed. A
 *   failure or cancel of one with no routed brief (a routed task's follow-up,
 *   FIX-2122) is in no round: it is heard as any task's the conversation
 *   filed, by the one decision above. A routed failure whose brief names
 *   the judgment turn's filing call ({@link filedByTurn}) is said after the
 *   routing's handling too, under the same decision (FIX-2115): the routing
 *   itself only ends that delegate's part.
 *
 * An ending frees its session (FIX-2080), so each notice also runs the board's
 * pass when a row is startable: the pass, not this entry, starts it.
 *
 * A user's running turn may take a notice itself after it answers
 * (FIX-2159, `./take-finished`): it runs this same handling
 * ({@link settleTakenNotice}) in its own request and says the line there, and
 * the copy queued here then finds the notice cleared.
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
  noticeKey,
  noticeText,
  type NoticePolicy,
  type Task,
  type TaskCollectionRef,
  type TaskNotice
} from "@flow-state-dev/orchestration/tasks";
import type { BlockContext, BlockDefinition, ConcurrencyConfig, ConcurrencyKey } from "@flow-state-dev/core/types";
import { z } from "zod";
import { filedByTurn, routedBriefOf, routedBriefSchema } from "../coordinator/routed-brief";
import { triggerPass, wakeIfStartable } from "./board";
import { deleteChain, taskChainOf, taskChainResources } from "./chain";
import { filingSessionIdOf } from "./filing-session";
import { CONVERSATION_LEDGER_ID, ownConversationLedger } from "./ledger";
import { sendTaskReport } from "./report-owed";
import { noteTaskAnswer } from "@flow-state-dev/orchestration/task-board";
import { admitOwnTask } from "./task-admission";
import { anotherTurnWaitsOnItsPlan } from "./plan";

/** A notice, as the entries take it. */
export const taskNoticeSchema = z
  .object({
    boardId: z.string().min(1),
    taskId: z.string().min(1),
    attempt: z.number().int().nonnegative(),
    ending: z.enum(["completed", "errored", "retried", "cancelled"]),
    output: z.unknown().optional(),
    error: z.string().optional(),
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
  act: z.enum(["none", "run-board", "wake-turn", "line"]),
  text: z.string().optional(),
  worker: z.string().optional(),
  /** On a routed ending: what the conversation's routing is handed. */
  routed: z.unknown().optional(),
  /** On a routed ending: the notice, acknowledged once the routing's handling has run. `act` is what is said after that. */
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
   * A conversation-result task's completion, and a routed round's failure or
   * cancel, acted on once like any notice, and handed here instead of a line
   * ({@link RoutedEnding}): a coordinator's routing lands the answer and feeds
   * its rounds (FIX-2083). A failure or cancel of a row with no routed brief
   * (a routed task's follow-up, FIX-2122) is in no round, and is never handed
   * here: it is heard as any task's the conversation filed. A failure of a
   * task the coordinator's own turn filed ({@link filedByTurn}) is handed here
   * too, and then also lands as a line and wakes that turn (FIX-2115).
   */
  readonly onRouted?: BlockDefinition<any, any>;
}

/** What a conversation-result task's ending hands {@link TaskSettledOptions.onRouted}. */
export const routedEndingSchema = z.object({
  taskId: z.string(),
  ending: z.enum(["completed", "errored", "cancelled"]),
  /** The row's output: the delegate's answer, on a completed row. */
  output: z.unknown().optional(),
  /** The delegate it went to. */
  assignee: z.string().optional(),
  /** The row's server-written brief, when it was routed: its message and round. */
  brief: routedBriefSchema.optional()
});

export type RoutedEnding = z.infer<typeof routedEndingSchema>;

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
 * What every notice does first: free the session it ran in, and end the
 * chain count of a top task that ended (FIX-1802 S5).
 */
async function onEnding(ctx: BlockContext, notice: TaskNotice): Promise<void> {
  const ref = await ownConversationLedger(ctx);
  if (ref === undefined) return;
  if (notice.ending !== "retried") await wakeIfStartable(ctx, ref);
  if (notice.ending !== "retried" && taskChainOf(ctx) === undefined) {
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
 * The part of a notice's handling every taker of it runs, before what it
 * says: free its session, end its chain count, and report a final failure
 * (throws when the intake didn't take it, so the notice stays owed).
 */
async function beforeAcknowledge(ctx: BlockContext, notice: TaskNotice): Promise<void> {
  await onEnding(ctx, notice);
  await reportFailure(ctx, notice);
}

/**
 * Dedupe a notice and acknowledge it (clear its marker): `true` the first
 * time this conversation acts on it. The point of no return is the dedupe
 * write: a copy that takes the notice over after it finds the key seen and
 * says nothing (at most once).
 */
async function acknowledgeOnce(ctx: BlockContext, ref: TaskCollectionRef, row: Task, notice: TaskNotice): Promise<boolean> {
  const first = await noteSeen(ctx, noticeKey(notice));
  await ref.patchMetadata(row.id, clearNotice(notice));
  return first === true;
}

/**
 * A notice a user's running turn took itself (FIX-2159), handled as
 * `onTaskSettled` handles one: the same steps, in the same order, so the
 * ending is heard once whichever request took it. Only what is said
 * differs: the caller says the line in its own request rather than waking a
 * turn. `true` when this is the first time the conversation acts on it, so
 * the line is the caller's to say. Throws when the Error Reporter didn't take
 * a final failure: the notice stays taken by the running request, and the
 * queued copy takes it over once that request ends.
 */
export async function settleTakenNotice(ctx: BlockContext, ref: TaskCollectionRef, row: Task, notice: TaskNotice): Promise<boolean> {
  await beforeAcknowledge(ctx, notice);
  return acknowledgeOnce(ctx, ref, row, notice);
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

/** A conversation-result task's answer as it lands: the delegate's reply itself, or the ending in words. */
function resultLine(notice: TaskNotice, row: { goal: string; title?: string; assignee?: string }): string {
  if (notice.ending === "completed" && typeof notice.output === "string" && notice.output.trim() !== "") return notice.output;
  return noticeText(notice, row);
}

/**
 * Build the `onTaskSettled` internal entry: orchestration's entry, with the
 * conversation's handling. It defers on the reply line, so the writer's send
 * and the pass's resend wait the same way; two copies of one notice are acted
 * on once by the dedupe, a versioned write.
 */
export function taskSettledEntry(options: TaskSettledOptions) {
  /**
   * A conversation-result task's ending (FIX-2083). With a routing layer, a
   * completion goes to it, and a routed round's failure or cancel too, and the
   * notice is acknowledged after; `act` is what is said then. A failure of a
   * task the coordinator's own turn filed ({@link filedByTurn}) is said, and
   * wakes that turn under the conversation's policy, as any task the turn
   * filed does, so it can file the work again (FIX-2115). A cancel of one is
   * not: whoever cancelled it knows, as FIX-2083's cancel rule has it. A
   * policy's round says nothing after its routing: its failure only ends that
   * delegate's part. Anything else, and any ending with no routing layer,
   * lands as a line now.
   */
  const settleConversationResult = async (ctx: BlockContext, ref: TaskCollectionRef, row: Task, notice: TaskNotice): Promise<Settled> => {
    const key = noticeKey(notice);
    const acted = ((ctx.session.state as Record<string, unknown>)[TASK_NOTICES_STATE] ?? []) as string[];
    // Acted on already, by a run that stopped before clearing the marker.
    if (acted.includes(key)) {
      await ref.patchMetadata(row.id, clearNotice(notice));
      return { act: "none" };
    }
    const brief = routedBriefOf(row);
    // A row with no routed brief (a routed task's follow-up, FIX-2122) is in
    // no round: its answer goes to the routing, which lands it, and its failure
    // or cancel is heard as any task's the conversation filed is: a line, and
    // the coordinator's turn when its routing runs one (`decideNotice`).
    const unrouted = brief === undefined && (notice.ending === "errored" || notice.ending === "cancelled");
    const routes = notice.ending === "completed" || (brief !== undefined && (notice.ending === "errored" || notice.ending === "cancelled"));
    if (options.onRouted !== undefined && routes) {
      const routed: RoutedEnding = {
        taskId: row.id,
        ending: notice.ending,
        ...(notice.output !== undefined ? { output: notice.output } : {}),
        ...(row.assignee !== undefined ? { assignee: row.assignee } : {}),
        ...(brief !== undefined ? { brief } : {})
      };
      if (notice.ending === "errored" && filedByTurn(brief)) {
        const act = decideNotice(notice, options.policy(ctx)).act === "wake-turn" ? "wake-turn" : "line";
        return { act, routed, notice: notice as Settled["notice"], text: noticeText(notice, row), ...(row.assignee !== undefined ? { worker: row.assignee } : {}) };
      }
      // `none` still carries `notice`: the routing runs, and nothing is said after it.
      return { act: "none", routed, notice: notice as Settled["notice"] };
    }
    const first = await noteSeen(ctx, key);
    await ref.patchMetadata(row.id, clearNotice(notice));
    if (first !== true) return { act: "none" };
    const act = unrouted && decideNotice(notice, options.policy(ctx)).act === "wake-turn" ? "wake-turn" : "line";
    return { act, text: resultLine(notice, row), ...(row.assignee !== undefined ? { worker: row.assignee } : {}) };
  };

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
      await beforeAcknowledge(ctx, notice);
      if (row.resultTo === "conversation" && notice.ending !== "retried" && notice.asked !== true) {
        return settleConversationResult(ctx, ref, row, notice);
      }
      // Acknowledged here, once reported and deduped, before what it wakes: the
      // check at this request's end reads a piece whose notice is still owed as
      // holding its task (FIX-2077).
      const first = await acknowledgeOnce(ctx, ref, row, notice);
      const decision = decideNotice(notice, options.policy(ctx));
      // A waited-on row's turn, or a retry's next attempt: the pass's, which
      // resumes it or starts it. Every copy runs it; the pass is one at a time.
      if (decision.act === "resume-wait" || decision.act === "run-board") return { act: "run-board" };
      if (!first) return { act: "none" };
      return {
        act: decision.act,
        text: noticeText(notice, row),
        ...(row.assignee !== undefined ? { worker: row.assignee } : {})
      };
    }
  });

  /** The routing's handling of a conversation-result task's ending ran: acknowledge its notice. */
  const acknowledge = handler({
    name: "conversation-routed-acknowledged",
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

  let handling = sequencer({ name: "conversation-on-task-settled", inputSchema: taskNoticeSchema })
    // In a task session whose task waits (its pieces, FIX-2077): this request
    // runs for the task, and the task is checked at its end, after any turn
    // this notice wakes, with that turn's answer. First, before any await.
    .tap(admitOwnTask("conversation-task-settled-admission", true))
    .step(settle)
    .tapIf((settled: Settled) => settled.act === "run-board", runPass);
  if (options.onRouted !== undefined) {
    const routedEnding = (settled: Settled) => settled.notice !== undefined;
    handling = handling
      .tapIf(routedEnding, (settled: Settled) => settled.routed as RoutedEnding, options.onRouted)
      .tapIf(routedEnding, acknowledge);
  }
  // Said after a routed acknowledgement, as a filed task's ending is said after
  // its own: a stop between them loses the line, never says it twice.
  handling = handling
    .tapIf((settled: Settled) => settled.act === "line" || settled.act === "wake-turn", line)
    .tapIf(
      (settled: Settled) => settled.act === "wake-turn",
      (settled: Settled) => ({ message: settled.text ?? "" }),
      wokenTurnOf(options)
    );

  return orchestrationTaskSettledEntry({
    block: handling,
    concurrency: AFTER_REPLY_CONCURRENCY,
    // One turn of a task at a time in its session (FIX-2113): while another
    // request here waits on a step of its own plan, the notice stays owed,
    // and that request sends it once it answers.
    defer: (ctx) => anotherTurnWaitsOnItsPlan(ctx)
  });
}
