import type { LabAdapter, TaskRow } from "../adapter";
import { cn } from "../lib/utils";
import { HarnessTag, statusColumn, statusLine, ThreadIcon } from "./ThreadStatus";

/**
 * A compact thread card in the main thread, where the lead's `createTask`
 * call is. It reads the task row live: icon, title, status line, and
 * *View thread*, plus *Answer* when the thread waits on you and *Resolve* and
 * *Request changes* when it is ready for review. *Resolve* answers the review
 * from the card; *Answer* and *Request changes* open the thread's view, where
 * you type the words.
 */
export function ThreadCard({
  adapter,
  sessionId,
  task,
  onOpen,
}: {
  adapter: LabAdapter;
  sessionId: string;
  task: TaskRow | undefined;
  onOpen: (taskId: string) => void;
}) {
  if (!task) return null;
  const column = statusColumn(task);
  const button = "border border-border bg-muted px-2 py-0.5 text-xs hover:bg-accent";
  const primary = "bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground";
  const viewThread = (
    <button type="button" className={button} onClick={() => onOpen(task.id)}>
      View thread
    </button>
  );
  return (
    <section
      aria-label={`Thread: ${task.title}`}
      data-entry="thread"
      data-column={column}
      className={cn(
        "flex items-start gap-3 border px-3 py-2",
        column === "waiting" && "border-attention bg-attention/10",
        column === "review" && "border-success bg-success/10",
        (column === "working" || column === "resolved") && "border-border bg-card",
      )}
    >
      <ThreadIcon task={task} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{task.title}</span>
          <HarnessTag task={task} />
        </div>
        <div className="truncate text-xs text-muted-foreground">{statusLine(task)}</div>
        {column === "waiting" || column === "review" ? (
          <div className="mt-1.5 flex gap-1.5">
            {column === "waiting" && task.status !== "errored" ? (
              <button type="button" className={primary} onClick={() => onOpen(task.id)}>
                Answer
              </button>
            ) : null}
            {column === "review" ? (
              <>
                <button type="button" className={primary} onClick={() => void adapter.resolve(sessionId, task.id)}>
                  Resolve
                </button>
                <button type="button" className={button} onClick={() => onOpen(task.id)}>
                  Request changes
                </button>
              </>
            ) : null}
            {viewThread}
          </div>
        ) : null}
      </div>
      {column === "working" || column === "resolved" ? viewThread : null}
    </section>
  );
}
