import { Fragment, useEffect, useRef, useState } from "react";
import type { LabAdapter, WorkerRow } from "../adapter";
import { pendingFor } from "../lib/talk";
import { useWatch } from "../lib/use-watch";
import { cn } from "../lib/utils";
import { Composer } from "./Composer";
import { Entry } from "./Entry";
import { TaskCard } from "./TaskCard";
import { InstructionsForm } from "./TeammateForms";

/** A small button in the conversation's header. */
const HEADER_BUTTON = "rounded-sm border border-border px-2 py-0.5 font-mono text-[10px] tracking-widest uppercase hover:bg-accent";

/**
 * The center: the worker's one conversation. A divider marks where the turns
 * the worker reads word for word begin. A message another worker sent that
 * waits for the current answer shows as a pending line until it lands. A
 * teammate the user hired also gets its instructions and a fire control in
 * the header.
 */
export function Conversation({
  adapter,
  worker,
  sessionId,
  nameOf,
  isCoding,
  onFire,
  talkOpen,
  onToggleTalk,
}: {
  adapter: LabAdapter;
  worker: WorkerRow;
  sessionId: string;
  nameOf: (id: string) => string;
  /** The worker is the one coding tasks run on, not a teammate. */
  isCoding: (id: string) => boolean;
  onFire: () => Promise<void>;
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
  const [panel, setPanel] = useState<"instructions">();
  const fire = () => {
    if (window.confirm(`Fire ${worker.name}? It leaves your roster; this conversation stays readable.`)) void onFire();
  };

  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [entries.length, running, pending.length, sessionId]);

  // A card shows once the board's row has arrived.
  const taskTile = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return null;
    return (
      <TaskCard
        adapter={adapter}
        task={task}
        nameOf={nameOf}
        coding={isCoding(task.to)}
      />
    );
  };

  const markAt = mark ? entries.findIndex((e) => e.id === mark.firstVerbatimEntryId) : -1;
  return (
    <main aria-label="Conversation" className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3">
        <h1 className="text-sm font-semibold">{worker.name}</h1>
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
      <div className="flex-1 overflow-y-auto px-6 py-4">
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
                  taskTile(entry.taskId)
                ) : (
                  <Entry
                    entry={entry}
                    workerName={worker.name}
                    nameOf={nameOf}
                    isCoding={isCoding}
                    {...(entry.kind === "approval" ? { onAnswer: (approve: boolean) => adapter.answerApproval(sessionId, entry, approve) } : {})}
                  />
                )}
              </div>
            </Fragment>
          ))}
          {running ? (
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
          <div ref={end} />
        </div>
      </div>
      <Composer workerName={worker.name} running={running} onSend={(text) => void adapter.send(sessionId, text)} />
    </main>
  );
}
