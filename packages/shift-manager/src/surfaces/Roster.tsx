/**
 * Roster: every worker the user has, grouped on shift and off shift, for
 * all teams or one (`/roster[?team=]`). The workers are the user's roster,
 * read through Workforce's client: their own workers and the standard ones, each on the flow it names. A standard worker's row is the
 * worker inventory's. The roster is read again with every snapshot, so a worker
 * hired or fired on a turn shows on the next read.
 *
 * Every status, slot and count is read from the one `workerStates` result over
 * the snapshot, the same one the sidebar and Chief of Staff draw, so a
 * worker reads the same everywhere. Nothing is polled: Roster draws the
 * snapshot and says when it was read.
 *
 * In design v2's form (v2:693-725): a column header, each group's heading
 * with what its status means, and WAITING ON YOU as boxed tags, a task or an
 * ask waiting on you tagged WAITING on the highlighter.
 */
import { useSyncExternalStore } from "react";
import { PartialMark, ScreenTitle, SectionFailure, ShiftMark } from "../components/ui";
import { chiefOfStaffOf, pickedTeam, workerLabel, workerStates, SHIFT_STATUSES, shiftCounts, teamsOf, type LoadedSnapshot, type WorkerState, type ShiftStatus } from "../lib/derive";
import { themeLabel, type ThemeLook } from "../lib/theme";
import { useLab } from "../lib/lab-data";
import { useRoster, withRoster } from "../lib/roster";
import { navigate } from "../lib/routes";
import type { Gaps } from "../gaps";

const NEVER = () => () => {};

/** The grid every worker row and the column header share. */
const COLUMNS_GRID = "grid grid-cols-[minmax(0,1fr)_6rem_minmax(0,1.1fr)_minmax(0,1.4fr)] gap-4";

/** What each group's status means (v2:1392). */
const GROUP_SUB: Record<ShiftStatus, string> = {
  "on shift": "holding live work, running or waiting on you",
  "off shift": "nothing assigned",
};

/**
 * One WAITING ON YOU entry (v2:716-718): a 66px tag, then what and when on two
 * lines. Everything listed here waits on the user, so its tag is WAITING on
 * the highlighter.
 */
function WaitEntry({ kind, id, what, when }: { kind: "task" | "ask"; id: string; what: string; when: string }) {
  return (
    <li className="grid grid-cols-[66px_minmax(0,1fr)] items-baseline gap-2 font-mono text-[11px] font-medium" data-testid="roster-wait" data-kind={kind} data-id={id}>
      <span className="border border-foreground bg-attention px-1 text-center text-[9.5px] tracking-[0.1em] text-attention-foreground" data-testid="roster-wait-tag">
        WAITING
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate" data-testid="roster-wait-what">
          {what}
        </span>
        <span className="truncate text-muted-foreground" data-testid="roster-wait-when">
          {when}
        </span>
      </span>
    </li>
  );
}

/** The look's name, following it as it changes; `null` when the page has no switch. */
function useLookName(look: ThemeLook | undefined): string | null {
  const theme = useSyncExternalStore(look?.subscribe ?? NEVER, () => look?.current());
  return theme === undefined ? null : themeLabel(theme);
}

