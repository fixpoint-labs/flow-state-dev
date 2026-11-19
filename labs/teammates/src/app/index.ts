/**
 * The app's calls: the reads and writes not yet on a package hook go through
 * `AppCalls` (`useApp()`, under `AppProvider`). The roster, the lab's context,
 * harness readiness, busy status and worker messages are package views a
 * screen reads with `useView` over `useAppClient()`. One file per job, and each
 * function is bound to the package call it stands for:
 *
 * | File               | Function            | Bound to                                                                     |
 * |--------------------|---------------------|------------------------------------------------------------------------------|
 * | `conversations.ts` | `openConversation`  | `ensureWorkerSession({ worker })`: the worker's default conversation         |
 * | `conversations.ts` | `send`              | the worker's door, `respond`, streamed, so its answer shows as it is written, |
 * |                    |                     | with the line's files                                                        |
 * | `files.ts`         | `upload`            | the client's `upload`: a file the composer attached, stored, as its reference |
 * | `files.ts`         | `readFile`          | the server's read route for a file a line carries, through the page's fetch   |
 * | `conversations.ts` | `interrupt`         | the request's `abort`, for each answering turn the conversation showed running |
 * | `conversations.ts` | `watchConversation` | the session's items, from its snapshot and then its stream (`sessionFeed`), |
 * |                    |                     | each run of tool calls named by the UI registry's `tool-naming` and        |
 * |                    |                     | `tool-grouping`, and its requests (is it answering, which turns you stopped) |
 * |                    |                     | on each request notice, via `client.subscribe`; the feed's unfinished runs |
 * |                    |                     | for the background work still running                                      |
 * | `conversations.ts` | `watchConnection`   | the same feed's connection state: `live`, `lapsed` once a retry has failed…  |
 * | `conversations.ts` | `answerApproval`    | the request's `answer`: approve or reject a `user_approval` stop             |
 * | `conversations.ts` | `retry`             | the request's `retry()` on the conversation's flow: a failed turn again      |
 * | `window.ts`        | `watchWindow`       | the last answering request's `historyStart`, and the session's `historySummary` |
 * |                    |                     | on each request notice and each notice of that resource                      |
 *
 * What the jobs share (the clients, one feed per session, each conversation's
 * flow) is one `AppState` (`state.ts`) per `createAppCalls` (`calls.ts`).
 *
 * A conversation's tasks are read by hooks, not calls (`tasks.ts`), through
 * the client `AppProvider` holds (`useAppClient()`): harness-manager's coding board view
 * (`useTasks`; `useTaskDetail` for the open popup's one task and its answer),
 * a task's run session and its run request's stream, harness-manager's
 * recorded work view, and the Inbox client's `board(at)` and `answerOne`.
 * Every watch reads on a change; at `POLL_MS` only wherever push can miss one.
 *
 * A received message is drawn from its own item (`workforce:received`), which
 * carries its message id, so the pending line joins the log to the
 * conversation by id.
 *
 * The page acts as the user `fsdev dev` hands it (the config's `devtool`
 * block), with the bearer token when there is one, on the server it came from.
 */
export { AppProvider, useApp, useAppClient } from "./provider";
export { createAppCalls, type AppCalls } from "./calls";
export type { Unsubscribe } from "./reads";
export { answeringOf, RETRYABLE_SOURCES, toEntries, type ConversationEntry, type ConversationView } from "./conversations";
export { commandsRun, runSteps, runSummaryLine, stepRun, toSteps, type SessionStep, type StepRun } from "./steps";
export { windowMarkOf, windowReadOf, type WindowMark } from "./window";
export { usePullRequestLinks, useRecordedFiles, useTaskActions, useTaskDetail, useTaskWork, useTasks } from "./tasks";
