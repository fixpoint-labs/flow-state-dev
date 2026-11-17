/**
 * Everything the screen reads and writes, over one client: each job's calls
 * (`index.ts` lists which file holds which), sharing one {@link AppState}.
 */
import type { Client } from "@flow-state-dev/client";
import { conversationCalls, type ConversationCalls } from "./conversations";
import { connect, fileCalls, pageConnection, type AppConnection, type FileCalls } from "./files";
import { runCalls, type RunCalls } from "./runs";
import { setupCalls, type SetupCalls } from "./setup";
import { appState } from "./state";
import { talkCalls, type TalkCalls } from "./talk";
import { taskCalls, type TaskCalls } from "./tasks";
import { windowCalls, type WindowCalls } from "./window";
import { workerCalls, type WorkerCalls } from "./workers";

/** Everything the screen reads and writes. */
export interface AppCalls extends WorkerCalls, SetupCalls, ConversationCalls, FileCalls, WindowCalls, TalkCalls, TaskCalls, RunCalls {}

/** The calls the app runs on: the package, through one client; `connection` is where it reads a line's files. */
export function createAppCalls(client: Client = connect(), connection: AppConnection = pageConnection()): AppCalls {
  const state = appState(client);
  return {
    ...workerCalls(state),
    ...setupCalls(client),
    ...conversationCalls(state),
    ...fileCalls(client, connection),
    ...windowCalls(state),
    ...talkCalls(state),
    ...taskCalls(state),
    ...runCalls(state),
  };
}
