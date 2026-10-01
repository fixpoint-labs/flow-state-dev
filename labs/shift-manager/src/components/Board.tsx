/**
 * A workstream's board in the design's five columns (BR-12). shift-manager's own
 * grouping: `react`'s `BoardColumns` draws one column per status and can't
 * merge several into one, which BR-12 needs. Each card keeps its own status
 * word; IN REVIEW is drawn empty with its owner named.
 */
import { COLUMNS, columnFor, isBlocked } from "../lib/columns";
import type { BoardRow } from "../lib/reads";
import { navigate } from "../lib/routes";

export function Board({ rows, inReviewGap }: { rows: readonly BoardRow[]; inReviewGap: string }) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-5 gap-3 overflow-x-auto p-4" data-testid="board">
      {COLUMNS.map((column) => {
        const cards = rows.filter((row) => columnFor(row.status) === column);
        return (
          <section key={column} className="flex min-w-44 flex-col rounded-md bg-muted/50 p-2" data-testid="board-column" data-column={column}>
            <h3 className="px-1 pb-2 text-[11px] font-semibold tracking-wider text-muted-foreground">
              {column} <span className="font-normal">{cards.length}</span>
            </h3>
            {column === "IN REVIEW" ? <p className="px-1 text-xs text-muted-foreground">{inReviewGap}</p> : null}
            <ul className="space-y-2">
              {cards.map((row) => (
                <li key={`${row.boardRef}/${row.id}`}>
                  <button
                    type="button"
                    data-testid="board-card"
                    data-board-ref={row.boardRef}
                    data-task-id={row.id}
                    onClick={() => navigate({ level: "task", boardRef: row.boardRef, taskId: row.id, tab: "session" })}
                    className="w-full rounded-md border bg-card p-2 text-left text-sm text-card-foreground hover:border-foreground/30"
                  >
                    <p className="line-clamp-2">{row.title}</p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <span data-testid="board-card-status">{row.status}</span>
                      {isBlocked(row.status) ? <span className="rounded bg-warning px-1 text-warning-foreground">blocked</span> : null}
                      {row.assignee === null ? null : <span>· {row.assignee}</span>}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
