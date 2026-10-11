/**
 * The tasks a coordinator conversation filed, through the conversation's own
 * `listTasks` action: its board, and nobody else's. Each conversation keeps
 * its own board, so the read runs on the conversation's session; a refusal
 * comes back as an `ActionRefused` carrying its reason.
 */
import { CONVERSATION_LEDGER_ID } from "@flow-state-dev/workforce/browser";
import type { LabClients } from "./connection";
import { runAction, ActionRefused } from "./action";

/** `listTasks` named for the conversation ledger, by the task tools' action rule. */
export const LIST_TASKS_ACTION = `listTasks_${CONVERSATION_LEDGER_ID}`;

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
  const output = (await runAction(clients, kind, sessionId, LIST_TASKS_ACTION, {})).output as
    | { ok: true; tasks: ConversationTask[] }
    | { ok: false; error: string };
  if (!output.ok) throw new ActionRefused(output.error);
  return output.tasks;
}
