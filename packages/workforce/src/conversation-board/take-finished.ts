/**
 * What finished while a user's turn ran (FIX-2159): the take that hands a
 * running turn the endings of the tasks its conversation filed, so the worker
 * can answer again with them in the same request, rather than hear them after
 * the reply as a turn of their own.
 *
 * - **{@link takeFinishedTasks}** takes each ending through the take record
 *   `onTaskSettled` uses (orchestration's `takeOwedNotice`, FIX-2123), in the
 *   running request's name, and handles it with the conversation's own
 *   handling of a notice (`settleTakenNotice`): its session freed, a final
 *   failure reported, deduped and acknowledged. It then says the line under
 *   the delegate's name in this request, and hands the line back. The copy
 *   `onTaskSettled` queued for after the turn finds the notice cleared and
 *   does nothing, so each ending is heard once.
 * - **{@link finishedTasksAnswerAgain}** is the pre-built source for the
 *   answer-again step (`defineAgentWorkerFlow({ answerAgain: true })`): the
 *   take, then the lines as the message the worker answers again about.
 *
 * Only a turn a user's own message started takes anything (`isUserTurn`):
 * in a task session the queued handling also does the task's own ending work,
 * and a worker talking to a worker keeps its turn order. Everywhere else the
 * take hands over nothing, and endings arrive after the turn, as before.
 *
 * Which endings: the ones the queued handling says as a line or a woken turn,
 * for a task whose result goes to the filer. A completion, a final failure, a
 * cancel someone else made, a park that asks. Never a routed result
 * (`resultTo: "conversation"`), a retry, an ending held for a request that
 * waited, or a waited-on row's ending: those keep their own paths.
 *
 * At most once, as the queued handling is: a stop after the dedupe write
 * drops the line, and a stop before it leaves the notice taken by this
 * request, for the queued copy to take over once it ends. A final failure the
 * Error Reporter didn't take stops the take before the acknowledgement, the
 * same way.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext, BlockDefinition } from "@flow-state-dev/core/types";
import { takeOwedNotice } from "@flow-state-dev/orchestration";
import {
  decideNotice,
  isTerminalStatus,
  noticeText,
  owedNotices,
  owesAnyNotice,
  readCommittedTask,
  type TaskNotice
} from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { isUserTurn } from "../standing-rules/user-turn";
import { taskChainResources } from "./chain";
import { CONVERSATION_LEDGER_ID, conversationLedgerResources, ownConversationLedger } from "./ledger";
import { conversationBoardStateShape, settleTakenNotice } from "./task-settled";

/** One task that finished while the turn ran, as {@link takeFinishedTasks} hands it back. */
export const finishedTaskSchema = z.object({
  taskId: z.string(),
  /** How it ended. */
  ending: z.enum(["completed", "errored", "cancelled"]),
  /** The delegate it went to, under whose name the line was said. */
  worker: z.string().optional(),
  /** The line said in the conversation: the task, how it ended, and what came back. */
  line: z.string()
});

export type FinishedTask = z.infer<typeof finishedTaskSchema>;

/**
 * Whether the take hands `notice` over: an ending the queued handling would
 * deliver to the turn (`decideNotice`: not a retry's board run, not a wait's
 * resume), for a task whose result goes to the filer.
 */
export function takesNotice(notice: TaskNotice, resultTo: string | undefined): boolean {
  return resultTo !== "conversation" && decideNotice(notice, "fixed").act === "line";
}

/**
 * Take the tasks this conversation filed whose endings haven't been heard yet
 * (usually ones that finished while the turn ran),
 * say each as a line under its delegate's name, and hand the lines back.
 * Empty outside a turn a user's own message started, and when nothing
 * finished. Input is ignored.
 */
export const takeFinishedTasks = handler({
  name: "workforce-take-finished-tasks",
  inputSchema: z.unknown(),
  outputSchema: z.array(finishedTaskSchema),
  sessionStateSchema: z.object(conversationBoardStateShape),
  resources: { ...conversationLedgerResources, ...taskChainResources },
  execute: async (_input, rawCtx): Promise<FinishedTask[]> => {
    const ctx = rawCtx as unknown as BlockContext;
    if (!isUserTurn(ctx)) return [];
    const ref = await ownConversationLedger(ctx);
    if (ref === undefined) return [];
    const finished: FinishedTask[] = [];
    // Rows this turn's snapshot shows still open or owing: an ending written
    // since is read committed, row by row. A row the snapshot shows ended and
    // acknowledged owes nothing new.
    for (const seen of ref.list()) {
      if (isTerminalStatus(seen.status) && !owesAnyNotice(seen)) continue;
      const row = await readCommittedTask(ref, seen.id);
      if (row === undefined) continue;
      for (const owed of owedNotices(row, CONVERSATION_LEDGER_ID)) {
        if (!takesNotice(owed, row.resultTo)) continue;
        const notice = await takeOwedNotice(ctx, owed);
        if (notice === undefined) continue;
        let first: boolean;
        try {
          first = await settleTakenNotice(ctx, ref, row, notice);
        } catch (error) {
          // Left taken by this request: the queued copy takes it over after the turn.
          // eslint-disable-next-line no-console
          console.warn(
            `[workforce] Task "${row.id}"'s ending stays for after the turn:`,
            error instanceof Error ? error.message : error
          );
          continue;
        }
        if (!first) continue;
        const line = noticeText(notice, row);
        ctx.emit.message(line, row.assignee !== undefined ? { agentName: row.assignee } : {});
        finished.push({
          taskId: row.id,
          ending: notice.ending as FinishedTask["ending"],
          ...(row.assignee !== undefined ? { worker: row.assignee } : {}),
          line
        });
      }
    }
    return finished;
  }
});

/** What {@link finishedTasksAnswerAgain} is built with. */
export interface FinishedTasksAnswerAgainOptions {
  /**
   * What the worker is told when tasks finished while it answered, from the
   * lines the take said. Default: the lines, and to use them in its answer.
   */
  readonly message?: (finished: readonly FinishedTask[]) => string;
}

/** The default message: the lines, and what to do with them. */
function finishedMessage(finished: readonly FinishedTask[]): string {
  return [
    "These tasks you handed out finished while you answered:",
    finished.map((task) => `- ${task.line}`).join("\n"),
    "Use their results now: answer again, building on what you already said."
  ].join("\n\n");
}

/**
 * The pre-built source for the agent flow's `answerAgain`: take what finished
 * ({@link takeFinishedTasks}), then turn the lines into the message the worker
 * answers again about. `{}` when nothing finished, so the step answers no
 * more. `answerAgain: true` is this with its default message.
 */
export function finishedTasksAnswerAgain(options: FinishedTasksAnswerAgainOptions = {}): BlockDefinition<any, any> {
  const toMessage = handler({
    name: "workforce-finished-tasks-message",
    inputSchema: z.array(finishedTaskSchema),
    outputSchema: z.object({ message: z.string().optional() }),
    execute: (finished) => (finished.length === 0 ? {} : { message: (options.message ?? finishedMessage)(finished) })
  });
  return sequencer({ name: "workforce-answer-again-finished-tasks", inputSchema: z.unknown() }).step(takeFinishedTasks).step(toMessage);
}
