import { useCallback, useEffect, useMemo, useState } from "react";
import type { HireWorkerInput, RosterEntry } from "@flow-state-dev/workforce/browser";
import type { ItemLine } from "@flow-state-dev/react";
import { useConversation, useTasks } from "../app";
import type { Look } from "../lib/looks";
import { teammateAttention, supported, useAttention, useNotifyToggle, type TeammateAttention } from "../lib/attention";
import { useStable } from "../lib/stable";
import { displayName } from "../lib/roster";
import { freshEndings, needsOf, statusOf, useActivity } from "../lib/status";
import { isIdle, taskStatus, workerOf } from "../lib/task";
import { useTalk } from "../lib/talk";
import { useSeen } from "../lib/unread";
import { useNow, useStale } from "../lib/use-watch";
import { cn } from "../lib/utils";
import { Avatar } from "./Avatar";
import { STALE_CLASS } from "./flow-state/connection-banner";
import { HireForm, TeammateDialog, type SettingsChoices } from "./TeammateForms";
import { drawsLine } from "./lines";

/** The lines that count toward unread: every line the lab draws but your own. */
export const unreadable = (lines: readonly ItemLine[]) => lines.filter((line) => line.kind !== "user" && drawsLine(line)).length;

/**
 * The left pane: one row per teammate, never a list of sessions. Each row is
 * the teammate's icon on its color, its name, what it is doing, a dot while it answers, and how many
 * new lines its conversation has since you last looked. At the foot, hire
 * a teammate of your own. A teammate's tasks are in its panel, on the right.
 *
 * A teammate that needs you (an approval it waits on, or a task of its that
 * waits on you) says so first on its line, with a badge in the attention
 * colour; it keeps its place in the list. The tab's title counts the
 * teammates with something for you, and *Notify me*, in the foot, adds a
 * desktop notification while the tab is in the background.
 */
