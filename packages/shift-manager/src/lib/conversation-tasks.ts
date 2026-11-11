// FIX-2286; FIX-2623.
/**
 * The tasks a coordinator conversation filed, through the conversation's own
 * task-list view: its board, and nobody else's. Each conversation keeps its
 * own board, so the view runs on the conversation's session. A view stores
 * nothing, so a panel watching it stores no request per look. Its answer is
 * the board's rows, keyed and typed by the view, and it names the topics a
 * change to them publishes on, so a panel names none.
 */
import { useMemo } from "react";
import type { Client, ViewRef, ViewValueOf } from "@flow-state-dev/client";
import { useView } from "@flow-state-dev/react";
import { pullRequestWait, readSessionPullRequests } from "@flow-state-dev/harness-manager/browser";
import { taskListViewRef, type TaskListView } from "@flow-state-dev/orchestration/inbox";
import { useLab } from "./lab-data";
import { CONVERSATION_BOARD_COLLECTION } from "./reads";

/**
 * The name of the conversation board's `listTasks` action, by the task tools'
 * naming rule (the board's id is `tasks`). The board's view has the same name.
 * A Lab test acts on the board by this constant, so a rename can't slip past.
 */
export const LIST_TASKS_ACTION = "listTasks_tasks";

/** The conversation board's task list on flow `flow`, as a view: watch it on the conversation's session. */
function conversationBoardView(flow: string): ViewRef<TaskListView> {
  return taskListViewRef(flow, CONVERSATION_BOARD_COLLECTION);
}

/** One task, as the conversation board's view answers it. */
export type ConversationTask = ViewValueOf<ViewRef<TaskListView>>[number];

/**
 * Watch the tasks of the coordinator conversation `sessionId` on `flow`, or
 * nothing while either is `null`. The view's answer names its topics, so a
 * task filed, moved or settled in any session, on any process, reaches it.
 * Where push can miss a change, the view's own timer reads it again. Every
 * panel watching one conversation shares one read.
 */
export function useConversationTasks(flow: string | null, sessionId: string | null): { tasks: ConversationTask[] | undefined; stale: boolean } {
  const { client } = useLab();
  const ref = useMemo(() => conversationBoardView(flow ?? "-"), [flow]);
  const { value, stale } = useView(ref, {}, { client, enabled: flow !== null && sessionId !== null, ...(sessionId !== null ? { sessionId } : {}) });
  return { tasks: value, stale };
}

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
