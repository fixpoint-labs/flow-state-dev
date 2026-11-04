import { useState } from "react";
import type { BoardTask, LabAdapter, WorkerRow } from "../adapter";
import type { Look } from "../lib/looks";
import { useWatch } from "../lib/use-watch";
import { cn } from "../lib/utils";
import { Avatar } from "./Avatar";
import { STALE_CLASS } from "./flow-state/connection-banner";
import { runsOn, taskLabel, taskLine, type Popup } from "./Popups";
import { InstructionsForm } from "./TeammateForms";
import { useStale } from "./WorkersList";

/** The heading over each of the panel's sections. */
const HEADING = "font-mono text-[10px] tracking-widest text-muted-foreground uppercase";

/** The ended groups, in the order the panel draws them, each collapsed to its count until opened. */
const ENDED = [
  { status: "done", label: "Done" },
  { status: "failed", label: "Failed" },
  { status: "cancelled", label: "Cancelled" },
] as const;

/** A teammate's tasks, split for the panel: the running ones, then each ending's, in filing order. */
function groupTasks(tasks: readonly BoardTask[]) {
  return {
    active: tasks.filter((t) => t.status === "running"),
    ended: ENDED.map(({ status, label }) => ({ status, label, tasks: tasks.filter((t) => t.status === status) })).filter((g) => g.tasks.length > 0),
  };
}

/**
 * The right pane: the selected teammate's panel. At the top, who it is (its
 * name and role) and *Edit instructions*, which opens the instructions form
 * for a teammate you hired; the teammates from the files can't be edited
 * here. Under it, the tasks its conversation filed, coding tasks and
 * teammates' jobs alike: the running ones first, then *Done*, *Failed* and
 * *Cancelled*, each one line with its count that opens to its rows. A task
 * that ends moves to its group as its row changes. Each row opens the task
 * in a popup. At the foot, a place for its routines, empty for now.
 */
export function TeammatePanel({
  adapter,
  worker,
  sessionId,
  openTask,
  nameOf,
  lookOf,
  isCoding,
  onOpen,
}: {
  adapter: LabAdapter;
  worker: WorkerRow;
  /** The teammate's one conversation: the tasks listed are the ones it filed. */
  sessionId: string;
  /** The task open in the popup, if one is. */
  openTask: string | undefined;
  nameOf: (id: string) => string;
  lookOf: (id: string) => Look;
  isCoding: (id: string) => boolean;
  onOpen: (popup: Popup) => void;
}) {
  const tasks = useWatch(adapter.watchTasks, sessionId) ?? [];
  const stale = useStale(adapter, sessionId);
  const { active, ended } = groupTasks(tasks);
  const [editing, setEditing] = useState(false);
  // Every ended group starts collapsed; a click opens it.
  const [opened, setOpened] = useState<Record<string, boolean>>({});

  const row = (t: BoardTask) => {
    const coding = isCoding(t.to);
    const line = taskLine(t, coding, nameOf);
    return (
      <li key={t.id}>
        <button
          type="button"
          aria-current={t.id === openTask ? "true" : undefined}
          aria-label={coding ? taskLabel(line, t) : line}
          data-task={t.status}
          onClick={() => onOpen({ kind: "task", sessionId, taskId: t.id })}
          className={cn("flex w-full flex-col border-l-2 border-transparent px-4 py-1.5 text-left hover:bg-accent", t.id === openTask && "border-primary bg-accent")}
        >
          <span className="block truncate text-xs">
            {coding ? "⚙ " : ""}
            {line}
          </span>
          <span className={cn("block truncate text-xs", t.status === "failed" ? "text-destructive" : "text-muted-foreground", stale && STALE_CLASS)} data-status>
            {[t.waiting ? "waiting on you" : t.status, runsOn(t)].filter(Boolean).join(" · ")}
          </span>
        </button>
      </li>
    );
  };

  return (
    <aside aria-label={`${worker.name}'s panel`} className="flex h-full min-h-0 flex-col border-l border-border bg-inspector">
      <section aria-label="Teammate" className="flex flex-col gap-2 border-b border-border px-4 pt-4 pb-3">
        <div className="flex items-center gap-3">
          <Avatar look={lookOf(worker.id)} />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{worker.name}</h2>
        </div>
        <p className="text-xs text-muted-foreground">{worker.role}</p>
        {worker.own ? (
          editing ? (
            <InstructionsForm
              name={worker.name}
              onSave={async (instructions) => {
                await adapter.editInstructions(worker.id, instructions);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <button type="button" onClick={() => setEditing(true)} className="w-fit rounded-sm border border-border px-2 py-0.5 font-mono text-[10px] tracking-widest uppercase hover:bg-accent">
              Edit instructions
            </button>
          )
        ) : (
          <>
            <button
              type="button"
              disabled
              aria-describedby="standard-teammate"
              className="w-fit rounded-sm border border-border px-2 py-0.5 font-mono text-[10px] tracking-widest uppercase opacity-40"
            >
              Edit instructions
            </button>
            <p id="standard-teammate" className="text-xs text-muted-foreground">
              {worker.name} comes from the lab's files, so its instructions can't be changed here yet.
            </p>
          </>
        )}
      </section>
      <div className="flex-1 overflow-y-auto pb-4">
        <section aria-labelledby="tasks-heading">
          <div id="tasks-heading" className={cn(HEADING, "px-4 pt-4 pb-2")}>
            Tasks
          </div>
          {tasks.length === 0 ? <p className="px-4 text-xs text-muted-foreground">{worker.name} hasn't started any tasks yet.</p> : null}
          {active.length > 0 ? <ul aria-label="Active">{active.map(row)}</ul> : null}
          {ended.map((group) => {
            const open = opened[group.status] ?? false;
            return (
              <div key={group.status}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpened((o) => ({ ...o, [group.status]: !open }))}
                  className="flex w-full items-center justify-between px-4 py-1.5 text-left text-xs hover:bg-accent"
                >
                  <span className={cn(group.status === "failed" && "text-destructive")}>
                    {group.label} ({group.tasks.length})
                  </span>
                  <span aria-hidden className="font-mono text-muted-foreground">
                    {open ? "▾" : "▸"}
                  </span>
                </button>
                {open ? <ul aria-label={group.label}>{group.tasks.map(row)}</ul> : null}
              </div>
            );
          })}
        </section>
        <section aria-labelledby="routines-heading">
          <div id="routines-heading" className={cn(HEADING, "px-4 pt-4 pb-2")}>
            Routines
          </div>
          <p className="px-4 text-xs text-muted-foreground">None yet.</p>
        </section>
      </div>
    </aside>
  );
}
