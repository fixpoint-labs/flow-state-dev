/** The feed's task board. Each row opens its session; the registry task plan stays router-free, so the link is a prop. */
import { createContext, useContext } from "react";
import type { ComponentItem } from "@flow-state-dev/core/items";
import { TaskPlan } from "./flow-state/task-plan";
import { navigate } from "../lib/routes";

/** The feed's board ref. Unset, a row draws no Open control. */
const TaskBoardRefContext = createContext<string | undefined>(undefined);

export const TaskBoardRefProvider = TaskBoardRefContext.Provider;

export function TaskBoardMeta({ item }: { item: ComponentItem }) {
  const boardRef = useContext(TaskBoardRefContext);
  const collectionId = (item.data as { collectionId?: string } | undefined)?.collectionId;
  if (collectionId === undefined) return null;
  return (
    <TaskPlan
      collectionId={collectionId}
      requestId={item.requestId}
      renderTaskAction={
        boardRef === undefined
          ? undefined
          : (task) => (
              <button
                type="button"
                className="shrink-0 text-[10px] text-muted-foreground underline hover:text-foreground"
                data-testid="task-open"
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
