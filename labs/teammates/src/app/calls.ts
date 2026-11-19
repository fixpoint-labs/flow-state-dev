/**
 * Everything the screen reads and writes, over one client: each job's calls
 * (`index.ts` lists which file holds which), sharing one {@link AppState}.
 */
import type { Client } from "@flow-state-dev/client";
import { conversationCalls, type ConversationCalls } from "./conversations";
import { connect, fileCalls, pageConnection, type AppConnection, type FileCalls } from "./files";
import { appState } from "./state";
import { windowCalls, type WindowCalls } from "./window";

/** Everything the screen reads and writes. */
export interface AppCalls extends ConversationCalls, FileCalls, WindowCalls {
  /** Stop what the calls keep watching for their whole life (the roster): whoever made them calls it when done. */
  close(): void;
}

/** The calls the app runs on: the package, through one client; `connection` is where it reads a line's files. */
export function createAppCalls(client: Client = connect(), connection: AppConnection = pageConnection()): AppCalls {
  const state = appState(client);
  return {
    ...conversationCalls(state),
    ...fileCalls(client, connection),
    ...windowCalls(state),
    close: state.close,
  };
}
