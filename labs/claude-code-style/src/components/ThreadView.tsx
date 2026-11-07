import { isSendKey, useJumpToLatest, useSubmit } from "@flow-state-dev/react";
import { useMemo, type FormEvent, type KeyboardEvent } from "react";
import type { LabAdapter, TaskRow } from "../adapter";
import { useWatch } from "../lib/use-watch";
import { useDraftSend } from "../lib/use-draft-send";
import { Entry } from "./Entry";
import { LoadEarlier } from "./LoadEarlier";
import { ReviewCard } from "./ReviewCard";
import { SessionOverlay } from "./flow-state/session-overlay";
import { WorkingLine } from "./WorkingLine";
import { ErrorBody } from "./flow-state/error";
import { Spend } from "./flow-state/spend";
import { TaskActions } from "./flow-state/task-actions";
import { workingStatus } from "./flow-state/working-status";
import { HarnessTag, PULL_REQUEST_HINT, PullRequestOpen, statusColumn, statusLine, ThreadIcon, waitsOnPullRequest } from "./ThreadStatus";

/**
 * One task, as a sheet over the main thread, the same flyout session mode's
 * background tasks open in. Its work reads the task's run session. You can
 * talk inside a task (spec D3): your line is a steer on it, and answers its
 * open question when it has one. When it is ready for review, *Resolve*
 * accepts it and *Request changes* sends your words back. Under the header,
 * the task's action row: Cancel and Release while it is open, Retry once it
 * failed or was cancelled, and Pin beside them. It has no Steer box, since the
 * composer steers. A task waiting on its pull request says *PR open · #7*,
 * with the link, and keeps its composer: your line wakes it to read the pull
 * request again. A failed task's error shows as an error. A finished task's
 * composer is off. Cmd+Enter (Ctrl+Enter) does what the box's main button
 * does: answer or send, or request changes when it is ready for review. Plain
 * Enter is a new line.
 */
