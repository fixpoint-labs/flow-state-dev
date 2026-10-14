/**
 * The feed's task board, with each task row linking to that task's session.
 *
 * `flow-state/task-plan.tsx` is the registry's copy and stays byte-equal to
 * it, and the registry knows no router. This mounts it with the one prop that
 * lets Shift Manager draw its own control on a row, and swaps it in for the
 * `task-board-meta` renderer in {@link shiftManagerRenderers}.
 */
import type { ComponentItem } from "@flow-state-dev/core/items";
import { TaskPlan } from "./flow-state/task-plan";
import { navigate } from "../lib/routes";
import { useTaskBoardRef } from "../lib/task-board-ref";

/**
 * A feed holds one session's own items, so the board its task cards show is
 * that session's (`useTaskBoardRef`). It is not read from the item: every
 * conversation's board shares one `collectionId`, which names no board.
 */
export function TaskBoardMeta({ item }: { item: ComponentItem }) {
  const boardRef = useTaskBoardRef();
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
