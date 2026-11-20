/**
 * The app's reads and writes, only through the packages: every read is a
 * package hook over a kit package's view or a direct read, and every write a
 * package client's call. The roster, the lab's context, harness readiness,
 * busy status and worker messages are package views a screen reads with
 * `useView` over the provider's client (`useAppClient()`). One file per job:
 *
 * | File               | Hook                   | What it is over                                                              |
 * |--------------------|------------------------|------------------------------------------------------------------------------|
 * | `conversations.ts` | `ConversationFollower` | one conversation's items (react's `useSessionFeed`), its turns (workforce's |
 * |                    |                        | session turns view), the history summary (`useResource` by session id) and  |
 * |                    |                        | the roster view, read once for every screen on it                          |
 * | `conversations.ts` | `useConversation`      | what the conversation's follower read: its entries, connection and divider   |
 * | `conversations.ts` | `useConversationCalls` | workforce's client: open the conversation, send, stop, retry; a line's files |
 * | `tasks.ts`         | `useTasks`, …          | harness-manager's coding board, recorded work and direct reads; a task's run |
 * |                    |                        | session and its run request's stream; the Inbox client's board actions       |
 *
 * An approval is answered where its entry is drawn, by react's `useApproval`.
 * `AppProvider` (`provider.ts`) holds the one client, workforce's client over
 * it, and what each conversation's screens share; `main.tsx` builds the client.
 * The page acts as the user `fsdev dev` hands it (the config's `devtool`
 * block), with the bearer token when there is one, on the server it came from.
 */
export { AppProvider, useAppClient } from "./provider";
export { ConversationFollower, useConversation, useConversationCalls } from "./conversations";
export { usePullRequestLinks, useRecordedFiles, useTaskActions, useTaskDetail, useTaskWork, useTasks } from "./tasks";
