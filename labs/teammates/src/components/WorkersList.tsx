import { useEffect, useState } from "react";
import type { LabAdapter, NewTeammate, WorkerRow } from "../adapter";
import { waitingOn } from "../lib/talk";
import { useSeen } from "../lib/unread";
import { age, useNow, useWatch } from "../lib/use-watch";
import { cn } from "../lib/utils";
import { HireForm } from "./TeammateForms";

/** The entries that count toward unread: everything but your own lines. */
const unreadable = (entries: { kind: string }[]) => entries.filter((e) => e.kind !== "user").length;

/**
 * The left pane: one row per teammate, never a list of sessions. Each row is
 * the teammate's name, what it is doing, a dot while it answers, and how many
 * new entries its conversation has since you last looked. Under them, the
 * coding tasks the teammates started, as background items that open to their
 * runs. At the foot, hire a teammate of your own.
 */
export function WorkersList({
  adapter,
  workers,
  sessions,
  selected,
  openRun,
  nameOf,
  isCoding,
  onSelect,
  onOpenRun,
  onHire,
}: {
  adapter: LabAdapter;
  /** The teammates: the workers you can talk to. */
  workers: WorkerRow[];
  sessions: Record<string, string>;
  selected: string | undefined;
  /** The coding task the center shows, when one is chosen. */
  openRun: string | undefined;
  nameOf: (id: string) => string;
  isCoding: (id: string) => boolean;
  onSelect: (worker: string) => void;
  onOpenRun: (task: string) => void;
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
              <BackgroundItems key={w.id} adapter={adapter} sessionId={sessions[w.id]} isCoding={isCoding} openRun={openRun} onOpen={onOpenRun} />
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
  sessionId,
  selected,
  seen,
  onSelect,
  onSeen,
}: {
  adapter: LabAdapter;
  worker: WorkerRow;
  nameOf: (id: string) => string;
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

  const waiting = waitingOn(worker.id, talk);
  const status = activity?.running
    ? "working"
    : waiting.length > 0
      ? `waiting on ${waiting.map(nameOf).join(", ")}`
      : activity
        ? activity.lastActiveAt > 0
          ? `idle · ${age(activity.lastActiveAt, now)}`
          : "idle"
        : "";
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      data-worker={worker.name}
      onClick={onSelect}
      className={cn("flex w-full items-center gap-3 border-l-2 border-transparent px-4 py-2.5 text-left hover:bg-accent", selected && "border-primary bg-accent")}
    >
      <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary font-mono text-xs font-bold uppercase">
        {worker.name.slice(0, 1)}
      </span>
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
  openRun,
  onOpen,
}: {
  adapter: LabAdapter;
  sessionId: string;
  isCoding: (id: string) => boolean;
  openRun: string | undefined;
  onOpen: (task: string) => void;
}) {
  const tasks = (useWatch(adapter.watchTasks, sessionId) ?? []).filter((t) => isCoding(t.to));
  return tasks.map((t) => (
    <li key={t.id}>
      <button
        type="button"
        aria-current={t.id === openRun ? "true" : undefined}
        aria-label={`Coding task: ${t.title}`}
        data-background={t.status}
        onClick={() => onOpen(t.id)}
        className={cn("flex w-full flex-col border-l-2 border-transparent px-4 py-1.5 text-left hover:bg-accent", t.id === openRun && "border-primary bg-accent")}
      >
        <span className="block truncate font-mono text-xs">⚙ {t.title}</span>
        <span className="block truncate text-xs text-muted-foreground" data-status>
          {t.status === "needs-project" ? "needs a project" : t.status === "running" ? "running" : t.status}
        </span>
      </button>
    </li>
  ));
}
