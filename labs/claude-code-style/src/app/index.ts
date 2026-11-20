/**
 * The app's reads and writes, in the app's words. Every read is a package
 * hook over a kit package's view or a direct read, and every write a package
 * call; nothing here assembles what the server computes, opens a stream or
 * addresses a flow. The screen calls these hooks, and no file in `src/`
 * reaches the server itself (`test/inventory.test.ts`). One file per job:
 *
 * | File          | Hook or call       | What it is over                                                                  |
 * |---------------|--------------------|----------------------------------------------------------------------------------|
 * | `sessions.ts` | `useSessions`      | workforce's worker sessions view (`useView`), per mode's worker, less your dismissals |
 * | `sessions.ts` | `useThread`        | the session's items (react's `useSessionFeed`), and workforce's session turns view |
 * | `tasks.ts`    | `useTasks`         | harness-manager's coding board view, at user scope                               |
 * | `tasks.ts`    | `useTaskWork`      | a task's run session (`useSessionFeed`), the run request's stream for the call in flight (`useRequestStream`), and harness-manager's recorded work view |
 * | `marks.ts`    | `usePins`, `useDismissed` | your `lab-pins` and `lab-dismissals` user resources (`useResource`), read by scope with no session |
 * | `calls.ts`    | `useApp()`         | the writes, through workforce's client (open a session, send, stop, retry) and orchestration's inbox (answer and act on a task); pin, dismiss, and the picker's reads |
 *
 * `AppProvider` (`provider.ts`) holds the one client the hooks call through
 * (`main.tsx` builds it; a test builds one over the in-process host).
 */
export type { ReviewDetail } from "@flow-state-dev/harness-manager/browser";
export { AppProvider, useApp } from "./provider";
export { useSessions, useThread, type AppSession, type ThreadView } from "./sessions";
export { appTaskOf, usePullRequestLinks, useTaskWork, useTasks, withPullRequestLinks, type AppTask, type TaskStatus, type TaskWork } from "./tasks";
export { useDismissed, usePins } from "./marks";
export { appCalls, type AppCalls, type AppHarness, type AppProject, type RepositoryCheck } from "./calls";
