import { Fragment, useEffect, useRef } from "react";
import type { LabAdapter, ProjectRow, WorkerRow } from "../adapter";
import { pendingFor } from "../lib/talk";
import { useWatch } from "../lib/use-watch";
import { cn } from "../lib/utils";
import { Composer } from "./Composer";
import { Entry } from "./Entry";
import { TaskCard } from "./TaskCard";

/** Your line to the worker once you picked its project from a card that asked. */
export const PICKED_LINE = "I picked a project for you. File the task again.";

/**
 * The center: the worker's one conversation. A divider marks where the turns
 * the worker reads word for word begin. A message another worker sent that
 * waits for the current answer shows as a pending line until it lands. The
 * header carries the worker's project: none is needed to talk, and the first
 * job that needs files asks for one on its task card.
 */
export function Conversation({
  adapter,
  worker,
  sessionId,
  projects,
  nameOf,
  talkOpen,
  onToggleTalk,
}: {
  adapter: LabAdapter;
  worker: WorkerRow;
  sessionId: string;
  projects: ProjectRow[];
  nameOf: (id: string) => string;
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
  const workProject = useWatch(adapter.watchWorkProject, worker.id);
  // A job refused for want of a project waits on the pick, from its card or the header.
  const waiting = !workProject && tasks.some((t) => t.status === "needs-project");
  // The pick is stored on the worker, then said to it as your line, so it files the job again. The line
  // doesn't name the project: the job is filed in the stored one, never in one the worker names.
  const pick = async (project: string) => {
    await adapter.setWorkProject(worker.id, project);
    await adapter.send(sessionId, PICKED_LINE);
  };

  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [entries.length, running, pending.length, sessionId]);

  // A card shows once the board's row has arrived.
  const taskTile = (taskId: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return null;
    return <TaskCard adapter={adapter} task={task} filer={worker.name} workProject={workProject} projects={projects} nameOf={nameOf} onPick={(p) => void pick(p)} />;
  };

  const markAt = mark ? entries.findIndex((e) => e.id === mark.firstVerbatimEntryId) : -1;
  return (
    <main aria-label="Conversation" className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3">
        <h1 className="text-sm font-semibold">{worker.name}</h1>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{worker.role}</span>
        <select
          aria-label={`Project for ${worker.name}`}
          value={workProject ?? ""}
          onChange={(e) => void (waiting ? pick(e.target.value) : adapter.setWorkProject(worker.id, e.target.value))}
          className="rounded-sm border border-border bg-card px-1 py-0.5 font-mono text-[10px] tracking-widest uppercase"
        >
          <option value="" disabled>
            no project
          </option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              in · {p.name}
            </option>
          ))}
        </select>
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
                {entry.kind === "task" ? (
                  taskTile(entry.taskId)
                ) : (
                  <Entry entry={entry} workerName={worker.name} nameOf={nameOf} />
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
