import { useFollowLatest } from "@flow-state-dev/react";
import { useState, type FormEvent } from "react";
import type { LabAdapter, TaskRow } from "../adapter";
import { useWatch } from "../lib/use-watch";
import { Entry } from "./Entry";
import { ReviewCard } from "./ReviewCard";
import { Spend } from "./Spend";
import { HarnessTag, statusColumn, statusLine, ThreadIcon } from "./ThreadStatus";

/**
 * One thread, in place of the board. Its work reads the task's run session.
 * You can talk inside a thread (spec D3): your line is a steer on its task,
 * and answers its open question when it has one. When it is ready for
 * review, *Resolve* accepts it and *Request changes* sends your words back.
 * A finished thread's composer is off: you ask the main session to follow up.
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
  const feed = useFollowLatest({ resetKey: task.id });
  const column = statusColumn(task);
  const question = task.waitingOn && task.waitingOn.kind !== "review" ? task.waitingOn : undefined;
  const words = text.trim();
  const finished = task.status === "completed" || task.status === "cancelled" || task.status === "errored";

  const say = (event: FormEvent) => {
    event.preventDefault();
    if (!words) return;
    setText("");
    void adapter.sayInThread(sessionId, task.id, words);
  };
  const requestChanges = () => {
    if (!words) return;
    setText("");
    void adapter.requestChanges(sessionId, task.id, words);
  };

  return (
    <aside aria-label={`Thread: ${task.title}`} className="flex h-full min-h-0 flex-col bg-inspector">
      <div className="flex items-center gap-2 border-b border-border px-3 py-3">
        <button type="button" aria-label="Back to threads" onClick={onBack} className="px-1 text-sm hover:bg-accent">
          ←
        </button>
        <ThreadIcon task={task} />
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{task.title}</h2>
        <HarnessTag task={task} />
        <button
          type="button"
          aria-pressed={pinned}
          onClick={() => void (pinned ? adapter.unpin(task.id) : adapter.pin(task.id))}
          className="border border-border px-1.5 text-xs hover:bg-accent"
        >
          {pinned ? "Unpin" : "Pin"}
        </button>
      </div>
      {/* Ready for review is said once, by its card above the composer. */}
      {column === "review" ? null : <div className="px-4 pt-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">{statusLine(task)}</div>}
      <Spend task={task} split className="px-4" />
      <div ref={feed.ref} className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-2 [overflow-wrap:anywhere]">
        {work?.entries.map((entry) => <Entry key={entry.id} entry={entry} />)}
      </div>
      {question ? (
        <div role="note" className="mx-3 border border-attention bg-attention/10 px-3 py-2 text-sm [overflow-wrap:anywhere]">
          <span className="font-semibold">Waiting on you</span> · {question.prompt}
        </div>
      ) : null}
      {column === "review" ? <ReviewCard task={task} review={work?.review} /> : null}
      {finished ? (
        <p role="note" className="px-4 py-3 text-xs text-muted-foreground">
          This thread is finished. To follow up or retry, ask the main session.
        </p>
      ) : (
        <form onSubmit={say} className="px-3 py-3">
          <textarea
            aria-label="Message this thread"
            rows={2}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={question ? "Answer the thread…" : column === "review" ? "What should change…" : "Say something in this thread…"}
            className="block w-full resize-none border border-border bg-card px-3 py-2 text-sm outline-none focus:border-ring"
          />
          <div className="mt-2 flex justify-end gap-1.5">
            {column === "review" ? (
              <>
                <button type="button" onClick={() => void adapter.resolve(sessionId, task.id)} className="bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground">
                  Resolve
                </button>
                <button type="button" disabled={!words} onClick={requestChanges} className="border border-border px-2 py-1 text-xs disabled:opacity-40">
                  Request changes
                </button>
              </>
            ) : (
              <button type="submit" disabled={!words} className="bg-primary px-2 py-1 text-xs font-semibold text-primary-foreground disabled:opacity-40">
                {question ? "Answer" : "Send"}
              </button>
            )}
          </div>
        </form>
      )}
    </aside>
  );
}
