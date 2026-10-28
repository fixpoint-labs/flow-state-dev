import { useState } from "react";
import type { LabAdapter, ProjectRow, BoardTask } from "../adapter";
import { useWatch } from "../lib/use-watch";
import { cn } from "../lib/utils";

/**
 * A task a conversation filed for a worker that takes tasks: one line with
 * what it is and where it runs, opening to the run, read only. A run refused
 * for want of a project asks for one on the card; picking it is the only
 * thing that starts a run.
 */
export function TaskCard({
  adapter,
  task,
  filer,
  workProject,
  projects,
  nameOf,
  onPick,
  defaultOpen = false,
}: {
  adapter: LabAdapter;
  task: BoardTask;
  /** The worker whose conversation filed it. */
  filer: string;
  /** The filer's project, once picked. */
  workProject: string | undefined;
  projects: ProjectRow[];
  nameOf: (id: string) => string;
  /** Present where a pick can be made: the filer's own conversation. */
  onPick?: (project: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const steps = useWatch(adapter.watchRun, open ? task.id : undefined) ?? [];
  const to = nameOf(task.to);
  const status =
    task.status === "needs-project"
      ? workProject
        ? "refused · no project"
        : "needs a project"
      : task.status === "running"
        ? task.project ? `running in ${task.project}` : "running"
        : task.status === "failed"
          ? "failed"
          : `done in ${task.project}`;
  const asking = task.status === "needs-project" && !workProject && onPick;
  return (
    <div
      data-entry="task"
      data-status={task.status}
      className={cn("max-w-[85%] rounded-md border border-dashed", asking ? "border-attention bg-attention/10" : "border-success/60")}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Task for ${to}: ${task.title}`}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-2 px-3 py-1.5 text-left font-mono text-xs text-success hover:bg-success/5"
      >
        <span className="shrink-0">⚙ task for {to} ·</span>
        <span className="min-w-0 flex-1 truncate text-foreground">{task.title}</span>
        <span className={cn("shrink-0", asking ? "font-semibold text-foreground" : "text-muted-foreground")} data-task-status>
          {status}
        </span>
        <span aria-hidden className="shrink-0 text-muted-foreground">
          {open ? "▾" : "▸"}
        </span>
      </button>
      {asking ? <ProjectPrompt filer={filer} to={to} projects={projects} onPick={onPick} /> : null}
      {open ? (
        <ol aria-label={`Run of ${task.title}`} className="border-t border-dashed border-border px-3 py-2 font-mono text-xs text-muted-foreground">
          {task.status === "needs-project" ? <li>No run started: {filer} had no project.</li> : null}
          {steps.map((s) => (
            <li key={s.id}>· {s.text}</li>
          ))}
          {task.result ? <li className="text-foreground">{task.result}</li> : null}
        </ol>
      ) : null}
    </div>
  );
}

/** The ask for a project, the first time a job needs files. */
function ProjectPrompt({ filer, to, projects, onPick }: { filer: string; to: string; projects: ProjectRow[]; onPick: (project: string) => void }) {
  const [project, setProject] = useState(projects[0]?.id ?? "");
  return (
    <div role="group" aria-label="Pick a project" className="flex flex-wrap items-center gap-2 border-t border-dashed border-attention/60 px-3 py-2 text-xs">
      <span className="text-foreground">
        {to} needs a project to work in. Pick one for {filer}; it sticks to {filer}.
      </span>
      <select aria-label="Project" value={project} onChange={(e) => setProject(e.target.value)} className="border border-border bg-card px-1 py-0.5">
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!project}
        onClick={() => onPick(project)}
        className="rounded-md bg-primary px-2 py-0.5 font-semibold text-primary-foreground disabled:opacity-40"
      >
        Use project
      </button>
    </div>
  );
}