export function ThreadView({
  adapter,
  sessionId,
  task,
  pinned,
  onClose,
}: {
  adapter: LabAdapter;
  sessionId: string;
  task: TaskRow;
  pinned: boolean;
  onClose: () => void;
}) {
  const work = useWatch(
    (emit: Parameters<LabAdapter["watchTaskWork"]>[2]) => adapter.watchTaskWork(sessionId, task.id, emit),
    [adapter, sessionId, task.id],
  );
  const { text, setText, sending, failure, submit } = useDraftSend("claude-code-style:task-draft", task.id);
  // The board keys this view by task, so a change of task remounts it and the feed starts over.
  const feed = useJumpToLatest();
  const column = statusColumn(task);
  const question = task.waitingOn && task.waitingOn.kind !== "review" ? task.waitingOn : undefined;
  const words = text.trim();
  const finished = task.status === "completed" || task.status === "cancelled" || task.status === "errored";

  // Resolve and a send share the composer: nothing else goes while one is on its way.
  const resolve = useSubmit(() => adapter.resolve(sessionId, task.id));
  const pin = useSubmit(() => (pinned ? adapter.unpin(task.id) : adapter.pin(task.id)));
  const actions = useMemo(() => adapter.taskActions(sessionId), [adapter, sessionId]);
  const held = sending || resolve.busy;

  // Your words stay in the box until they land; a failed send says why, with Retry.
  const say = (event?: FormEvent) => {
    event?.preventDefault();
    if (resolve.busy) return;
    void submit((line) => {
      feed.sent();
      return adapter.sayInThread(sessionId, task.id, line);
    });
  };
  const requestChanges = () => {
    if (resolve.busy) return;
    void submit((line) => {
      feed.sent();
      return adapter.requestChanges(sessionId, task.id, line);
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isSendKey(event)) return;
    event.preventDefault();
    if (column === "review") requestChanges();
    else say();
  };

  return (
    <SessionOverlay
      variant="sheet"
      label={`Task: ${task.title}`}
      feed={feed}
      onClose={onClose}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <ThreadIcon task={task} />
          <span className="truncate">{task.title}</span>
          <HarnessTag task={task} />
        </span>
      }
      meta={<Spend spend={task.spend} split />}
      toolbar={
        <>
          {/* No Steer box: the composer below steers the task. */}
          <TaskActions key={task.id} id={task.id} status={task.status} actions={actions} />
          <button
            type="button"
            aria-pressed={pinned}
            disabled={pin.busy}
            onClick={() => void pin.submit(undefined)}
            className="ml-auto rounded-md border border-border px-2 py-1 text-xs transition-colors hover:bg-accent disabled:opacity-40"
          >
            {pinned ? "Unpin" : "Pin"}
          </button>
        </>
      }
      footer={
        <div className="flex flex-col gap-2">
          {question ? (
            <div role="note" className="max-h-40 overflow-y-auto rounded-md border border-attention/40 bg-attention/10 px-3 py-2 text-sm [overflow-wrap:anywhere]">
              <span className="font-semibold">Waiting on you</span> · {question.prompt}
            </div>
          ) : null}
          {waitsOnPullRequest(task) ? (
            <p role="note" data-testid="pull-request-hint" className="text-xs text-muted-foreground">
              {PULL_REQUEST_HINT}
            </p>
          ) : null}
          {finished ? (
            <p role="note" className="text-xs text-muted-foreground">
              This task is finished.
            </p>
          ) : (
            <form onSubmit={say}>
              <textarea
                aria-label="Message this task"
                rows={2}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={onKeyDown}
                placeholder={question ? "Answer the task…" : column === "review" ? "What should change…" : "Say something in this task…"}
                className="block w-full resize-none rounded-lg border border-border/60 bg-card px-3 py-2 text-sm outline-none focus:border-ring"
              />
              {failure !== undefined ? (
                <p role="alert" className="mt-1 text-xs text-destructive">
                  Not sent: {failure} ·{" "}
                  <button type="button" className="underline" onClick={() => (column === "review" ? requestChanges() : say())}>
                    Retry
                  </button>
                </p>
              ) : null}
              {resolve.error === undefined ? null : (
                <p role="alert" className="mt-1 text-xs text-destructive">
                  Couldn't resolve: {resolve.error}
                </p>
              )}
              <div className="mt-2 flex justify-end gap-1.5">
                {column === "review" ? (
                  <>
                    <button
                      type="button"
                      disabled={held}
                      onClick={() => void resolve.submit(undefined)}
                      className="rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-40"
                    >
                      {resolve.busy ? "Resolving…" : "Resolve"}
                    </button>
                    <button type="button" disabled={!words || held} onClick={requestChanges} className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-40">
                      Request changes
                    </button>
                  </>
                ) : (
                  <button type="submit" disabled={!words || held} className="rounded-md bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-40">
                    {question ? "Answer" : "Send"}
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      }
    >
      {pin.error === undefined ? null : (
        <p role="alert" className="text-xs text-destructive">
          Couldn't {pinned ? "unpin" : "pin"}: {pin.error}
        </p>
      )}
      {task.status === "errored" && task.error !== undefined ? (
        <div role="alert" className="flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive [overflow-wrap:anywhere]">
          <ErrorBody message={task.error} />
        </div>
      ) : null}
      {/* Ready for review is said once, by its card at the end of the feed; a failure's reason, by the alert above. */}
      {column === "review" || (task.status === "errored" && task.error !== undefined) ? null : waitsOnPullRequest(task) ? (
        <PullRequestOpen task={task} className="block" />
      ) : (
        <div className="truncate text-xs text-muted-foreground" title={statusLine(task)}>{statusLine(task)}</div>
      )}
      <LoadEarlier load={work?.loadEarlier} />
      {work?.entries.map((entry) => (
        <Entry key={entry.id} entry={entry} mark={entry.kind === "user" ? feed.mine(entry.id) : undefined} />
      ))}
      {/* Ready for review closes the feed, in the one scroll area, so a long review reads like the rest of it. Resolve and the request for changes stay under it. */}
      {column === "review" ? <ReviewCard task={task} review={work?.review} /> : null}
      {/* The live line: what it is doing now, else "Working...", and for how long. A task waiting on you isn't working. */}
      {task.status === "in_progress" && task.waitingOn === undefined && !waitsOnPullRequest(task) ? (
        <WorkingLine message={workingStatus({ ...work?.working, note: task.statusNote })} since={task.startedAt} />
      ) : null}
    </SessionOverlay>
  );
}
