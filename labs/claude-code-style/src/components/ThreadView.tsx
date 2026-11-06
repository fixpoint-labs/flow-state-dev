import { isSendKey, useJumpToLatest, useSubmit } from "@flow-state-dev/react";
import { useMemo, type FormEvent, type KeyboardEvent } from "react";
import type { LabAdapter, TaskRow } from "../adapter";
import { useWatch } from "../lib/use-watch";
import { useDraftSend } from "../lib/use-draft-send";
import { Entry } from "./Entry";
import { LoadEarlier } from "./LoadEarlier";
import { ReviewCard } from "./ReviewCard";
import { Sheet } from "./Sheet";
import { ErrorBody } from "./flow-state/error";
import { Spend } from "./flow-state/spend";
import { StreamingIndicator } from "./flow-state/streaming-indicator";
import { TaskActions } from "./flow-state/task-actions";
import { workingStatus } from "./flow-state/working-status";
import { HarnessTag, statusColumn, statusLine, ThreadIcon } from "./ThreadStatus";

/**
 * One task, as a sheet over the main thread, the same flyout session mode's
 * background tasks open in. Its work reads the task's run session. You can
 * talk inside a task (spec D3): your line is a steer on it, and answers its
 * open question when it has one. When it is ready for review, *Resolve*
 * accepts it and *Request changes* sends your words back. Under the header,
 * the task's action row: Cancel and Release while it is open, Retry once it
 * failed or was cancelled, and Pin beside them. It has no Steer box, since the
 * composer steers. A failed task's error shows as an error. A finished task's
 * composer is off. Cmd+Enter (Ctrl+Enter) does what the box's main button
 * does: answer or send, or request changes when it is ready for review. Plain
 * Enter is a new line.
 */
export function ThreadView({
  adapter,
  sessionId,
  task,
  pinned,
  dismissed = false,
  onClose,
}: {
  adapter: LabAdapter;
  sessionId: string;
  task: TaskRow;
  pinned: boolean;
  /** You dismissed this failed attempt: it no longer waits on you. */
  dismissed?: boolean;
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
  const dismiss = useSubmit(() => adapter.dismiss(task));
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
    <Sheet
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
      subtitle={<Spend spend={task.spend} split />}
      footer={
        <div className="flex flex-col gap-2">
          {question ? (
            <div role="note" className="border border-attention bg-attention/10 px-3 py-2 text-sm [overflow-wrap:anywhere]">
              <span className="font-semibold">Waiting on you</span> · {question.prompt}
            </div>
          ) : null}
          {column === "review" ? <ReviewCard task={task} review={work?.review} /> : null}
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
                className="block w-full resize-none border border-border bg-card px-3 py-2 text-sm outline-none focus:border-ring"
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
                      className="bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-40"
                    >
                      {resolve.busy ? "Resolving…" : "Resolve"}
                    </button>
                    <button type="button" disabled={!words || held} onClick={requestChanges} className="border border-border px-2 py-1 text-xs disabled:opacity-40">
                      Request changes
                    </button>
                  </>
                ) : (
                  <button type="submit" disabled={!words || held} className="bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-40">
                    {question ? "Answer" : "Send"}
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        {/* No Steer box: the composer below steers the task. */}
        <TaskActions key={task.id} id={task.id} status={task.status} actions={actions} />
        {/* A failure waits on you until you retry it or dismiss it. */}
        {task.status === "errored" && !dismissed ? (
          <button
            type="button"
            disabled={dismiss.busy}
            onClick={() => void dismiss.submit(undefined)}
            className="border border-border px-1.5 text-xs hover:bg-accent disabled:opacity-40"
          >
            {dismiss.busy ? "Dismissing…" : "Dismiss"}
          </button>
        ) : null}
        <button
          type="button"
          aria-pressed={pinned}
          disabled={pin.busy}
          onClick={() => void pin.submit(undefined)}
          className="ml-auto border border-border px-1.5 text-xs hover:bg-accent disabled:opacity-40"
        >
          {pinned ? "Unpin" : "Pin"}
        </button>
      </div>
      {dismiss.error === undefined ? null : (
        <p role="alert" className="text-xs text-destructive">
          Couldn't dismiss: {dismiss.error}
        </p>
      )}
      {pin.error === undefined ? null : (
        <p role="alert" className="text-xs text-destructive">
          Couldn't {pinned ? "unpin" : "pin"}: {pin.error}
        </p>
      )}
      {task.status === "errored" && task.error !== undefined ? (
        <div role="alert" className="flex flex-col gap-1 border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <ErrorBody message={task.error} />
        </div>
      ) : null}
      {/* Ready for review is said once, by its card in the footer; a failure's reason, by the alert above. */}
      {column === "review" || (task.status === "errored" && task.error !== undefined) ? null : <div className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{statusLine(task)}</div>}
      <LoadEarlier load={work?.loadEarlier} />
      {work?.entries.map((entry) => (
        <Entry key={entry.id} entry={entry} mark={entry.kind === "user" ? feed.mine(entry.id) : undefined} />
      ))}
      {/* The live line: what it is doing now, else "Working...", and for how long. A task waiting on you isn't working. */}
      {task.status === "in_progress" && task.waitingOn === undefined ? (
        <StreamingIndicator message={workingStatus({ ...work?.working, note: task.statusNote })} since={task.startedAt} />
      ) : null}
    </Sheet>
  );
}
