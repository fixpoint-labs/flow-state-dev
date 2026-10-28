import type { LabAdapter, ProjectRow, WorkerRow } from "../adapter";
import { useWatch } from "../lib/use-watch";
import { TaskCard } from "./TaskCard";

/**
 * The center, for a worker that takes tasks only: its runs, read only. It has
 * no conversation and takes no messages, so there is no composer; work
 * reaches it as a task another worker files.
 */
export function Runs({
  adapter,
  worker,
  workers,
  sessions,
  projects,
  nameOf,
}: {
  adapter: LabAdapter;
  worker: WorkerRow;
  workers: WorkerRow[];
  sessions: Record<string, string>;
  projects: ProjectRow[];
  nameOf: (id: string) => string;
}) {
  return (
    <main aria-label="Runs" className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3">
        <h1 className="text-sm font-semibold">{worker.name}</h1>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{worker.role}</span>
        <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">takes tasks · {worker.harness}</span>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {worker.name} takes tasks only, so it has no conversation. Ask another worker to hand it a job; each run shows here and on the card in that
            conversation.
          </p>
          {workers
            .filter((w) => sessions[w.id])
            .map((w) => (
              <FiledBy key={w.id} adapter={adapter} filer={w} sessionId={sessions[w.id]} runner={worker.id} projects={projects} nameOf={nameOf} />
            ))}
        </div>
      </div>
    </main>
  );
}

/** The tasks one conversation filed for `runner`. */
function FiledBy({
  adapter,
  filer,
  sessionId,
  runner,
  projects,
  nameOf,
}: {
  adapter: LabAdapter;
  filer: WorkerRow;
  sessionId: string;
  runner: string;
  projects: ProjectRow[];
  nameOf: (id: string) => string;
}) {
  const tasks = (useWatch(adapter.watchTasks, sessionId) ?? []).filter((t) => t.to === runner);
  const workProject = useWatch(adapter.watchWorkProject, filer.id);
  return tasks.map((t) => (
    <TaskCard key={t.id} adapter={adapter} task={t} filer={filer.name} workProject={workProject} projects={projects} nameOf={nameOf} defaultOpen />
  ));
}
