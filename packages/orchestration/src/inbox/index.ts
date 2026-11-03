/**
 * `@flow-state-dev/orchestration/inbox` — the Inbox: one item type over what
 * holds a task for the user, and the one call that answers it (FIX-2133, the
 * epic FIX-2058's Inbox read).
 *
 * **One item type.** An item is one task row's open holds for the user, or a
 * suspension for the user in a request with no task row. Each hold says where
 * its answer goes and whether the Inbox can answer it; an item is answerable
 * when one of its holds is. {@link createInboxClient}'s `answer` routes each
 * hold by its source: a suspension to the engine's answer route
 * (`client.flow(..).request(..).answer(..)`, FIX-2129), a question or a
 * confirm to the board's `updateTask` action on the session that holds the
 * board, as the user. The answer is typed by what the hold asks
 * ({@link InboxAnswerFor}).
 *
 * **Where an item comes from.** A task run's stop lists under its row, never
 * from the run's session on its own. A suspension the reader found in a
 * session lists on its own only when no open row's run holds it.
 *
 * Browser-safe: it imports types and the client, never the task board's
 * runtime. A browser reads the rows and the sessions, a server reads
 * `listTasks`; both hand them to {@link inboxItems}, the only function that
 * builds an item (the task-surface sweep fails one built anywhere else).
 */
export { createInboxClient, type InboxClient } from "./client";
export { inboxItems } from "./list";
// One task row as a person sees it: the one status and waiting-on vocabulary (FIX-2379).
export { taskRowView, type TaskRowState, type TaskRowView, type TaskViewRow } from "./row-view";
// What a row's holds are, for a reader that parses a published row (FIX-2133).
export { taskHoldSchema, type TaskHold } from "../tasks/schema/hold";
export type {
  InboxAnswer,
  InboxAnswerFor,
  InboxAskKind,
  InboxHold,
  InboxItem,
  InboxRow,
  InboxSuspension,
  InboxTask,
  RowHoldSource,
  SuspensionHoldSource,
} from "./types";
