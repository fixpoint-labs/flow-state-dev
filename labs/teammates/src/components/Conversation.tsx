import { Fragment, useEffect, useRef } from "react";
import type { LabAdapter, WorkerRow } from "../adapter";
import { pendingFor } from "../lib/talk";
import { useWatch } from "../lib/use-watch";
import { cn } from "../lib/utils";
import { Composer } from "./Composer";
import { Entry } from "./Entry";

/**
 * The center: the worker's one conversation. A divider marks where the turns
 * the worker reads word for word begin. A message another worker sent that
 * waits for the current answer shows as a pending line until it lands.
 */
export function Conversation({
  adapter,
  worker,
  sessionId,
  nameOf,
  talkOpen,
  onToggleTalk,
}: {
  adapter: LabAdapter;
  worker: WorkerRow;
  sessionId: string;
  nameOf: (id: string) => string;
  talkOpen: boolean;
  onToggleTalk: () => void;
}) {
  const view = useWatch((emit: Parameters<LabAdapter["watchConversation"]>[1]) => adapter.watchConversation(sessionId, emit), [adapter, sessionId]);
  const mark = useWatch((emit: Parameters<LabAdapter["watchWindow"]>[1]) => adapter.watchWindow(sessionId, emit), [adapter, sessionId]);
  const talk = useWatch((emit: Parameters<LabAdapter["watchTalk"]>[1]) => adapter.watchTalk(worker.id, emit), [adapter, worker.id]) ?? [];
  const entries = view?.entries ?? [];
  const running = view?.running ?? false;
  const pending = pendingFor(worker.id, talk, entries);

  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [entries.length, running, pending.length, sessionId]);

  const markAt = mark ? entries.findIndex((e) => e.id === mark.firstVerbatimEntryId) : -1;
  return (
    <main aria-label="Conversation" className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3">
        <h1 className="text-sm font-semibold">{worker.name}</h1>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{worker.role}</span>
        {running ? (
          <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-info uppercase">
            <span className="size-2 animate-pulse rounded-full bg-info" /> working
          </span>
        ) : null}
        <button
          type="button"
          aria-pressed={talkOpen}
          onClick={onToggleTalk}
          className={cn("border border-border px-2 py-0.5 font-mono text-[10px] tracking-widest uppercase hover:bg-accent", talkOpen && "bg-accent")}
        >
          Talk
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
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
                <Entry entry={entry} workerName={worker.name} nameOf={nameOf} />
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
