import { createContext, useContext } from "react";

/**
 * The ref of the board whose tasks the surrounding feed shows (a
 * conversation's `<sessionId>.tasks`), or `undefined` when the feed doesn't
 * know it. A task row in the feed links to its session only when this is set.
 */
const TaskBoardRefContext = createContext<string | undefined>(undefined);

export const TaskBoardRefProvider = TaskBoardRefContext.Provider;

export function useTaskBoardRef(): string | undefined {
  return useContext(TaskBoardRefContext);
}
