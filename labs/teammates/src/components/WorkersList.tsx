import { ChevronRightIcon, MoonIcon, PanelLeftCloseIcon, PanelLeftOpenIcon, SunIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { HireWorkerInput, RosterEntry } from "@flow-state-dev/workforce/browser";
import type { ItemLine } from "@flow-state-dev/react";
import { useConversation, useTasks } from "../app";
import type { Look, TeammateColor } from "../lib/looks";
import { teammateAttention, supported, useAttention, useNotifyToggle, type TeammateAttention } from "../lib/attention";
import { useStable } from "../lib/stable";
import { displayName } from "../lib/roster";
import { freshEndings, needsOf, PLAIN, statusOf, useActivity, type Status } from "../lib/status";
import { useTalk } from "../lib/talk";
import { useSeen } from "../lib/unread";
import { useNow, useStale } from "../lib/use-watch";
import { SIDEBAR_WIDTH } from "../lib/sidebar";
import { useTheme } from "../lib/theme";
import { cn } from "../lib/utils";
import { Avatar } from "./Avatar";
import { STALE_CLASS } from "./flow-state/connection-banner";
import { HireForm, TeammateDialog, type SettingsChoices } from "./TeammateForms";
import { drawsLine } from "./lines";

/** The lines that count toward unread: every line the lab draws but your own. */
export const unreadable = (lines: readonly ItemLine[]) => lines.filter((line) => line.kind !== "user" && drawsLine(line)).length;

/**
 * The left pane: the lab's mark and the theme switch, then the team, one
 * entry per teammate, never a list of sessions. Each is the teammate's bot on
 * its color, drawn in its state, its name and role, what it is doing, and how
 * many new lines its conversation has since you last looked; the selected one
 * sits on a raised card. At the foot, hire a teammate of your own. A
 * teammate's tasks are in its panel, on the right.
 *
 * A teammate that needs you (an approval it waits on, or a task of its that
 * waits on you) says so first on its line, with a badge in the attention
 * colour, a yellow *you* pill; it keeps its place in the list. The tab's title counts the
 * teammates with something for you, and *Notify me*, in the foot, adds a
 * desktop notification while the tab is in the background.
 *
 * `collapsed` draws it as a rail: each teammate's icon with its badges, the
 * hire button, and the toggle that opens it again. The rows stay mounted, so
 * the tab's title and the notifications keep counting. With `overlay` it
 * opens over the conversation instead of taking its width.
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
  collapsed = false,
  overlay = false,
  onToggle,
  onClose,
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
  /** Drawn as a rail of icons rather than the full list. */
  collapsed?: boolean;
  /** Opened on a narrow window: it lies over the conversation, over a dimmed backdrop that closes it, and picking a teammate closes it. */
  overlay?: boolean;
  /** Collapses or opens it; without it there is no toggle. */
  onToggle?: () => void;
  /** Folds it back to the rail, for the overlay's backdrop and a pick. */
  onClose?: () => void;
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
  const team = teamOf(workers);
  const [teamOpen, setTeamOpen] = useState(true);
  const theme = useTheme();
  const list = (
    <ul aria-label={team.name} className="flex flex-col gap-0.5">
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
            onSelect={() => {
              onSelect(w.id);
              if (overlay) onClose?.();
            }}
            onSeen={(count) => markSeen(w.id, count)}
            onReport={report}
            compact={collapsed}
          />
        </li>
      ))}
    </ul>
  );
  return (
    // The cell keeps the grid's column whatever the sidebar does: an overlay lies over the conversation from here.
    <div className="relative min-h-0">
      {overlay ? <div aria-hidden data-sidebar-backdrop onClick={onClose} className="fixed inset-0 z-20 bg-black/50" /> : null}
      <nav
        aria-label="Workers"
        style={overlay ? { width: SIDEBAR_WIDTH.open } : undefined}
        className={cn("flex h-full min-h-0 flex-col border-r border-border bg-sidebar", overlay && "absolute inset-y-0 left-0 z-30 shadow-2xl")}
      >
        <div className={cn("flex items-center gap-2.5 pt-4 pb-3", collapsed ? "justify-center px-2" : "px-4")}>
          {collapsed ? null : (
            <>
              <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-md bg-foreground text-base leading-none font-bold text-background">
                T
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground">Teammates</span>
                {workspace ? (
                  <span className="block truncate font-mono text-xs text-text-3" title={workspace.path}>
                    {workspace.name}
                  </span>
                ) : null}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={theme.theme === "night"}
                aria-label="Night theme"
                title={theme.theme === "night" ? "Switch to Paper" : "Switch to Night"}
                onClick={theme.toggle}
                className={ICON_BUTTON}
              >
                {theme.theme === "night" ? <MoonIcon aria-hidden className="size-4" /> : <SunIcon aria-hidden className="size-4" />}
              </button>
            </>
          )}
          {onToggle === undefined ? null : (
            <button
              type="button"
              aria-expanded={!collapsed}
              aria-label={collapsed ? "Open sidebar" : "Collapse sidebar"}
              title={collapsed ? "Open sidebar" : "Collapse sidebar"}
              onClick={onToggle}
              className={ICON_BUTTON}
            >
              {collapsed ? <PanelLeftOpenIcon aria-hidden className="size-4" /> : <PanelLeftCloseIcon aria-hidden className="size-4" />}
            </button>
          )}
        </div>
        <div className={cn("flex-1 overflow-y-auto pb-4", collapsed ? "px-1.5 pt-1" : "px-2")}>
          {collapsed ? null : (
            <>
              <div className="px-2 pt-2 pb-1.5 font-mono text-xs font-medium tracking-[0.08em] text-text-3 uppercase">Teams</div>
              <div className="flex items-center gap-1.5 pr-1 pl-1" data-team={team.name}>
                <button
                  type="button"
                  aria-expanded={teamOpen}
                  onClick={() => setTeamOpen((open) => !open)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <ChevronRightIcon aria-hidden className={cn("size-3.5 shrink-0 text-text-3 transition-transform", teamOpen && "rotate-90")} />
                  <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: `var(--team-${team.color}-mark)` }} />
                  <span className="truncate font-semibold text-foreground">{team.name}</span>
                  <span className="font-mono text-xs text-text-3 tabular-nums">{workers.length}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Hire into ${team.name}`}
                  title={`Hire into ${team.name}`}
                  onClick={() => setHiring(true)}
                  className={cn(ICON_BUTTON, "size-6")}
                >
                  <PlusIcon />
                </button>
              </div>
            </>
          )}
          {/* One list in both widths, so each teammate's entry keeps its place; folded, they stay mounted and the tab's title and the notifications keep counting. */}
          <div hidden={!collapsed && !teamOpen} className={collapsed ? undefined : "pt-1"}>
            {list}
          </div>
        </div>
        <div className={cn("flex flex-col gap-3 border-t border-border py-3 text-xs text-text-2", collapsed ? "items-center px-2" : "px-4")}>
          <button
            type="button"
            onClick={() => setHiring(true)}
            aria-label={collapsed ? "Hire a teammate" : undefined}
            title={collapsed ? "Hire a teammate" : undefined}
            className={cn(
              "flex items-center justify-center gap-2 rounded-md border border-border-strong bg-card text-sm font-medium text-foreground shadow-(--shadow-card) hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
              collapsed ? "size-9" : "w-full px-3 py-2",
            )}
          >
            <PlusIcon />
            {collapsed ? null : "Hire a teammate"}
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
          {/* The rail keeps only the hire button: the notify switch and its notes wait until it opens. */}
          {collapsed ? null : (
            <>
              <div className="flex flex-col gap-1.5" data-notify-nudge={nudge ? "" : undefined}>
                <label className="flex items-center justify-between gap-2">
                  <span>Notify me when tasks finish</span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={notify.on}
                    disabled={!supported()}
                    onClick={() => void notify.toggle()}
                    className={cn(
                      "relative h-[18px] w-8 shrink-0 rounded-full border transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                      notify.on ? "border-brand bg-brand" : "border-border-strong bg-accent",
                    )}
                  >
                    <span aria-hidden className={cn("absolute top-1/2 size-3 -translate-y-1/2 rounded-full transition-all", notify.on ? "left-[15px] bg-brand-foreground" : "left-0.5 bg-text-3")} />
                  </button>
                </label>
                {nudge ? (
                  <span className="flex items-baseline gap-1.5 text-text-2">
                    <YouPill />
                    <span>Something is waiting on you. Turn this on to hear about the next one.</span>
                  </span>
                ) : null}
              </div>
              {notify.blocked === undefined ? null : <span data-notify-blocked>{notify.blocked}</span>}
            </>
          )}
        </div>
      </nav>
    </div>
  );
}

/** A quiet square button in the sidebar's chrome. */
const ICON_BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-text-3 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

/**
 * The team the list draws: its name from the roster (a file's team), and its
 * color, the palette's neutral. Every teammate is drawn under it, those you
 * hired included; a roster of several teams is drawn as one for now.
 */
function teamOf(workers: readonly RosterEntry[]): { name: string; color: TeammateColor } {
  return { name: workers.find((w) => w.teamName !== null)?.teamName ?? "Team", color: "slate" };
}

/** The highlighter's small *you* pill: the user needs to act. */
export function YouPill({ className }: { className?: string }) {
  return <span className={cn("inline-flex shrink-0 items-center rounded-full bg-attention px-1.5 font-mono text-xs leading-4 font-semibold text-attention-foreground", className)}>you</span>;
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
  compact = false,
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
  /** Drawn for the rail: the icon, with its badges on its corner, and the name and status in the tooltip. */
  compact?: boolean;
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
  return (
    <button
      type="button"
      aria-current={selected ? "true" : undefined}
      data-worker={displayName(worker)}
      // On the rail the name and status are read out as the row's text; the tooltip shows them to everyone else.
      title={compact ? `${displayName(worker)} · ${status.text}` : undefined}
      onClick={onSelect}
      className={cn(
        "relative flex w-full items-center rounded-lg border border-transparent focus-visible:outline-2 focus-visible:outline-ring",
        compact ? "justify-center py-1.5" : "gap-3 px-2 py-2 text-left",
        selected ? "border-border bg-card shadow-(--shadow-card)" : "hover:bg-accent",
      )}
    >
      <Avatar look={look} state={status.state} />
      <span className={compact ? "sr-only" : "min-w-0 flex-1"}>
        <span className="flex min-w-0 items-baseline gap-2">
          <span className={cn("max-w-full shrink-0 truncate text-sm font-medium text-foreground", unread > 0 && "font-semibold")}>{displayName(worker)}</span>
          <span className="min-w-0 truncate text-xs font-medium tracking-[0.06em] text-text-3 uppercase" data-role>
            {roleWord(worker)}
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs">
          {status.needsYou ? <YouPill /> : null}
          <span className={cn("truncate", statusClass(status), stale && STALE_CLASS)} data-status>
            {status.text}
          </span>
        </span>
      </span>
      <span className={cn(compact ? "absolute top-0.5 right-0.5" : "flex flex-col items-end gap-1", stale && STALE_CLASS)}>
        {activity?.running ? <span className="sr-only">answering</span> : null}
        <AttentionBadges needsYou={status.needsYou} unread={unread} compact={compact} />
      </span>
    </button>
  );
}

/** The short role under a name: the worker's id, its last part in words (`lead-writer` reads "lead writer"). */
const roleWord = (worker: RosterEntry) => worker.id.slice(worker.id.lastIndexOf(".") + 1).replace(/[-_]+/g, " ");

/**
 * A status line's colour: live work in blue, a line that needs you in the
 * body's grey beside its *you* pill (the highlighter is the pill, never the
 * words), a task's own tone where it has one (red for failed), else quiet.
 */
export function statusClass(status: Status): string {
  if (status.needsYou) return "text-text-2";
  if (status.state === "running") return "text-brand";
  return status.tone === PLAIN ? "text-text-3" : status.tone;
}

/**
 * A teammate's badges: *needs you* in the attention colour, then its unread
 * count. In the full row both show, stacked; on the rail there is one corner,
 * so needs you wins over unread, and the count stops at `9+`.
 */
export function AttentionBadges({ needsYou, unread, compact = false }: { needsYou: boolean; unread: number; compact?: boolean }) {
  const ring = compact && "ring-2 ring-sidebar";
  return (
    <>
      {/* The full entry's *you* pill sits on its status line; the rail has no line, so it gets a highlighter dot. */}
      {needsYou ? (
        compact ? (
          <span aria-label="needs you" data-needs-you className={cn("block size-3 rounded-full bg-attention", ring)} />
        ) : (
          <span aria-label="needs you" data-needs-you className="sr-only" />
        )
      ) : null}
      {unread > 0 && !(compact && needsYou) ? (
        <span
          aria-label={`${unread} unread`}
          className={cn(
            "flex items-center justify-center rounded-full bg-brand font-mono text-xs font-semibold text-brand-foreground",
            compact ? "h-4 min-w-4 px-1 leading-none" : "h-[18px] min-w-[18px] px-1.5",
            ring,
          )}
        >
          {compact && unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </>
  );
}
