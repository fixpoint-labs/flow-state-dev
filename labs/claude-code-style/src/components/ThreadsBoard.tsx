import { useState } from "react";
import type { LabAdapter, TaskRow } from "../adapter";
import { COLUMNS, columnOf, type Column } from "../lib/columns";
import { age, useNow, useWatch } from "../lib/use-watch";
import { cn } from "../lib/utils";
import { HarnessTag, statusLine, ThreadIcon } from "./ThreadStatus";
import { ThreadView } from "./ThreadView";

/** A row's note: the group already says the status, so only what it's on, or why it failed. */
const rowNote = (task: TaskRow) =>
  task.status === "errored" || task.status === "cancelled" ? statusLine(task) : (task.waitingOn?.prompt ?? task.statusNote ?? "");

/**
 * Threads mode's right pane: the status board, titled *Threads*. Every row is
 * one task row of the session's board, grouped by what you owe it (the
 * columns table), and pinned ones on top. Each group has a count and
 * collapses; *Resolved* starts collapsed. Opening a thread replaces the board
 * with its view, with a back arrow; the main thread stays in the center.
 */
export function ThreadsBoard({
  adapter,
  sessionId,
  openId,
  onOpen,
}: {
  adapter: LabAdapter;
  sessionId: string;
  openId: string | undefined;
  onOpen: (taskId: string | undefined) => void;
}) {
  const tasks = useWatch((emit: (rows: TaskRow[]) => void) => adapter.watchTasks(sessionId, emit), [adapter, sessionId]) ?? [];
  const pins = useWatch((emit: (ids: string[]) => void) => adapter.watchPins(emit), [adapter]) ?? [];
  const [collapsed, setCollapsed] = useState<Partial<Record<Column, boolean>>>({ resolved: true });
  const now = useNow(true, 30_000);

  const open = tasks.find((t) => t.id === openId);
  if (open) {
    return (
      <ThreadView
        key={open.id}
        adapter={adapter}
        sessionId={sessionId}
        task={open}
        pinned={pins.includes(open.id)}
        onBack={() => onOpen(undefined)}
      />
    );
  }

  const groups = COLUMNS.map((column) => ({
    ...column,
    rows: tasks.filter((t) => columnOf(t, pins.includes(t.id)) === column.id),
  })).filter((group) => group.rows.length > 0);

  return (
    <aside aria-label="Threads" className="flex h-full min-h-0 flex-col bg-inspector">
      <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Threads</h2>
      {groups.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">
          None yet. Ask the main session for something and it starts a thread for each piece.
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
          {groups.map((group) => {
            const shut = collapsed[group.id] ?? false;
            return (
              <section key={group.id} aria-label={group.label} data-column={group.id} className="mb-2">
                <button
                  type="button"
                  aria-expanded={!shut}
                  onClick={() => setCollapsed((c) => ({ ...c, [group.id]: !shut }))}
                  className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  {group.label} · {group.rows.length} {shut ? "▸" : "▾"}
                </button>
                {shut ? null : (
                  <ul>
                    {group.rows.map((task) => (
                      <li key={task.id}>
                        <button
                          type="button"
                          onClick={() => onOpen(task.id)}
                          data-task-status={task.status}
                          data-task-id={task.id}
                          className="flex w-full items-start gap-2 px-2 py-1.5 text-left hover:bg-accent"
                        >
                          <ThreadIcon task={task} />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-2">
                              <span className="truncate text-sm font-semibold">{task.title}</span>
                              <HarnessTag task={task} />
                            </span>
                            <span className={cn("block truncate text-xs text-muted-foreground", task.steps && "font-mono")}>
                              {task.steps ? `${task.steps.done}/${task.steps.total} · ` : ""}
                              {rowNote(task)}
                            </span>
                          </span>
                          {task.updatedAt !== undefined ? (
                            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{age(task.updatedAt, now)}</span>
                          ) : null}
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
    </aside>
  );
}
