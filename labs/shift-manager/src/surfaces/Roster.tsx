/**
 * Roster: every worker in the seat inventory, grouped on shift, on call and
 * off shift, for all teams or one (`/roster[?team=]`).
 *
 * Every status, slot and count is read from the one `seatStates` result over
 * the snapshot, the same one the sidebar and the workstream panel draw, so a
 * worker reads the same everywhere. Nothing is polled: Roster draws the
 * snapshot and says when it was read.
 *
 * In design v2's form (v2:693-725): a column header, each group's heading
 * with what its status means, and ON CALL FOR as boxed tags, a task or an ask
 * waiting on you tagged WAITING on the highlighter.
 */
import { useSyncExternalStore } from "react";
import { PartialMark, ScreenTitle, SectionFailure, ShiftMark } from "../components/ui";
import { pickedTeam, seatStates, SHIFT_STATUSES, shiftCounts, teamsOf, type LoadedSnapshot, type SeatState, type ShiftStatus } from "../lib/derive";
import { readStatus } from "../lib/columns";
import type { ShiftLook } from "../lib/color-scheme";
import { useLab } from "../lib/lab-data";
import { navigate } from "../lib/routes";
import type { Gaps } from "../gaps";

const NEVER = () => () => {};

/** The grid every worker row and the column header share. */
const COLUMNS_GRID = "grid grid-cols-[minmax(0,1fr)_6rem_minmax(0,1.1fr)_minmax(0,1.4fr)] gap-4";

/** What each group's status means (v2:1392). */
const GROUP_SUB: Record<ShiftStatus, string> = {
  "on shift": "holding live work",
  "on call": "subscribed and waiting · wakes on a trigger",
  "off shift": "nothing assigned, nothing subscribed",
};

/**
 * One ON CALL FOR entry (v2:716-718): a 66px tag, then what and when on two
 * lines. Everything listed here waits on the person, so its tag is WAITING on
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
function useLookName(look: ShiftLook | undefined): string | null {
  const scheme = useSyncExternalStore(look?.subscribe ?? NEVER, () => look?.current());
  return scheme === undefined ? null : scheme === "dark" ? "Night shift" : "Day shift";
}

function WorkerRow({ state, gaps }: { state: SeatState; gaps: Gaps }) {
  const { seat, status, held, asks } = state;
  const parked = held.filter((row) => readStatus(row.status) === "parked");
  return (
    <li
      className={`${COLUMNS_GRID} border-b px-2 py-2.5 text-sm`}
      data-testid="roster-worker"
      data-seat-id={seat.id}
      data-status={status}
    >
      <div className="min-w-0">
        <p className="flex items-baseline gap-2">
          <span className="font-medium">{seat.name}</span>
          <span className="text-xs text-muted-foreground">{seat.team}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {seat.kind ?? "unknown kind"}
          {" · "}
          <span title={gaps.harness} data-testid="roster-worker-harness">
            —
          </span>
        </p>
      </div>
      <div className="space-y-1 pt-0.5">
        <span className="flex gap-0.5">
          {held.map((row) => (
            <span
              key={`${row.boardRef}/${row.id}`}
              className={`size-2 border ${readStatus(row.status) === "parked" ? "border-foreground bg-attention" : "border-info bg-info"}`}
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
              className={`border px-1.5 py-0.5 text-xs hover:border-foreground ${readStatus(row.status) === "parked" ? "bg-attention text-attention-foreground" : ""}`}
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
        {parked.length === 0 && asks.length === 0 ? (
          <li className="pt-[3px] font-mono text-[11px] font-medium text-muted-foreground" data-testid="roster-no-wait">
            —
          </li>
        ) : null}
        {parked.map((row) => (
          <WaitEntry key={`${row.boardRef}/${row.id}`} kind="task" id={row.id} what={`you · ${row.id}`} when={row.title} />
        ))}
        {asks.map((ask) => (
          <WaitEntry key={ask.item.suspensionId} kind="ask" id={ask.item.suspensionId} what={`you · ${ask.kind}`} when={ask.item.message ?? "waiting on you"} />
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
  look?: ShiftLook;
}) {
  const { refresh } = useLab();
  const lookName = useLookName(look);
  if (!snapshot.inventory.ok) {
    return (
      <div className="p-4" data-testid="roster">
        <SectionFailure what="Roster" failure={snapshot.inventory.failure} onRetry={() => void refresh()} testId="roster-inventory-failure" />
      </div>
    );
  }
  const seats = snapshot.inventory.value.seats;
  const team = pickedTeam(seats, asked);
  const states = seatStates(snapshot);
  const shown = [...states.seats.values()].filter((s) => team === null || s.seat.team === team);
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
              {counts["on shift"]} on shift · {counts["on call"]} on call · {counts["off shift"]} off shift · {counts.waiting} waiting on you
            </span>
            <span data-testid="roster-read-at"> · read {new Date(snapshot.readAt).toLocaleTimeString()}</span>
            {states.partial ? <PartialMark title={gaps.roster.partial} /> : null}
          </p>
        </div>
        <div role="group" aria-label="Team" className="flex border border-foreground text-xs">
          {[null, ...teamsOf(seats).map((t) => t.team)].map((option, i) => (
            <button
              key={option ?? ""}
              type="button"
              aria-pressed={option === team}
              onClick={() => navigate({ level: "roster", team: option })}
              data-testid="roster-team-option"
              data-team={option ?? ""}
              className={`px-3 py-1 ${i > 0 ? "border-l border-foreground" : ""} ${option === team ? "bg-foreground text-background" : ""}`}
            >
              {option ?? "All"}
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
        <span>ON CALL FOR</span>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-6">
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
                  <WorkerRow key={state.seat.id} state={state} gaps={gaps} />
                ))}
              </ul>
            </section>
          );
        })}
        <div className="mt-4 space-y-1 text-xs text-muted-foreground">
          <p data-testid="roster-gap-watches">{gaps.roster.watches}</p>
          <p data-testid="roster-gap-seat-match">{gaps.roster.seatMatch}</p>
        </div>
      </div>
    </div>
  );
}
