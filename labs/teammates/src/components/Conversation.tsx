import { Fragment, useCallback, useRef, useState } from "react";
import type { BoardTask, ConversationEntry, LabAdapter, WorkerRow } from "../adapter";
import type { Look } from "../lib/looks";
import { useStatusLine } from "../lib/status";
import { useStickToBottom } from "../lib/stick-to-bottom";
import { pendingFor } from "../lib/talk";
import { useWatch } from "../lib/use-watch";
import { cn } from "../lib/utils";
import { Avatar } from "./Avatar";
import { Composer } from "./Composer";
import { Entry } from "./Entry";
import { repliedIn, type Popup } from "./Popups";
import { TaskCard } from "./TaskCard";
import { InstructionsForm } from "./TeammateForms";

/** A small button in the conversation's header. */
const HEADER_BUTTON = "rounded-sm border border-border px-2 py-0.5 font-mono text-[10px] tracking-widest uppercase hover:bg-accent";

type TaskEntry = Extract<ConversationEntry, { kind: "task" }>;
const placeholders = new WeakMap<TaskEntry, BoardTask>();
/** The card a filed task shows until its board row arrives: one object per (reused) entry, so the memoized card skips re-renders. */
function placeholderOf(entry: TaskEntry): BoardTask {
  let task = placeholders.get(entry);
  if (task === undefined) {
    task = { id: entry.taskId, to: entry.to, title: entry.title, status: "running" };
    placeholders.set(entry, task);
  }
  return task;
}

/**
 * The center: the worker's one conversation. A divider marks where the turns
 * the worker reads word for word begin. A message another worker sent that
 * waits for the current answer shows as a pending line until it lands. A
 * teammate the user hired also gets its instructions and a fire control in
 * the header.
 *
 * New content settles in place: the list follows it only while you are at
 * the end, and offers *Jump to latest* when you have scrolled up. A task card
 * is drawn at its full size the moment it is filed, before its row arrives,
 * and "is answering" shows only until the turn's answer text starts.
 */
