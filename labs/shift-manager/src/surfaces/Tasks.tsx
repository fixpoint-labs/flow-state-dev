/**
 * Tasks (S9): every row on every attached board, done ones left out, full
 * width (BR-15). Grouped by State, Worker or Stream over the same rows; the
 * Queued toggle hides pending rows. Columns with no shipped read say who ships
 * them (BR-16).
 */
import { useState } from "react";
import { COLUMNS, columnFor, isBlocked, readStatus } from "../lib/columns";
import { openRows, rosterOf, seatFor, type LoadedSnapshot } from "../lib/derive";
import type { BoardRow } from "../lib/reads";
import { navigate, TASK_GROUPINGS, type TaskGrouping } from "../lib/routes";
import { EmptyState, ScreenTitle, SectionFailure, STATE_OF_COLUMN, StateSquare } from "../components/ui";
import { useLab } from "../lib/lab-data";
import type { Gaps } from "../gaps";

/** The columns Tasks groups by State, done excluded. */
const OPEN_COLUMNS = COLUMNS.filter((c) => c !== "DONE");

export function Tasks({ snapshot, by, gaps }: { snapshot: LoadedSnapshot; by: TaskGrouping; gaps: Gaps }) {
  const { refresh } = useLab();
  const [showQueued, setShowQueued] = useState(true);
  const roster = rosterOf(snapshot);
  const all = openRows(snapshot);
  const rows = showQueued ? all : all.filter((row) => readStatus(row.status) !== "pending");
  const failed = Object.entries(snapshot.boards).filter(([, b]) => !b.ok);

  const keyOf = (row: BoardRow): string =>
    by === "state" ? columnFor(row.status) : by === "worker" ? (seatFor(roster, row)?.id ?? row.assignee ?? "unassigned") : row.channelId;
  const groups =
    by === "state"
      ? OPEN_COLUMNS.map((column) => [column, rows.filter((r) => columnFor(r.status) === column)] as const)
      : [...new Set(rows.map(keyOf))].sort().map((key) => [key, rows.filter((r) => keyOf(r) === key)] as const);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="tasks">
      <header className="flex flex-wrap items-center gap-4 border-b px-6 py-3">
        <ScreenTitle>Tasks</ScreenTitle>
        <dl className="flex gap-4 text-xs" data-testid="tasks-summary">
          {OPEN_COLUMNS.map((column) => (
            <div key={column} className="flex gap-1">
              <dt className="text-muted-foreground">{column}</dt>
              <dd className="tabular-nums" data-testid={`tasks-summary-${column}`}>
                {all.filter((r) => columnFor(r.status) === column).length}
              </dd>
            </div>
          ))}
        </dl>
        <div role="tablist" aria-label="Group by" className="ml-auto flex gap-1">
          {TASK_GROUPINGS.map((g) => (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={g === by}
              data-grouping={g}
              onClick={() => navigate({ level: "tasks", by: g })}
              className={`px-2 py-1 text-xs capitalize ${g === by ? "bg-accent font-medium" : "text-muted-foreground"}`}
            >
              {g}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs">
          <input type="checkbox" checked={showQueued} onChange={(e) => setShowQueued(e.target.checked)} data-testid="tasks-queued-toggle" />
          Queued
        </label>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {failed.map(([channelId, b]) =>
          b.ok ? null : (
            <div key={channelId} className="mb-3">
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
          <table className="w-full text-sm" data-testid="tasks-table">
            <thead>
              <tr className="text-left text-[11px] tracking-wider text-muted-foreground">
                <th className="py-1 font-semibold">TASK</th>
                <th className="py-1 font-semibold">STATE</th>
                <th className="py-1 font-semibold">WORKER</th>
                <th className="py-1 font-semibold">STREAM</th>
                <th className="py-1 font-semibold" title={gaps.now}>
                  NOW
                </th>
                <th className="py-1 font-semibold" title={gaps.cost}>
                  TIME
                </th>
                <th className="py-1 font-semibold" title={gaps.cost}>
                  COST
                </th>
              </tr>
            </thead>
            {groups.map(([key, groupRows]) => (
              <tbody key={key} data-testid="tasks-group" data-group={key}>
                <tr>
                  <th colSpan={7} className="pt-4 pb-1 text-left text-xs font-semibold">
                    {key} <span className="font-normal text-muted-foreground">{groupRows.length}</span>
                    {by === "state" && key === "IN REVIEW" ? (
                      <span className="ml-2 font-normal text-muted-foreground" data-testid="tasks-in-review-gap">
                        {gaps.inReview}
                      </span>
                    ) : null}
                  </th>
                </tr>
                {groupRows.map((row) => (
                  <tr
                    key={`${row.boardRef}/${row.id}`}
                    className="cursor-pointer border-t hover:bg-accent/50"
                    data-testid="task-row"
                    data-board-ref={row.boardRef}
                    data-task-id={row.id}
                    onClick={() => navigate({ level: "task", boardRef: row.boardRef, taskId: row.id, tab: "session" })}
                  >
                    <td className="py-1.5 pr-2">{row.title}</td>
                    <td className="py-1.5 pr-2 text-xs" data-testid="task-row-status">
                      <StateSquare state={STATE_OF_COLUMN[columnFor(row.status)]} className="mr-1.5" />
                      {row.status}
                      {isBlocked(row.status) ? <span className="ml-1 bg-warning px-1 text-warning-foreground">blocked</span> : null}
                    </td>
                    <td className="py-1.5 pr-2 text-xs">{seatFor(roster, row)?.id ?? row.assignee ?? "—"}</td>
                    <td className="py-1.5 pr-2 text-xs">{row.channelId}</td>
                    <td className="py-1.5 pr-2 text-xs text-muted-foreground" title={gaps.now}>
                      —
                    </td>
                    <td className="py-1.5 pr-2 text-xs text-muted-foreground" title={gaps.cost}>
                      —
                    </td>
                    <td className="py-1.5 text-xs text-muted-foreground" title={gaps.cost}>
                      —
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        )}
      </div>
    </div>
  );
}
