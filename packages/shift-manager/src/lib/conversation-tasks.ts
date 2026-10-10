/**
 * The tasks a coordinator conversation filed, through the conversation's own
 * `listTasks` action: its board, and nobody else's. Each conversation keeps
 * its own board, so the read runs on the conversation's session; a refusal
 * comes back as a `TalkRefused` carrying its reason.
 */
import type { LabClients } from "./connection";
import { runTalkAction, TalkRefused } from "./talk";

/**
 * The action a coordinator conversation lists its tasks by: the task tools'
 * `listTasks`, named for the conversation board's id (`tasks`) by the task
 * tools' action rule. A Lab test calls it by this constant, so a rename can't
 * slip past.
 */
export const LIST_TASKS_ACTION = "listTasks_tasks";

/** One task, as the conversation's read answers it. */
export type ConversationTask = {
  id: string;
  goal: string;
  /** The status as stored: `pending`, `in_progress`, `completed`, `errored` and the rest. */
  status: string;
  /** The delegate it is handed to; absent while it waits to be assigned. */
  assignee?: string;
  attempts: number;
};

/** Read the tasks of the coordinator conversation `sessionId` on `kind`. */
export async function readConversationTasks(clients: LabClients, kind: string, sessionId: string): Promise<ConversationTask[]> {
  const output = (await runTalkAction(clients, kind, sessionId, LIST_TASKS_ACTION, {})).output as
    | { ok: true; tasks: ConversationTask[] }
    | { ok: false; error: string };
  if (!output.ok) throw new TalkRefused(output.error);
  return output.tasks;
}
