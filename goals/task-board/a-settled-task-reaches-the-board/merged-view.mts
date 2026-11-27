/**
 * The merged board view this goal grades: a conversation's board read
 * through its flow's task-list view (`listTasks_tasks`, the tasks and plan
 * ledgers in one answer), kept live on the topics and hearings each answer
 * names, at a 2 s pace where push can miss a change. It is what an app's
 * `useView` of that view does. The claude-code-style lab read the board this
 * way until it moved onto harness-manager's coding board view; the goal keeps
 * the read as its own module, so its controls patch it here.
 */
import type { Client } from "@flow-state-dev/client";
import { taskListViewRef } from "@flow-state-dev/orchestration/inbox";

/** One row of the board, as far as the goal reads it. */
export type MergedRow = { id: string; status: string };

/** Watch the board of conversation `sessionId` on `flow`; `onRows` hears each answer. Returns the stop. */
export function watchMergedBoard(client: Client, flow: string, sessionId: string, onRows: (rows: MergedRow[]) => void): () => void {
  return client.live<MergedRow[]>([], {
    topicsFromResult: true,
    read: async () => {
      const answer = await client.view(taskListViewRef(flow, "tasks"), {}, { sessionId });
      return { value: answer.value as MergedRow[], topics: answer.topics, ...(answer.hears === undefined ? {} : { hears: answer.hears }) };
    },
    onValue: onRows,
    pollIntervalMs: 2_000,
  }).close;
}
