/**
 * Tasks (S9): every row on every attached board, done ones left out, full
 * width (BR-15). Grouped by State, Worker or Stream over the same rows.
 *
 * Drawn as design v2's Tasks (v2:650-689): the ALL STREAMS tag and a mono
 * summary line, GROUP BY as a segmented control, and the Queued toggle, off
 * by default and saying how many rows it hides (BR-14). The columns are
 * v2's: the state square, ID, TASK, NOW, STREAM, WORKER, TIME (elapsed from
 * the row's start, by a clock) and COST. Columns with no shipped read say who
 * ships them (BR-16).
 */
import { useEffect, useState } from "react";
import { COLUMNS, columnFor, readStatus } from "../lib/columns";
import { openRows, rosterOf, seatFor, type LoadedSnapshot } from "../lib/derive";
import type { BoardRow } from "../lib/reads";
import { navigate, TASK_GROUPINGS, type TaskGrouping } from "../lib/routes";
import { elapsed, isQueued, tasksSummary } from "../lib/tasks";
import { EmptyState, Meta, ScreenTitle, SectionFailure, STATE_OF_COLUMN, StateSquare } from "../components/ui";
import { useLab } from "../lib/lab-data";
import { cn } from "../lib/utils";
import type { Gaps } from "../gaps";

/** The columns Tasks groups by State, done excluded. */
const OPEN_COLUMNS = COLUMNS.filter((c) => c !== "DONE");

/** The time now, ticking each second while `running`: TIME is read by a clock, not a refresh. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

/** A mono cell: the id, NOW, STREAM, TIME and COST columns (v2:677-683). */
const MONO_CELL = "py-2 pr-3 font-mono text-[11.5px] font-medium whitespace-nowrap";

