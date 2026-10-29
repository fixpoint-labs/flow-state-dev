import type { LabAdapter, WorkerRow } from "../adapter";
import { useWatch } from "../lib/use-watch";
import { TaskCard } from "./TaskCard";

/**
 * The center, for the coding tasks: every one a teammate started, each
 * opening to its run, read only. Coding is a background task, not a teammate,
 * so there is no conversation and no composer; to change a coding task you
 * tell the teammate who started it. The task chosen on the left opens.
 */
export function Runs({
  adapter,
  workers,
  sessions,
  nameOf,
  isCoding,
  openRun,
}: {
  adapter: LabAdapter;
  /** The teammates, whose conversations start coding tasks. */
  workers: WorkerRow[];
  sessions: Record<string, string>;
  nameOf: (id: string) => string;
  isCoding: (id: string) => boolean;
  /** The coding task to open. */
  openRun: string;
}) {
  return (
    <main aria-label="Coding tasks" className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3">
        <h1 className="text-sm font-semibold">Coding tasks</h1>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">Code changes, run in the background in the working folder</span>
        <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">read only</span>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <div data-column className="mx-auto flex max-w-(--thread-width) flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            A coding task runs in the background. Each shows here and on its card in the conversation that started it. To change one, tell that
            teammate.
          </p>
          {workers
            .filter((w) => sessions[w.id])
            .map((w) => (
              <StartedBy
                key={w.id}
                adapter={adapter}
                sessionId={sessions[w.id]}
                nameOf={nameOf}
                isCoding={isCoding}
                openRun={openRun}
              />
            ))}
        </div>
      </div>
    </main>
  );
}

/** The coding tasks one conversation started. */
function StartedBy({
  adapter,
  sessionId,
  nameOf,
  isCoding,
  openRun,
}: {
  adapter: LabAdapter;
  sessionId: string;
  nameOf: (id: string) => string;
  isCoding: (id: string) => boolean;
  openRun: string;
}) {
  const tasks = (useWatch(adapter.watchTasks, sessionId) ?? []).filter((t) => isCoding(t.to));
  return tasks.map((t) => (
    <TaskCard
      key={t.id}
      adapter={adapter}
      task={t}
      nameOf={nameOf}
      coding
      defaultOpen={t.id === openRun}
    />
  ));
}
