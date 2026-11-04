import { useEffect } from "react";
import type { LabAdapter, NewTeammate, WorkerRow } from "../adapter";
import type { Look } from "../lib/looks";
import { statusLine } from "../lib/status";
import { useSeen } from "../lib/unread";
import { useNow, useWatch } from "../lib/use-watch";
import { cn } from "../lib/utils";
import { Avatar } from "./Avatar";
import { isFeedStale, STALE_CLASS } from "./flow-state/connection-banner";
import { HireForm } from "./TeammateForms";

/** The entries that count toward unread: everything but your own lines. */
const unreadable = (entries: { kind: string }[]) => entries.filter((e) => e.kind !== "user").length;

/**
 * The left pane: one row per teammate, never a list of sessions. Each row is
 * the teammate's icon on its color, its name, what it is doing, a dot while it answers, and how many
 * new entries its conversation has since you last looked. At the foot, hire
 * a teammate of your own. A teammate's tasks are in its panel, on the right.
 */
export function WorkersList({
  adapter,
  workers,
  sessions,
  selected,
  nameOf,
  lookOf,
  isCoding,
  onSelect,
  onHire,
  hiring,
  onHiring,
}: {
  adapter: LabAdapter;
  /** The teammates: the workers you can talk to. */
  workers: WorkerRow[];
  sessions: Record<string, string>;
  selected: string | undefined;
  nameOf: (id: string) => string;
  lookOf: (id: string) => Look;
  isCoding: (id: string) => boolean;
  onSelect: (worker: string) => void;
  onHire: (teammate: NewTeammate) => Promise<void>;
  /** The hire form is open; the switcher's *Hire a teammate* opens it too. */
  hiring: boolean;
  onHiring: (open: boolean) => void;
}) {
  const [seen, markSeen] = useSeen();
  const setHiring = onHiring;
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
  // A row whose conversation's feed lost the server greys its status, and its age stops.
  const stale = useStale(adapter, sessionId);
  const now = useNow(undefined, !stale);
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
        <span className={cn("block truncate text-xs text-muted-foreground", stale && STALE_CLASS)} data-status>
          {status}
        </span>
      </span>
      <span className={cn("flex flex-col items-end gap-1", stale && STALE_CLASS)}>
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

/** Whether a conversation's feed has lost the server, so what it last said may be out of date. */
export function useStale(adapter: LabAdapter, sessionId: string | undefined): boolean {
  const connection = useWatch(adapter.watchConnection, sessionId);
  return connection !== undefined && isFeedStale(connection);
}