export function WorkersList({
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
  workspace,
  choices,
  defaults,
}: {
  /** The teammates: the workers you can talk to. */
  workers: RosterEntry[];
  sessions: Record<string, string>;
  selected: string | undefined;
  nameOf: (id: string) => string;
  lookOf: (id: string) => Look;
  isCoding: (id: string) => boolean;
  onSelect: (worker: string) => void;
  onHire: (teammate: HireWorkerInput) => Promise<void>;
  /** The hire form is open; the switcher's *Hire a teammate* opens it too. */
  hiring: boolean;
  onHiring: (open: boolean) => void;
  /** The working folder's name (and full path for its tooltip), shown under the app's name. */
  workspace?: { name: string; path: string };
  /** What a new teammate's model and default coding harness are picked from. */
  choices?: SettingsChoices;
  /** The lab's model and default harness: where the hire form's settings start. */
  defaults?: { model?: string; harness?: string };
}) {
  const [seen, markSeen] = useSeen();
  const setHiring = onHiring;
  const notify = useNotifyToggle();
  // What each row reports: whether it has something for you, and what is new. A fired teammate's report leaves with its row.
  const [reports, setReports] = useState<Record<string, TeammateAttention>>({});
  const report = useCallback((worker: string, attention: TeammateAttention) => setReports((prev) => (prev[worker] === attention ? prev : { ...prev, [worker]: attention })), []);
  const current = useMemo(() => Object.fromEntries(workers.flatMap((w) => (reports[w.id] === undefined ? [] : [[w.id, reports[w.id]!]]))), [workers, reports]);
  useAttention(current, notify.on);
  // Something waits on you while notifications are off: point at the switch, so the next one isn't missed.
  const waiting = Object.values(current).some((a) => a.alerts.some((alert) => !alert.key.startsWith("ended:")));
  const nudge = waiting && !notify.on && supported();
  return (
    <nav aria-label="Workers" className="flex h-full min-h-0 flex-col border-r border-border bg-sidebar">
      <div className="flex items-center gap-2.5 px-4 pt-4 pb-3">
        <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-foreground text-background">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="9" cy="8" r="3" />
            <circle cx="16" cy="9" r="2.5" />
            <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M14.5 14.2c3 .1 5.5 1.9 5.5 4.8" />
          </svg>
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">Teammates</span>
          {workspace ? (
            <span className="block truncate font-mono text-xs text-text-3" title={workspace.path}>
              {workspace.name}
            </span>
          ) : null}
        </span>
      </div>
      <div className="flex items-center justify-between px-4 pt-2 pb-1.5">
        <span className="text-xs font-medium tracking-wider text-text-3 uppercase">Team · {workers.length}</span>
        <button
          type="button"
          aria-label="Hire a teammate"
          title="Hire a teammate"
          onClick={() => setHiring(true)}
          className="flex size-6 items-center justify-center rounded-sm text-text-3 hover:bg-accent hover:text-foreground"
        >
          <PlusIcon />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-4">
        <ul className="flex flex-col gap-0.5">
          {workers.map((w) => (
            <li key={w.id}>
              <WorkerItem
                worker={w}
                nameOf={nameOf}
                look={lookOf(w.id)}
                isCoding={isCoding}
                sessionId={sessions[w.id]}
                selected={w.id === selected}
                seen={seen[w.id]}
                onSelect={() => onSelect(w.id)}
                onSeen={(count) => markSeen(w.id, count)}
                onReport={report}
              />
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-3 border-t border-border px-4 py-3 text-xs text-text-2">
        <button
          type="button"
          onClick={() => setHiring(true)}
          className="flex w-full items-center justify-center gap-2 rounded-sm border border-border-strong px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
        >
          <PlusIcon />
          Hire a teammate
        </button>
        <TeammateDialog open={hiring} onOpenChange={setHiring} title="Hire a teammate" description="A new teammate with its own conversation. Lead asks it for work that fits its role.">
          {/* Mounted only while open, so each hire starts from an empty form. */}
          {hiring ? (
            <HireForm
              choices={choices}
              defaults={defaults}
              onHire={async (teammate) => {
                await onHire(teammate);
                setHiring(false);
              }}
              onCancel={() => setHiring(false)}
            />
          ) : null}
        </TeammateDialog>
        <div className={cn("flex flex-col gap-1.5", nudge && "-mx-2 rounded-sm border border-warning-line bg-warning-soft px-2 py-1.5")} data-notify-nudge={nudge ? "" : undefined}>
          <label className="flex items-center justify-between gap-2">
            <span>Notify me when tasks finish</span>
            <button
              type="button"
              role="switch"
              aria-checked={notify.on}
              disabled={!supported()}
              onClick={() => void notify.toggle()}
              className={cn(
                "relative h-4 w-7 shrink-0 rounded-full border transition-colors disabled:opacity-50",
                notify.on ? "border-brand bg-brand" : "border-border-strong bg-surface-raised",
              )}
            >
              <span aria-hidden className={cn("absolute top-1/2 size-3 -translate-y-1/2 rounded-full transition-all", notify.on ? "left-[13px] bg-brand-foreground" : "left-px bg-text-2")} />
            </button>
          </label>
          {nudge ? <span className="text-warning-text">Something is waiting on you. Turn this on to hear about the next one.</span> : null}
        </div>
        {notify.blocked === undefined ? null : <span data-notify-blocked>{notify.blocked}</span>}
        <span className="text-text-3">One conversation per teammate</span>
      </div>
    </nav>
  );
}

function PlusIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function WorkerItem({
  worker,
  nameOf,
  look,
  isCoding,
  sessionId,
  selected,
  seen,
  onSelect,
  onSeen,
  onReport,
}: {
  worker: RosterEntry;
  nameOf: (id: string) => string;
  look: Look;
  isCoding: (id: string) => boolean;
  sessionId: string | undefined;
  selected: boolean;
  seen: number | undefined;
  onSelect: () => void;
  onSeen: (count: number) => void;
  onReport: (worker: string, attention: TeammateAttention) => void;
}) {
  // A row whose conversation's feed lost the server greys its status, and its age stops.
  const stale = useStale(sessionId);
  const now = useNow(undefined, !stale);
  const activity = useActivity(worker.id);
  const talk = useTalk(worker.id) ?? [];
  const view = useConversation(sessionId)?.view;
  const count = view ? unreadable(view.lines) : undefined;
  // The open conversation is seen as it grows; a worker never seen starts with nothing unread.
  useEffect(() => {
    if (count !== undefined && (selected || seen === undefined)) onSeen(count);
  }, [count, selected, seen, onSeen]);
  const unread = count !== undefined && seen !== undefined ? Math.max(0, count - seen) : 0;

  const taskList = useTasks(sessionId).value;
  const tasks = taskList ?? [];
  // Loaded once its conversation and its tasks have arrived; a teammate with no conversation yet has nothing to load.
  const loaded = sessionId === undefined || (view !== undefined && taskList !== undefined);
  const inputs = { activity, lines: view?.lines ?? [], talk, tasks, now };
  const status = statusOf(worker.id, inputs, nameOf, isCoding);
  // Reported up for the tab's title and the notifications; the same object while its content holds, so it reports only on change.
  const attention = useStable(teammateAttention(displayName(worker), loaded, unread, needsOf(inputs), freshEndings(tasks, now, isCoding)));
  useEffect(() => onReport(worker.id, attention), [onReport, worker.id, attention]);
  const working = activity?.running === true || tasks.some((t) => taskStatus(t) === "running" && !isIdle(t) && isCoding(workerOf(t)));
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      data-worker={displayName(worker)}
      onClick={onSelect}
      className={cn("flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-accent", selected && "bg-selected ring-1 ring-border ring-inset")}
    >
      <Avatar look={look} presence={working ? "working" : "idle"} />
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-sm font-medium text-foreground", unread > 0 && "font-semibold")}>{displayName(worker)}</span>
        <span className={cn("block truncate text-xs", status.tone === "text-muted-foreground" ? "text-text-3" : status.tone, stale && STALE_CLASS)} data-status>
          {status.text}
        </span>
      </span>
      <span className={cn("flex flex-col items-end gap-1", stale && STALE_CLASS)}>
        {activity?.running ? <span className="sr-only">answering</span> : null}
        {status.needsYou ? (
          <span aria-label="needs you" data-needs-you className="flex size-5 items-center justify-center rounded-full bg-attention font-mono text-xs font-bold text-attention-foreground">
            !
          </span>
        ) : null}
        {unread > 0 ? (
          <span aria-label={`${unread} unread`} className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 font-mono text-xs font-semibold text-brand-foreground">
            {unread}
          </span>
        ) : null}
      </span>
    </button>
  );
}
