import { createContext, useContext, type ReactNode } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { SessionItemsProvider } from "../components/flow-state/session-items-context";
import { conversationBoardRef } from "./reads";

/**
 * The ref of the board whose tasks the surrounding feed shows (a
 * conversation's `<sessionId>.tasks`), or `undefined` when the feed doesn't
 * know it. A task row in the feed links to its session only when this is set.
 */
const TaskBoardRefContext = createContext<string | undefined>(undefined);

export function useTaskBoardRef(): string | undefined {
  return useContext(TaskBoardRefContext);
}

/**
 * What a conversation's feed reads: the session's items, and the board that
 * session keeps. A feed holds one session's own items, so the board its task
 * cards show is that session's: the delegate runs' items live in their own
 * sessions' feeds, never in this one.
 */
export function SessionScope({
  sessionId,
  items,
  children,
}: {
  sessionId: string;
  items: OutputItem[];
  children: ReactNode;
}) {
  return (
    <TaskBoardRefContext.Provider value={conversationBoardRef(sessionId)}>
      <SessionItemsProvider value={items}>{children}</SessionItemsProvider>
    </TaskBoardRefContext.Provider>
  );
}
