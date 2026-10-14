/**
 * The feed's task board, with each task row linking to that task's session.
 *
 * `flow-state/task-plan.tsx` is the registry's copy and stays byte-equal to
 * it, and the registry knows no router. This mounts it with the one prop that
 * lets Shift Manager draw its own control on a row, and swaps it in for the
 * `task-board-meta` renderer in {@link shiftManagerRenderers}.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { ComponentItem, OutputItem } from "@flow-state-dev/core/items";
import { SessionItemsProvider } from "./flow-state/session-items-context";
import { TaskPlan } from "./flow-state/task-plan";
import { CONVERSATION_BOARD_COLLECTION, conversationBoardRef } from "../lib/reads";
import { navigate } from "../lib/routes";

/** The board the surrounding feed's session keeps; `undefined` outside a {@link SessionScope}. */
const TaskBoardRefContext = createContext<string | undefined>(undefined);

/**
 * What a conversation's feed reads: the session's items, and the board that
 * session keeps. A feed holds one session's own items (a delegate run's live
 * in its own session's feed), so the board its task cards show is that
 * session's, not one read from the item: every conversation's board shares
 * one `collectionId`, which names no board.
 */
export function SessionScope({ sessionId, items, children }: { sessionId: string; items: OutputItem[]; children: ReactNode }) {
  return (
    <TaskBoardRefContext.Provider value={conversationBoardRef(sessionId)}>
      <SessionItemsProvider value={items}>{children}</SessionItemsProvider>
    </TaskBoardRefContext.Provider>
  );
}

export function TaskBoardMeta({ item }: { item: ComponentItem }) {
  const boardRef = useContext(TaskBoardRefContext);
  const collectionId = (item.data as { collectionId?: string } | undefined)?.collectionId;
  if (collectionId === undefined) return null;
  return (
    <TaskPlan
      collectionId={collectionId}
      requestId={item.requestId}
      renderTaskAction={
        // Only the conversation's own ledger is a board this route opens; another collection's task ids name nothing there.
        boardRef === undefined || collectionId !== CONVERSATION_BOARD_COLLECTION
          ? undefined
          : (task) => (
              <button
                type="button"
                className="shrink-0 text-[10px] text-muted-foreground underline hover:text-foreground"
                data-testid="task-open"
                aria-label={`Open ${task.title || task.goal}`}
                // The row sits in a <summary>: a click here opens the task, it doesn't toggle the row.
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  navigate({ level: "task", boardRef, taskId: task.id, tab: "session" });
                }}
              >
                Open
              </button>
            )
      }
    />
  );
}
