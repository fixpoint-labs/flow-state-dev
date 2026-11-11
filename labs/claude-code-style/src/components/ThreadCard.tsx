import type { ReactNode } from "react";
import { useWatch } from "../lib/use-watch";
import type { LabAdapter, LabTask } from "../adapter";
import { cn } from "../lib/utils";
import { Spend } from "./flow-state/spend";
import { LandFailure } from "./flow-state/review-hold";
import { AcceptButtons, LandedLink, useReviewAccept } from "./ReviewAccept";
import { HarnessTag, PullRequestOpen, statusColumn, statusLine, ThreadIcon, waitsOnPullRequest } from "./ThreadStatus";

/**
 * A compact task card in the main thread, where the lead's `createTask`
 * call is. It reads the task row live: icon, title, status line, and
 * *View task*, plus *Answer* when the task waits on you. When it is ready for
 * review, its accept offers the ways the review lists its work can land (*Open
 * a PR*, *Merge locally*), or a plain *Resolve* when none is listed, and
 * *Request changes* opens the task's view, where you type the words. A
 * landed task shows its pull request or the branch it was merged into. A
 * refused or failed landing shows why, with a retry.
 */
export function ThreadCard(props: {
  adapter: LabAdapter;
  sessionId: string;
  task: LabTask | undefined;
  onOpen: (taskId: string) => void;
}) {
  return props.task ? <LoadedThreadCard {...props} task={props.task} /> : null;
}

const button = "rounded-md border border-border bg-muted px-2 py-0.5 text-xs hover:bg-accent";
const primary = "rounded-md bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground";

function LoadedThreadCard({
  adapter,
  sessionId,
  task,
  onOpen,
}: {
  adapter: LabAdapter;
  sessionId: string;
  task: LabTask;
  onOpen: (taskId: string) => void;
}) {
  const column = statusColumn(task);
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
        {waitsOnPullRequest(task) ? (
          <PullRequestOpen task={task} className="block" />
        ) : (
          <div className="truncate text-xs text-muted-foreground">{statusLine(task)}</div>
        )}
        {task.landed === undefined ? null : (
          <div className="truncate">
            <LandedLink landed={task.landed} />
          </div>
        )}
        <Spend spend={task.spend} />
        {column === "review" ? (
          <ReviewActions adapter={adapter} sessionId={sessionId} task={task} onOpen={onOpen} viewThread={viewThread} />
        ) : column === "waiting" ? (
          <div className="mt-1.5 flex gap-1.5">
            {task.status !== "errored" ? (
              <button type="button" className={primary} onClick={() => onOpen(task.id)}>
                Answer
              </button>
            ) : null}
            {viewThread}
          </div>
        ) : null}
      </div>
      {column === "working" || column === "resolved" ? viewThread : null}
    </section>
  );
}

/**
 * A thread ready for review: the accept, *Request changes* and *View task*. It reads the run's review
 * only while the thread is ready for review, since that is where its lands come from.
 */
function ReviewActions({
  adapter,
  sessionId,
  task,
  onOpen,
  viewThread,
}: {
  adapter: LabAdapter;
  sessionId: string;
  task: LabTask;
  onOpen: (taskId: string) => void;
  viewThread: ReactNode;
}) {
  const work = useWatch((emit: Parameters<LabAdapter["watchTaskWork"]>[2]) => adapter.watchTaskWork(sessionId, task.id, emit), [adapter, sessionId, task.id]);
  const accept = useReviewAccept(adapter, sessionId, task, work);
  return (
    <div className="mt-1.5 min-w-0">
      <div className="flex flex-wrap gap-1.5">
        <AcceptButtons
          compact
          lands={accept.lands}
          failed={accept.failed}
          disabled={accept.waiting || !accept.ready}
          busy={accept.waiting}
          onAccept={accept.accept}
        />
        <button type="button" className={button} onClick={() => onOpen(task.id)}>
          Request changes
        </button>
        {viewThread}
      </div>
      <LandFailure failed={accept.failed} />
      {accept.error === undefined ? null : (
        <p role="alert" className="mt-1 text-xs text-destructive">
          Couldn't resolve: {accept.error}
        </p>
      )}
    </div>
  );
}