export function Tasks({ snapshot, by, gaps }: { snapshot: LoadedSnapshot; by: TaskGrouping; gaps: Gaps }) {
  const { refresh } = useLab();
  const [showQueued, setShowQueued] = useState(false);
  const roster = rosterOf(snapshot);
  const all = openRows(snapshot);
  const queued = all.filter(isQueued).length;
  const rows = showQueued ? all : all.filter((row) => !isQueued(row));
  const now = useNow(rows.some((row) => readStatus(row.status) === "in_progress"));
  const failed = Object.entries(snapshot.boards).filter(([, b]) => !b.ok);

  const keyOf = (row: BoardRow): string =>
    by === "state" ? columnFor(row.status) : by === "worker" ? (seatFor(roster, row)?.id ?? row.assignee ?? "unassigned") : row.channelId;
  const groups =
    by === "state"
      ? OPEN_COLUMNS.map((column) => [column, rows.filter((r) => columnFor(r.status) === column)] as const)
      : [...new Set(rows.map(keyOf))].sort().map((key) => [key, rows.filter((r) => keyOf(r) === key)] as const);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="tasks">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-foreground/20 px-[22px] py-3.5" data-testid="tasks-header">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <ScreenTitle>Tasks</ScreenTitle>
            <Meta role="label" className="border border-foreground/40 px-[5px] py-px tracking-[0.12em] text-foreground/80" testId="tasks-tag">
              ALL STREAMS
            </Meta>
          </div>
          <Meta role="control" className="mt-1 block text-muted-foreground" testId="tasks-summary">
            {tasksSummary(snapshot)}
          </Meta>
        </div>
        <div className="flex items-center gap-3 font-mono text-[11.5px] font-medium">
          <span className="text-[10.5px] tracking-[0.12em] text-muted-foreground" data-testid="tasks-group-by-label">
            GROUP BY
          </span>
          <div role="tablist" aria-label="Group by" className="flex border border-foreground" data-testid="tasks-group-by">
            {TASK_GROUPINGS.map((g, i) => (
              <button
                key={g}
                type="button"
                role="tab"
                aria-selected={g === by}
                data-grouping={g}
                onClick={() => navigate({ level: "tasks", by: g })}
                className={cn("px-3 py-[5px] capitalize", i > 0 && "border-l border-foreground", g === by && "bg-foreground text-background")}
              >
                {g}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={showQueued}
            onClick={() => setShowQueued((on) => !on)}
            className="flex items-center gap-[7px] border border-foreground/45 px-2.5 py-[5px] hover:border-foreground"
            data-testid="tasks-queued-toggle"
          >
            <span className={cn("size-2.5 border border-foreground", showQueued && "bg-foreground")} data-testid="tasks-queued-box" aria-hidden />
            Queued <span data-testid="tasks-queued-count">{queued}</span>
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-[22px] pb-5">
        {failed.map(([channelId, b]) =>
          b.ok ? null : (
            <div key={channelId} className="mt-3">
              <SectionFailure what={`The boards of ${channelId}`} failure={b.failure} onRetry={() => void refresh()} />
            </div>
          ),
        )}
        {!snapshot.inventory.ok ? (
          <SectionFailure what="The boards" failure={snapshot.inventory.failure} onRetry={() => void refresh()} />
        ) : all.length === 0 ? (
          <EmptyState title="No tasks in flight" testId="tasks-empty">
            No attached board holds a row that isn't done.
          </EmptyState>
        ) : (
          <table className="w-full table-fixed text-sm" data-testid="tasks-table">
            <colgroup>
              <col className="w-[26px]" />
              <col className="w-[132px]" />
              <col />
              <col className="w-[14%]" />
              <col className="w-[128px]" />
              <col className="w-[112px]" />
              <col className="w-[76px]" />
              <col className="w-[62px]" />
            </colgroup>
            <thead>
              <tr className="border-b border-foreground/20 text-left font-mono text-[10px] font-medium tracking-[0.12em] text-muted-foreground" data-testid="tasks-columns">
                <th className="px-2 pt-[9px] pb-[7px] font-medium" aria-label="State" />
                <th className="pt-[9px] pb-[7px] font-medium">ID</th>
                <th className="pt-[9px] pb-[7px] font-medium">TASK</th>
                <th className="pt-[9px] pb-[7px] font-medium" title={gaps.now}>
                  NOW
                </th>
                <th className="pt-[9px] pb-[7px] font-medium">STREAM</th>
                <th className="pt-[9px] pb-[7px] font-medium">WORKER</th>
                <th className="pt-[9px] pb-[7px] font-medium">TIME</th>
                <th className="pt-[9px] pb-[7px] text-right font-medium" title={gaps.cost}>
                  COST
                </th>
              </tr>
            </thead>
            {groups.map(([key, groupRows]) => (
              <tbody key={key} data-testid="tasks-group" data-group={key}>
                <tr>
                  <th colSpan={8} className="pt-4 pb-1 text-left text-xs font-semibold">
                    {key} <span className="font-normal text-muted-foreground">{groupRows.length}</span>
                    {by === "state" && key === "IN REVIEW" ? (
                      <span className="ml-2 font-normal text-muted-foreground" data-testid="tasks-in-review-gap">
                        {gaps.inReview}
                      </span>
                    ) : null}
                  </th>
                </tr>
                {groupRows.map((row) => {
                  const seat = seatFor(roster, row);
                  const time = elapsed(row, now);
                  return (
                    <tr
                      key={`${row.boardRef}/${row.id}`}
                      className="cursor-pointer border-b border-foreground/10 hover:bg-foreground/5"
                      data-testid="task-row"
                      data-board-ref={row.boardRef}
                      data-task-id={row.id}
                      data-status={row.status}
                      onClick={() => navigate({ level: "task", boardRef: row.boardRef, taskId: row.id, tab: "session" })}
                    >
                      <td className="px-2 py-2" title={row.status} data-testid="task-row-status">
                        <StateSquare state={STATE_OF_COLUMN[columnFor(row.status)]} className="align-middle" />
                      </td>
                      <td className={cn(MONO_CELL, "truncate text-muted-foreground")} title={row.id} data-testid="task-row-id">
                        {row.id}
                      </td>
                      <td className="truncate py-2 pr-3 text-[13.5px]" data-testid="task-row-title">
                        {row.title}
                      </td>
                      <td className={cn(MONO_CELL, "text-muted-foreground")} title={gaps.now} data-testid="task-row-now">
                        —
                      </td>
                      <td className={cn(MONO_CELL, "truncate text-foreground/80")} data-testid="task-row-stream">
                        #{row.channelId}
                      </td>
                      <td className="truncate py-2 pr-3 text-[13px]" title={seat?.id ?? row.assignee ?? undefined} data-testid="task-row-worker">
                        {seat?.name ?? row.assignee ?? "—"}
                      </td>
                      <td className={cn(MONO_CELL, "text-muted-foreground")} data-testid="task-row-time">
                        {time ?? "—"}
                      </td>
                      <td className={cn(MONO_CELL, "pr-0 text-right text-muted-foreground")} title={gaps.cost} data-testid="task-row-cost">
                        —
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        )}
      </div>
    </div>
  );
}
