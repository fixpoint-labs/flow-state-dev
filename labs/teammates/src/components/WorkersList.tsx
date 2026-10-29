import { useEffect, useState } from "react";
import type { LabAdapter, NewTeammate, WorkerRow } from "../adapter";
import { runsOn, taskLabel, type Popup } from "./Popups";
import type { Look } from "../lib/looks";
import { statusLine } from "../lib/status";
import { useSeen } from "../lib/unread";
import { useNow, useWatch } from "../lib/use-watch";
import { cn } from "../lib/utils";
import { Avatar } from "./Avatar";
import { HireForm } from "./TeammateForms";

/** The entries that count toward unread: everything but your own lines. */
const unreadable = (entries: { kind: string }[]) => entries.filter((e) => e.kind !== "user").length;

/**
 * The left pane: one row per teammate, never a list of sessions. Each row is
 * the teammate's icon on its color, its name, what it is doing, a dot while it answers, and how many
 * new entries its conversation has since you last looked. Under them, the
 * coding tasks the teammates started, as background items that open their
 * runs in a popup. At the foot, hire a teammate of your own.
 */
export function WorkersList({
  adapter,
  workers,
  sessions,
  selected,
  openTask,
  nameOf,
  lookOf,
  isCoding,
  onSelect,
  onOpen,
  onHire,
}: {
  adapter: LabAdapter;
  /** The teammates: the workers you can talk to. */
  workers: WorkerRow[];
  sessions: Record<string, string>;
  selected: string | undefined;
  /** The task open in the popup, if one is. */
  openTask: string | undefined;
  nameOf: (id: string) => string;
  lookOf: (id: string) => Look;
  isCoding: (id: string) => boolean;
  onSelect: (worker: string) => void;
  onOpen: (popup: Popup) => void;
  onHire: (teammate: NewTeammate) => Promise<void>;
}) {
  const [seen, markSeen] = useSeen();
  const [hiring, setHiring] = useState(false);
  return (
    <nav aria-label="Workers" className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="px-4 pt-4 pb-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">Teammates</div>
      <div className="flex-1 overflow-y-auto pb-4">
        <ul>
          {workers.map((w) => (
            <li key={w.id}>
              <WorkerItem
                adapter={adapter}
                worker={w}
                nameOf={nameOf}
                look={lookOf(w.id)}
                isCoding={isCoding}
                sessionId={sessions[w.id]}
                selected={w.id === selected}
                seen={seen[w.id]}
                onSelect={() => onSelect(w.id)}
                onSeen={(count) => markSeen(w.id, count)}
              />
            </li>
          ))}
        </ul>
        <div id="background" className="px-4 pt-4 pb-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">Background</div>
        <ul aria-labelledby="background">
          {workers
            .filter((w) => sessions[w.id])
            .map((w) => (
              <BackgroundItems key={w.id} adapter={adapter} sessionId={sessions[w.id]} isCoding={isCoding} openTask={openTask} onOpen={onOpen} />
            ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2 px-4 py-3 text-xs text-muted-foreground">
        {hiring ? (
          <HireForm
            onHire={async (teammate) => {
              await onHire(teammate);
              setHiring(false);
            }}
            onCancel={() => setHiring(false)}
          />
        ) : (
          <button type="button" onClick={() => setHiring(true)} className="w-fit rounded-sm border border-border px-2 py-1 text-foreground hover:bg-accent">
            Hire a teammate
          </button>
        )}
        <span>One conversation per worker</span>
      </div>
    </nav>
  );
}

function WorkerItem({
  adapter,
  worker,
  nameOf,
  look,
  isCoding,
  sessionId,
  selected,
  seen,
  onSelect,
  onSeen,
}: {
  adapter: LabAdapter;
  worker: WorkerRow;
  nameOf: (id: string) => string;
  look: Look;
  isCoding: (id: string) => boolean;
  sessionId: string | undefined;
  selected: boolean;
  seen: number | undefined;
  onSelect: () => void;
  onSeen: (count: number) => void;
}) {
  const now = useNow();
  const activity = useWatch(adapter.watchActivity, worker.id);
  const talk = useWatch(adapter.watchTalk, worker.id) ?? [];
  const view = useWatch(adapter.watchConversation, sessionId);
  const count = view ? unreadable(view.entries) : undefined;
  // The open conversation is seen as it grows; a worker never seen starts with nothing unread.
  useEffect(() => {
    if (count !== undefined && (selected || seen === undefined)) onSeen(count);
  }, [count, selected, seen, onSeen]);
  const unread = count !== undefined && seen !== undefined ? Math.max(0, count - seen) : 0;

  const tasks = useWatch(adapter.watchTasks, sessionId) ?? [];
  const status = statusLine(worker.id, { activity, entries: view?.entries ?? [], talk, tasks, now }, nameOf, isCoding);
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      data-worker={worker.name}
      onClick={onSelect}
      className={cn("flex w-full items-center gap-3 border-l-2 border-transparent px-4 py-2.5 text-left hover:bg-accent", selected && "border-primary bg-accent")}
    >
      <Avatar look={look} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm", (selected || unread > 0) && "font-semibold")}>{worker.name}</span>
        <span className="block truncate text-xs text-muted-foreground" data-status>
          {status}
        </span>
      </span>
      <span className="flex flex-col items-end gap-1">
        <span aria-label={activity?.running ? "answering" : undefined} className={cn("size-2 rounded-full", activity?.running ? "animate-pulse bg-info" : "bg-transparent")} />
        {unread > 0 ? (
          <span aria-label={`${unread} unread`} className="min-w-5 rounded-full bg-primary px-1.5 text-center font-mono text-[10px] font-bold text-primary-foreground">
            {unread}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** The coding tasks one teammate's conversation started, one background item each. */
function BackgroundItems({
  adapter,
  sessionId,
  isCoding,
  openTask,
  onOpen,
}: {
  adapter: LabAdapter;
  sessionId: string;
  isCoding: (id: string) => boolean;
  openTask: string | undefined;
  onOpen: (popup: Popup) => void;
}) {
  const tasks = (useWatch(adapter.watchTasks, sessionId) ?? []).filter((t) => isCoding(t.to));
  return tasks.map((t) => (
    <li key={t.id}>
      <button
        type="button"
        aria-current={t.id === openTask ? "true" : undefined}
        aria-label={taskLabel(`Coding task: ${t.title}`, t)}
        data-background={t.status}
        onClick={() => onOpen({ kind: "task", sessionId, taskId: t.id })}
        className={cn("flex w-full flex-col border-l-2 border-transparent px-4 py-1.5 text-left hover:bg-accent", t.id === openTask && "border-primary bg-accent")}
      >
        <span className="block truncate font-mono text-xs">⚙ {t.title}</span>
        <span className="block truncate text-xs text-muted-foreground" data-status>
          {[t.status, runsOn(t)].filter(Boolean).join(" · ")}
        </span>
      </button>
    </li>
  ));
}
