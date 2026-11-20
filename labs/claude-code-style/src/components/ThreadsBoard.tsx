import { ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { useDismissed, usePins, type CodingBoardTask } from "../app";
import { COLUMNS, columnOf, dismissalKey, type Column } from "../lib/columns";
import { timeSignalOf, taskSignalTone } from "../lib/task-status";
import { useMissing, useNow } from "../lib/use-watch";
import { PANE_TITLE } from "../modes";
import { cn } from "../lib/utils";
import { Spend } from "./flow-state/spend";
import { TaskTime } from "./flow-state/task-signals";
import { PaneHeader } from "./PaneHeader";
import { HarnessTag, rowNote, ThreadIcon } from "./ThreadStatus";
import { ThreadView } from "./ThreadView";

/**
 * Threads mode's right pane: the status board, titled *Tasks*. Every row is
 * one task row of the session's board, grouped by what you owe it (the
 * columns table), and pinned ones on top. Each group has a count and
 * collapses; *Resolved* starts collapsed. Each row carries its time (a
 * running one's clock, *quiet* once its run stopped answering, an ended one's
 * age; never *quiet* while the app's last read of the rows failed). Opening a
 * thread draws its view as a sheet over the main thread, as session mode's
 * tasks open; the board stays in the pane behind it.
 */
export function ThreadsBoard({
  sessionId,
  tasks: listed,
  stale = false,
  openId,
  onOpen,
  onMissing,
}: {
  sessionId: string;
  /** The session's task rows, as the app reads them; `undefined` until read. */
  tasks: CodingBoardTask[] | undefined;
  /** The app's last read of the rows failed: they may be old. */
  stale?: boolean;
  openId: string | undefined;
  onOpen: (taskId: string | undefined) => void;
  /** `openId` names no thread of this session's, once its rows are read. */
  onMissing: () => void;
}) {
  const tasks = listed ?? [];
  useMissing(listed, openId, onMissing);
  const pins = usePins() ?? [];
  const dismissed = useDismissed() ?? [];
  const isDismissed = (task: CodingBoardTask) => dismissed.includes(dismissalKey(task));
  const [collapsed, setCollapsed] = useState<Partial<Record<Column, boolean>>>({ resolved: true });
  const now = useNow(tasks.length > 0);

  const open = tasks.find((t) => t.id === openId);
  const groups = COLUMNS.map((column) => ({
    ...column,
    rows: tasks.filter((t) => columnOf(t, pins.includes(t.id), isDismissed(t)) === column.id),
  })).filter((group) => group.rows.length > 0);

  return (
    <aside aria-label="Tasks" className="flex h-full min-h-0 flex-col bg-inspector">
      <PaneHeader>
        <h2 className="text-sm font-semibold">{PANE_TITLE.board}</h2>
      </PaneHeader>
      {groups.length === 0 ? (
        <p className="px-4 py-4 text-xs text-muted-foreground">
          None yet. Ask the main session for something and it starts a task for each piece.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          {groups.map((group) => {
            const shut = collapsed[group.id] ?? false;
            return (
              <section key={group.id} aria-label={group.label} data-column={group.id} className="mb-3">
                <button
                  type="button"
                  aria-expanded={!shut}
                  onClick={() => setCollapsed((c) => ({ ...c, [group.id]: !shut }))}
                  className="flex w-full items-center gap-1 px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronRightIcon aria-hidden className={cn("size-3.5 shrink-0 transition-transform", !shut && "rotate-90")} />
                  {group.label} · {group.rows.length}
                </button>
                {shut ? null : (
                  <ul className="mt-0.5">
                    {group.rows.map((task) => (
                      <li key={task.id}>
                        <button
                          type="button"
                          onClick={() => onOpen(task.id)}
                          aria-current={task.id === openId ? "true" : undefined}
                          data-task-status={task.status}
                          data-task-id={task.id}
                          className={cn(
                            "flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-accent/60",
                            task.id === openId && "bg-accent",
                          )}
                        >
                          <ThreadIcon task={task} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline gap-2">
                              <span className="min-w-0 flex-1 truncate text-sm font-medium">{task.title}</span>
                              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                                <TaskTime {...timeSignalOf(task)} now={now} stale={stale} tone={taskSignalTone} />
                              </span>
                            </span>
                            <span className={cn("mt-0.5 block truncate text-xs", task.status === "errored" ? "text-destructive" : "text-muted-foreground")}>
                              {rowNote(task)}
                            </span>
                            <span className="mt-1 flex items-center gap-1.5">
                              <HarnessTag task={task} />
                              <Spend spend={task.spend} className="min-w-0 flex-1" />
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
      {open ? (
        <ThreadView
          key={open.id}
          sessionId={sessionId}
          task={open}
          pinned={pins.includes(open.id)}
          dismissed={isDismissed(open)}
          onClose={() => onOpen(undefined)}
        />
      ) : null}
    </aside>
  );
}
