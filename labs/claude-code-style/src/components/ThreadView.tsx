import { isSendKey, useJumpToLatest, useSubmit } from "@flow-state-dev/react";
import { useState, type FormEvent, type KeyboardEvent } from "react";
import type { LabAdapter, TaskRow } from "../adapter";
import { useWatch } from "../lib/use-watch";
import { Entry } from "./Entry";
import { JumpToLatestButton } from "./JumpToLatest";
import { ReviewCard } from "./ReviewCard";
import { Spend } from "./Spend";
import { HarnessTag, statusColumn, statusLine, ThreadIcon } from "./ThreadStatus";

/**
 * One task, in place of the board. Its work reads the task's run session.
 * You can talk inside a task (spec D3): your line is a steer on it, and
 * answers its open question when it has one. When it is ready for
 * review, *Resolve* accepts it and *Request changes* sends your words back.
 * A finished task's composer is off: you ask the main session to follow up.
 * Cmd+Enter (Ctrl+Enter) does what the box's main button does: answer or send,
 * or request changes when it is ready for review. Plain Enter is a new line.
 * While a call is on its way its buttons are held, and a refused call says so
 * inline and keeps your words in the box.
 */
export function ThreadView({
  adapter,
  sessionId,
  task,
  pinned,
  onBack,
}: {
  adapter: LabAdapter;
  sessionId: string;
  task: TaskRow;
  pinned: boolean;
  onBack: () => void;
}) {
  const work = useWatch(
    (emit: Parameters<LabAdapter["watchTaskWork"]>[2]) => adapter.watchTaskWork(sessionId, task.id, emit),
    [adapter, sessionId, task.id],
  );
  const [text, setText] = useState("");
  const feed = useJumpToLatest({ resetKey: task.id });
  const column = statusColumn(task);
  const question = task.waitingOn && task.waitingOn.kind !== "review" ? task.waitingOn : undefined;
  const words = text.trim();
  const finished = task.status === "completed" || task.status === "cancelled" || task.status === "errored";

  // The composer's calls share one hold: nothing else is sent while one is on its way.
  // Your words leave the box only once they are taken, unless you have typed on since.
  const send = useSubmit(async (kind: "say" | "change" | "resolve") => {
    if (kind === "resolve") return adapter.resolve(sessionId, task.id);
    feed.sent();
    const line = words;
    await (kind === "say" ? adapter.sayInThread(sessionId, task.id, line) : adapter.requestChanges(sessionId, task.id, line));
    setText((now) => (now.trim() === line ? "" : now));
  });
  const pin = useSubmit(() => (pinned ? adapter.unpin(task.id) : adapter.pin(task.id)));
  const say = (event?: FormEvent) => {
    event?.preventDefault();
    if (!words || send.busy) return;
    void send.submit(undefined, "say");
  };
  const requestChanges = () => {
    if (!words || send.busy) return;
    void send.submit(undefined, "change");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!isSendKey(event)) return;
    event.preventDefault();
    if (column === "review") requestChanges();
    else say();
  };

  return (
    <aside aria-label={`Task: ${task.title}`} className="flex h-full min-h-0 flex-col bg-inspector">
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <button type="button" aria-label="Back to tasks" onClick={onBack} className="px-1 text-sm hover:bg-accent">
          ←
        </button>
        <ThreadIcon task={task} />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{task.title}</h2>
        <HarnessTag task={task} />
        <button
          type="button"
          aria-pressed={pinned}
          disabled={pin.busy}
          onClick={() => void pin.submit(undefined)}
          className="border border-border px-1.5 text-xs hover:bg-accent disabled:opacity-40"
        >
          {pinned ? "Unpin" : "Pin"}
        </button>
      </div>
      {pin.error === undefined ? null : (
        <p role="alert" className="px-4 pt-2 text-xs text-destructive">
          Couldn't {pinned ? "unpin" : "pin"}: {pin.error}
        </p>
      )}
      {/* Ready for review is said once, by its card above the composer. */}
      {column === "review" ? null : <div className="px-4 pt-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{statusLine(task)}</div>}
      <Spend task={task} split className="px-4" />
      <div ref={feed.ref} className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto px-4 pt-2 pb-8 [overflow-wrap:anywhere]">
        {work?.entries.map((entry) => <Entry key={entry.id} entry={entry} />)}
        <JumpToLatestButton feed={feed} />
      </div>
      {question ? (
        <div role="note" className="mx-3 border border-attention bg-attention/10 px-3 py-2 text-sm [overflow-wrap:anywhere]">
          <span className="font-semibold">Waiting on you</span> · {question.prompt}
        </div>
      ) : null}
      {column === "review" ? <ReviewCard task={task} review={work?.review} /> : null}
      {finished ? (
        <p role="note" className="px-4 py-3 text-xs text-muted-foreground">
          This task is finished. To follow up or retry, ask the main session.
        </p>
      ) : (
        <form onSubmit={say} className="px-3 py-3">
          <textarea
            aria-label="Message this task"
            rows={2}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={question ? "Answer the task…" : column === "review" ? "What should change…" : "Say something in this task…"}
            className="block w-full resize-none border border-border bg-card px-3 py-2 text-sm outline-none focus:border-ring"
          />
          <div className="mt-2 flex justify-end gap-1.5">
            {column === "review" ? (
              <>
                <button
                  type="button"
                  disabled={send.busy}
                  onClick={() => void send.submit(undefined, "resolve")}
                  className="bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-40"
                >
                  Resolve
                </button>
                <button type="button" disabled={!words || send.busy} onClick={requestChanges} className="border border-border px-2 py-1 text-xs disabled:opacity-40">
                  Request changes
                </button>
              </>
            ) : (
              <button type="submit" disabled={!words || send.busy} className="bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-40">
                {question ? "Answer" : "Send"}
              </button>
            )}
          </div>
          {send.error === undefined ? null : (
            <p role="alert" className="mt-1 text-xs text-destructive">
              Not sent: {send.error}
            </p>
          )}
        </form>
      )}
    </aside>
  );
}