export function Conversation({
  adapter,
  worker,
  sessionId,
  nameOf,
  lookOf,
  isCoding,
  onFire,
  onOpen,
  talkOpen,
  onToggleTalk,
}: {
  adapter: LabAdapter;
  worker: WorkerRow;
  sessionId: string;
  nameOf: (id: string) => string;
  lookOf: (id: string) => Look;
  /** The worker is the one coding tasks run on, not a teammate. */
  isCoding: (id: string) => boolean;
  onFire: () => Promise<void>;
  /** Open a popup over the thread: a task this conversation filed, or a message it sent. */
  onOpen: (popup: Popup) => void;
  talkOpen: boolean;
  onToggleTalk: () => void;
}) {
  const view = useWatch(adapter.watchConversation, sessionId);
  const mark = useWatch(adapter.watchWindow, sessionId);
  const talk = useWatch(adapter.watchTalk, worker.id) ?? [];
  const entries = view?.entries ?? [];
  const running = view?.running ?? false;
  const pending = pendingFor(worker.id, talk, entries);
  const tasks = useWatch(adapter.watchTasks, sessionId) ?? [];
  const status = useStatusLine(adapter, worker, sessionId, nameOf, isCoding);
  const [panel, setPanel] = useState<"instructions">();
  const fire = () => {
    if (window.confirm(`Fire ${worker.name}? It leaves your roster; this conversation stays readable.`)) void onFire();
  };

  const last = entries[entries.length - 1];
  // An answer on screen, written or being written, is the sign it is answering; the line shows only before one starts.
  const answering = running && last?.kind !== "assistant";
  const scroller = useRef<HTMLDivElement>(null);
  const { atEnd, jumpToLatest } = useStickToBottom(
    scroller,
    `${sessionId}:${entries.length}:${last && "text" in last ? last.text.length : 0}:${pending.length}:${answering}`,
  );

  // Stable, so a memoized line doesn't redraw for a new function.
  const openTask = useCallback((taskId: string) => onOpen({ kind: "task", sessionId, taskId }), [onOpen, sessionId]);
  const openMessage = useCallback(
    (sent: Extract<ConversationEntry, { kind: "sent" }>) => onOpen({ kind: "message", from: worker.id, to: sent.to, messageId: sent.messageId, text: sent.text }),
    [onOpen, worker.id],
  );

  // A line is drawn from the filing until the board's row arrives, then from the row, in the same place.
  const taskTile = (entry: TaskEntry) => {
    const task = tasks.find((t) => t.id === entry.taskId) ?? placeholderOf(entry);
    return <TaskCard task={task} nameOf={nameOf} lookOf={lookOf} coding={isCoding(task.to)} onOpen={openTask} />;
  };

  const markAt = mark ? entries.findIndex((e) => e.id === mark.firstVerbatimEntryId) : -1;
  return (
    <main aria-label="Conversation" className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3">
        <Avatar look={lookOf(worker.id)} />
        <div className="min-w-0">
          <h1 className="text-sm font-semibold">{worker.name}</h1>
          <p className="truncate text-xs text-muted-foreground" data-header-status>
            {status}
          </p>
        </div>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{worker.role}</span>
        {worker.own ? (
          <>
            <button type="button" onClick={() => setPanel((p) => (p === "instructions" ? undefined : "instructions"))} className={HEADER_BUTTON}>
              Instructions
            </button>
            <button type="button" onClick={fire} className={HEADER_BUTTON}>
              Fire
            </button>
          </>
        ) : null}
        {running ? (
          <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-info uppercase">
            <span className="size-2 animate-pulse rounded-full bg-info" /> working
          </span>
        ) : null}
        <button
          type="button"
          aria-pressed={talkOpen}
          onClick={onToggleTalk}
          className={cn("rounded-sm border border-border px-2 py-0.5 font-mono text-[10px] tracking-widest uppercase hover:bg-accent", talkOpen && "bg-accent")}
        >
          Talk
        </button>
      </header>
      {panel === "instructions" ? (
        <div className="border-b border-border px-6 py-3">
          <InstructionsForm
            name={worker.name}
            onSave={async (instructions) => {
              await adapter.editInstructions(worker.id, instructions);
              setPanel(undefined);
            }}
            onCancel={() => setPanel(undefined)}
          />
        </div>
      ) : null}
      <div ref={scroller} data-scroller className="relative flex-1 overflow-y-auto px-6 py-4">
        <div data-column className="mx-auto flex max-w-(--thread-width) flex-col gap-3">
          {entries.length === 0 ? (
            <div className="mt-24 text-center text-sm text-muted-foreground">Say hello to {worker.name}. This is your one conversation with it.</div>
          ) : null}
          {entries.map((entry, i) => (
            <Fragment key={entry.id}>
              {i === markAt && mark ? (
                <div role="separator" aria-label={mark.summarized ? "Earlier turns summarized" : "Earlier turns out of view"} className="my-2 flex items-center gap-3">
                  <span className="h-px flex-1 bg-border" />
                  <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
                    {mark.summarized ? "Earlier turns summarized" : "Earlier turns out of view"}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              ) : null}
              <div className={cn(i < markAt && "opacity-60")} data-in-window={markAt < 0 || i >= markAt ? "true" : "false"}>
                {entry.kind === "task" ? (
                  taskTile(entry)
                ) : (
                  <Entry
                    entry={entry}
                    workerName={worker.name}
                    nameOf={nameOf}
                    lookOf={lookOf}
                    isCoding={isCoding}
                    replied={entry.kind === "sent" && repliedIn(talk, entry.messageId)}
                    onOpenMessage={openMessage}
                    onOpenTask={openTask}
                    {...(entry.kind === "approval" ? { onAnswer: (approve: boolean) => adapter.answerApproval(sessionId, entry, approve) } : {})}
                  />
                )}
              </div>
            </Fragment>
          ))}
          {answering ? (
            <div role="status" className="w-fit rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
              {worker.name} is answering…
            </div>
          ) : null}
          {pending.map((m) => (
            <div
              key={m.id}
              data-pending={m.id}
              className="w-fit rounded-md border border-dashed border-attention bg-attention/15 px-3 py-1.5 font-mono text-xs text-foreground"
            >
              ← {nameOf(m.from)} {m.inReplyTo ? "replied" : "sent a message"} · {worker.name} reads it {running ? "after this turn" : "next"}
            </div>
          ))}
        </div>
        {atEnd ? null : (
          <button
            type="button"
            onClick={jumpToLatest}
            className="sticky bottom-2 mx-auto block rounded-full border border-border bg-card px-3 py-1 text-xs shadow hover:bg-accent"
          >
            Jump to latest
          </button>
        )}
      </div>
      <Composer workerName={worker.name} running={running} onSend={(text) => void adapter.send(sessionId, text)} />
    </main>
  );
}