function WorkerRow({ state, gaps, own }: { state: WorkerState; gaps: Gaps; own: boolean }) {
  const { worker, status, held, waitsOnYou, asks } = state;
  const onYou = new Set(waitsOnYou);
  return (
    <li
      className={`${COLUMNS_GRID} border-b px-2 py-2.5 text-sm`}
      data-testid="roster-worker"
      data-worker-id={worker.id}
      data-status={status}
      data-own={own ? "true" : "false"}
    >
      <div className="min-w-0">
        <p className="flex items-baseline gap-2">
          <span className="font-medium">{workerLabel(worker.displayName)}</span>
          <span className="text-xs text-muted-foreground">{worker.teamName}</span>
          {own ? (
            <span className="border px-1 text-[10px] tracking-widest text-muted-foreground" data-testid="roster-worker-own">
              YOURS
            </span>
          ) : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {worker.kind ?? "unknown flow"}
          {" · "}
          <span title={gaps.harness} data-testid="roster-worker-harness">
            —
          </span>
        </p>
        <button
          type="button"
          onClick={() => navigate({ level: "worker-settings", worker: worker.id })}
          className="mt-1 border px-1.5 py-0.5 text-xs hover:border-foreground"
          data-testid="roster-worker-settings"
        >
          Settings
        </button>
      </div>
      <div className="space-y-1 pt-0.5">
        <span className="flex gap-0.5">
          {held.map((row) => (
            <span
              key={`${row.boardRef}/${row.id}`}
              className={`size-2 border ${onYou.has(row) ? "border-foreground bg-attention" : "border-info bg-info"}`}
              data-testid="roster-slot"
            />
          ))}
        </span>
        <p className="text-xs text-muted-foreground" data-testid="roster-slots">
          {held.length} in use
        </p>
      </div>
      <div className="flex min-w-0 flex-wrap content-start gap-1">
        {held.length === 0 ? (
          <span className="text-xs text-muted-foreground" data-testid="roster-nothing">
            nothing assigned
          </span>
        ) : (
          held.map((row) => (
            <button
              key={`${row.boardRef}/${row.id}`}
              type="button"
              title={row.title}
              className={`border px-1.5 py-0.5 text-xs hover:border-foreground ${onYou.has(row) ? "bg-attention text-attention-foreground" : ""}`}
              onClick={() => navigate({ level: "task", boardRef: row.boardRef, taskId: row.id, tab: "session" })}
              data-testid="roster-holding"
              data-board-ref={row.boardRef}
              data-task-id={row.id}
            >
              {row.id}
            </button>
          ))
        )}
      </div>
      <ul className="min-w-0 space-y-[5px]">
        {waitsOnYou.length === 0 && asks.length === 0 ? (
          <li className="pt-[3px] font-mono text-[11px] font-medium text-muted-foreground" data-testid="roster-no-wait">
            —
          </li>
        ) : null}
        {waitsOnYou.map((row) => (
          <WaitEntry key={`${row.boardRef}/${row.id}`} kind="task" id={row.id} what={`you · ${row.id}`} when={row.title} />
        ))}
        {asks.map((ask) => (
          <WaitEntry key={ask.item.suspensionId} kind="ask" id={ask.item.suspensionId} what={`you · ${ask.kind}`} when={ask.item.title || ask.item.message || "waiting on you"} />
        ))}
      </ul>
    </li>
  );
}

export function RosterView({
  snapshot,
  team: asked,
  gaps,
  look,
}: {
  snapshot: LoadedSnapshot;
  team: string | null;
  gaps: Gaps;
  look?: ThemeLook;
}) {
  const { refresh } = useLab();
  const lookName = useLookName(look);
  const roster = useRoster(snapshot.readAt);
  const { snapshot: withOwn, workers, own } = withRoster(snapshot, roster);
  if (!snapshot.inventory.ok && workers.length === 0) {
    return (
      <div className="p-4" data-testid="roster">
        <SectionFailure what="Roster" failure={snapshot.inventory.failure} onRetry={() => void refresh()} testId="roster-inventory-failure" />
      </div>
    );
  }
  const ownIds = new Set(own.map((worker) => worker.id));
  const team = pickedTeam(workers, asked);
  const states = workerStates(withOwn);
  // The chief of staff first: the coordinator the user's work goes through.
  const cos = chiefOfStaffOf(workers);
  const first = cos.kind === "one" ? cos.worker.id : undefined;
  const shown = [...states.workers.values()]
    .filter((s) => team === null || s.worker.team === team)
    .sort((a, b) => Number(b.worker.id === first) - Number(a.worker.id === first));
  const counts = shiftCounts(states, team ?? undefined);
  const unread = Object.entries(snapshot.boards).flatMap(([workstreamId, boards]) => (boards.ok ? [] : [{ workstreamId, failure: boards.failure }]));
  const title = [lookName ?? "Roster", ...(team === null ? [] : [team])].join(" · ");

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="roster" data-team={team ?? ""}>
      <header className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <ScreenTitle testId="roster-title">{title}</ScreenTitle>
            <span className="border px-1 text-[10px] tracking-widest text-muted-foreground">ROSTER</span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            <span data-testid="roster-summary">
              {counts["on shift"]} on shift · {counts["off shift"]} off shift · {counts.waiting} waiting on you
            </span>
            <span data-testid="roster-read-at"> · read {new Date(snapshot.readAt).toLocaleTimeString()}</span>
            {states.partial ? <PartialMark title={gaps.roster.partial} /> : null}
          </p>
        </div>
        <div role="group" aria-label="Team" className="flex border border-foreground text-xs">
          {[null, ...teamsOf(workers)].map((option, i) => (
            <button
              key={option?.team ?? ""}
              type="button"
              aria-pressed={(option?.team ?? null) === team}
              onClick={() => navigate({ level: "roster", team: option?.team ?? null })}
              data-testid="roster-team-option"
              data-team={option?.team ?? ""}
              className={`px-3 py-1 ${i > 0 ? "border-l border-foreground" : ""} ${(option?.team ?? null) === team ? "bg-foreground text-background" : ""}`}
            >
              {option?.name ?? "All"}
            </button>
          ))}
        </div>
      </header>
      <div
        className={`${COLUMNS_GRID} border-b border-foreground/20 px-7 pt-[9px] pb-[7px] font-mono text-[10px] font-medium tracking-[0.12em] text-muted-foreground`}
        data-testid="roster-columns"
      >
        <span>WORKER</span>
        <span>SLOTS</span>
        <span>HOLDING</span>
        <span>WAITING ON YOU</span>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {snapshot.inventory.ok ? null : (
          <div className="mt-3">
            <SectionFailure what="The worker inventory" failure={snapshot.inventory.failure} onRetry={() => void refresh()} testId="roster-inventory-failure" />
          </div>
        )}
        {roster !== undefined && "failure" in roster ? (
          <p className="mt-3 text-xs text-muted-foreground" data-testid="roster-own-failure">
            Your own workers didn't load: {roster.failure.message}
          </p>
        ) : null}
        {snapshot.asks.ok ? null : (
          <div className="mt-3">
            <SectionFailure what="Asks" failure={snapshot.asks.failure} onRetry={() => void refresh()} testId="roster-asks-failure" />
          </div>
        )}
        {unread.map(({ workstreamId, failure }) => (
          <div key={workstreamId} className="mt-3">
            <SectionFailure what={`${workstreamId}'s tasks`} failure={failure} onRetry={() => void refresh()} testId="roster-boards-failure" />
          </div>
        ))}
        {SHIFT_STATUSES.map((status) => {
          const group = shown.filter((s) => s.status === status);
          if (group.length === 0) return null;
          return (
            <section key={status} data-testid="roster-group" data-status={status}>
              <h2 className="flex items-center gap-[9px] border-b border-foreground/30 px-2 pt-[18px] pb-[7px] font-mono text-[11px] font-medium text-foreground/80">
                <ShiftMark status={status} className="size-[9px]" />
                <span className="font-semibold tracking-[0.1em] text-foreground" data-testid="roster-group-label">
                  {status.toUpperCase()}
                </span>
                <span className="text-muted-foreground" data-testid="roster-group-sub">
                  {GROUP_SUB[status]}
                </span>
                <span className="ml-auto text-muted-foreground">{group.length}</span>
              </h2>
              <ul>
                {group.map((state) => (
                  <WorkerRow key={state.worker.id} state={state} gaps={gaps} own={ownIds.has(state.worker.id)} />
                ))}
              </ul>
            </section>
          );
        })}
        <div className="mt-4 space-y-1 text-xs text-muted-foreground">
          <p data-testid="roster-gap-worker-match">{gaps.roster.workerMatch}</p>
        </div>
      </div>
    </div>
  );
}
