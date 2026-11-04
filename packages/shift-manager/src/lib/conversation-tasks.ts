/**
 * The tasks a coordinator conversation filed, through the conversation's own
 * `listTasks` read: its board, and nobody else's. Each conversation keeps its
 * own board, so the read runs on the conversation's session. It is a read, not
 * an action (FIX-2286), so a panel polling it stores no request per look; a
 * refusal comes back as an `ActionRefused` carrying its reason.
 */
import { ClientHttpError, topic, type Client, type WireTopic } from "@flow-state-dev/client";
import { ActionRefused } from "./action";
import { CONVERSATION_BOARD_COLLECTION, describeFailure } from "./reads";

/** The plan ledger's id (Workforce's `PLAN_LEDGER_ID`, pinned): a planning worker's own steps. */
const PLAN_COLLECTION = "plan";

/**
 * The topics a view of the conversation's `listTasks` read subscribes
 * (FIX-2429): the conversation's session, narrowed to each ledger the read
 * returns. The read merges the board with the plan ledger, so its views hear
 * both; a flow with no planning worker never publishes on `plan`. Narrowed,
 * so a reply streaming in the conversation never wakes the view.
 */
export function conversationBoardTopics(sessionId: string): WireTopic[] {
  return [
    topic.session(sessionId, { resource: CONVERSATION_BOARD_COLLECTION }),
    topic.session(sessionId, { resource: PLAN_COLLECTION }),
  ];
}

/**
 * The read a coordinator conversation lists its tasks by: the task tools'
 * `listTasks`, named for the conversation board's id (`tasks`) by the task
 * tools' naming rule, as the action of the same name is. A Lab test calls it
 * by this constant, so a rename can't slip past.
 */
export const LIST_TASKS_ACTION = "listTasks_tasks";

/** One task, as the conversation's read answers it. */
export type ConversationTask = {
  id: string;
  goal: string;
  /** The short label the task was filed under; absent when it was filed with none. */
  title?: string;
  /** The status as stored: `pending`, `in_progress`, `completed`, `errored` and the rest. */
  status: string;
  /** The delegate it is handed to; absent while it waits to be assigned. */
  assignee?: string;
  attempts: number;
};

/** Read the tasks of the coordinator conversation `sessionId` on `flow`. */
export async function readConversationTasks(client: Client, flow: string, sessionId: string): Promise<ConversationTask[]> {
  let output: { ok: true; tasks: ConversationTask[] } | { ok: false; error: string };
  try {
    output = await client.flow(flow).read(LIST_TASKS_ACTION, {}, { sessionId });
  } catch (error) {
    // The Lab said no, with a reason. A 5xx or no answer at all is not a refusal.
    if (error instanceof ClientHttpError && error.status >= 400 && error.status < 500) {
      throw new ActionRefused(describeFailure(error).message);
    }
    throw error;
  }
  if (!output.ok) throw new ActionRefused(output.error);
  return output.tasks;
}
