// FIX-2286.
/**
 * The tasks a coordinator conversation filed, through the conversation's own
 * `listTasks` read: its board, and nobody else's. Each conversation keeps its
 * own board, so the read runs on the conversation's session. It is a read, not
 * an action, so a panel polling it stores no request per look; a
 * refusal comes back as an `ActionRefused` carrying its reason.
 */
import { ClientHttpError, topic, type Client, type WireTopic } from "@flow-state-dev/client";
import { pullRequestWait, readSessionPullRequests, type PullRequestWaitRow } from "@flow-state-dev/harness-manager/browser";
import { ActionRefused } from "./action";
import { CONVERSATION_BOARD_COLLECTION, describeFailure } from "./reads";

/** The plan ledger's id (Workforce's `PLAN_LEDGER_ID`, pinned): a planning worker's own steps. */
const PLAN_COLLECTION = "plan";

/**
 * The topics a view of the conversation's `listTasks` read subscribes: the
 * conversation's session, narrowed to each ledger the read returns. The read merges the board with the plan ledger, so its views hear
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
  /** Its open holds, when it has any: what it waits on. */
  holds?: PullRequestWaitRow["holds"];
  /** The run it is in, once one started. */
  run?: { sessionId: string; requestId: string } | null;
};

/**
 * The pull requests a task waits on to merge or close (harness-manager's
 * `awaitPullRequests`), by number, and the run session whose record links
 * them; `undefined` while it waits on none.
 */
export function pullRequestsWaitedOn(task: ConversationTask): { numbers: number[]; runSessionId: string | null } | undefined {
  const wait = pullRequestWait({ status: task.status, holds: task.holds ?? [] });
  if (wait === null) return undefined;
  return {
    numbers: wait.pullRequests.flatMap((pr) => (pr.number === null ? [] : [pr.number])),
    runSessionId: task.run?.sessionId ?? null,
  };
}

/**
 * The links of the pull requests a run session's record holds
 * (`readSessionPullRequests`), by number. Empty when it can't be read: a line
 * still says the numbers.
 */
export async function readPullRequestLinks(client: Client, runSessionId: string): Promise<Map<number, string>> {
  try {
    const rows = await readSessionPullRequests(client, runSessionId);
    return new Map(rows.map((row) => [row.number, row.url]));
  } catch {
    return new Map();
  }
}

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
