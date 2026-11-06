import { useSubmit } from "@flow-state-dev/react";
import type { LabAdapter, TaskRow } from "../adapter";
import { cn } from "../lib/utils";
import { Spend } from "./flow-state/spend";
import { HarnessTag, statusColumn, statusLine, ThreadIcon } from "./ThreadStatus";

/**
 * A compact task card in the main thread, where the lead's `createTask`
 * call is. It reads the task row live: icon, title, status line, and
 * *View task*, plus *Answer* when the task waits on you and *Resolve* and
 * *Request changes* when it is ready for review. *Resolve* answers the review
 * from the card; *Answer* and *Request changes* open the task's view, where
 * you type the words. *Resolve* is held while its answer is on its way, and
 * says so inline when the answer is refused.
 */
export function ThreadCard(props: {
  adapter: LabAdapter;
  sessionId: string;
  task: TaskRow | undefined;
  onOpen: (taskId: string) => void;
}) {
  return props.task ? <LoadedThreadCard {...props} task={props.task} /> : null;
}

function LoadedThreadCard({
  adapter,
  sessionId,
  task,
  onOpen,
}: {
  adapter: LabAdapter;
  sessionId: string;
  task: TaskRow;
  onOpen: (taskId: string) => void;
}) {
  const resolve = useSubmit(() => adapter.resolve(sessionId, task.id));
  const column = statusColumn(task);
  const button = "rounded-md border border-border bg-muted px-2 py-0.5 text-xs hover:bg-accent";
  const primary = "rounded-md bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground";
  const viewThread = (
    <button type="button" className={button} onClick={() => onOpen(task.id)}>
      View task
    </button>
  );
  return (
    <section
      aria-label={`Task: ${task.title}`}
      data-entry="thread"
      data-column={column}
      data-task-id={task.id}
      className={cn(
        // The card is quiet; only its tint says what it needs from you: red for a failure, the highlighter for a question, green for a review.
        "flex items-start gap-3 rounded-lg border border-border bg-card px-3.5 py-3",
        task.status === "errored" && "border-destructive/40 bg-destructive/5",
        task.status !== "errored" && column === "waiting" && "border-attention/50 bg-attention/5",
        column === "review" && "border-success/40 bg-success/5",
      )}
    >
      <ThreadIcon task={task} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{task.title}</span>
          <HarnessTag task={task} />
        </div>
        <div className="truncate text-xs text-muted-foreground">{statusLine(task)}</div>
        <Spend spend={task.spend} />
        {column === "waiting" || column === "review" ? (
          <div className="mt-1.5 flex gap-1.5">
            {column === "waiting" && task.status !== "errored" ? (
              <button type="button" className={primary} onClick={() => onOpen(task.id)}>
                Answer
              </button>
            ) : null}
            {column === "review" ? (
              <>
                <button
                  type="button"
                  className={cn(primary, "disabled:opacity-40")}
                  disabled={resolve.busy}
                  onClick={() => void resolve.submit(undefined)}
                >
                  {resolve.busy ? "Resolving…" : "Resolve"}
                </button>
                <button type="button" className={button} onClick={() => onOpen(task.id)}>
                  Request changes
                </button>
              </>
            ) : null}
            {viewThread}
          </div>
        ) : null}
        {resolve.error === undefined ? null : (
          <p role="alert" className="mt-1 text-xs text-destructive">
            Couldn't resolve: {resolve.error}
          </p>
        )}
      </div>
      {column === "working" || column === "resolved" ? viewThread : null}
    </section>
  );
}
