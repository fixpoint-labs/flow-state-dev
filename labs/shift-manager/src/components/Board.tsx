/**
 * A workstream's board in the design's five columns (BR-12). Shift Manager's own
 * grouping: `react`'s `BoardColumns` draws one column per status and can't
 * merge several into one, which BR-12 needs. Each card keeps its own status
 * word; IN REVIEW is drawn empty with its owner named.
 *
 * Drawn as v2's grid (v2:526-548): columns in v2's order, each headed by its
 * state square, its name and its count in mono; hairline cell borders and no
 * fill but RUNNING's blue tint; DONE as one line per task, its id and title.
 */
import { COLUMNS, isBlocked } from "../lib/columns";
import { byColumn } from "../lib/derive";
import { STATE_OF_COLUMN, StateSquare } from "./ui";
import type { BoardRow } from "../lib/reads";
import { navigate } from "../lib/routes";

export function Board({ rows, inReviewGap }: { rows: readonly BoardRow[]; inReviewGap: string }) {
  const open = (row: BoardRow) => navigate({ level: "task", boardRef: row.boardRef, taskId: row.id, tab: "session" });
  const grouped = byColumn(rows);
  return (
    <div className="grid min-h-0 flex-1 grid-cols-[repeat(5,minmax(150px,1fr))] overflow-auto" data-testid="board">
      {COLUMNS.map((column) => {
        const cards = grouped.get(column) ?? [];
        const tint = column === "RUNNING" ? "bg-info/[3.5%]" : "";
        return (
          <section key={column} className={`flex min-w-0 flex-col border-r border-foreground/[0.12] ${tint}`} data-testid="board-column" data-column={column}>
            <h3
              className="flex items-center gap-2 border-b border-foreground/20 px-3 pt-2.5 pb-2 font-mono text-[10.5px] font-medium tracking-[0.1em] text-foreground/80"
              data-look="column-head"
            >
              <StateSquare state={STATE_OF_COLUMN[column]} className="size-[9px]" />
              <span>{column}</span>
              <span className="text-muted-foreground">{cards.length}</span>
            </h3>
            <div className="flex min-w-0 flex-1 flex-col gap-[5px] px-2 py-1.5" data-look="column-cell">
              {column === "IN REVIEW" ? <p className="px-0.5 text-xs text-muted-foreground">{inReviewGap}</p> : null}
              {cards.map((row) =>
                column === "DONE" ? (
                  <button
                    key={`${row.boardRef}/${row.id}`}
                    type="button"
                    data-testid="board-card"
                    data-look="done-line"
                    data-board-ref={row.boardRef}
                    data-task-id={row.id}
                    data-status={row.status}
                    onClick={() => open(row)}
                    className="flex min-w-0 gap-2 p-0.5 text-left font-mono text-[11px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    <span className="shrink-0 text-foreground/80">{row.id}</span>
                    <span className="min-w-0 truncate">{row.title}</span>
                  </button>
                ) : (
                  <button
                    key={`${row.boardRef}/${row.id}`}
                    type="button"
                    data-testid="board-card"
                    data-board-ref={row.boardRef}
                    data-task-id={row.id}
                    data-status={row.status}
                    onClick={() => open(row)}
                    className="w-full border bg-card p-2 text-left text-sm text-card-foreground hover:border-foreground/30"
                  >
                    <p className="line-clamp-2">{row.title}</p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <StateSquare state={STATE_OF_COLUMN[column]} />
                      <span data-testid="board-card-status">{row.status}</span>
                      {isBlocked(row.status) ? <span className="bg-warning px-1 text-warning-foreground">blocked</span> : null}
                      {row.assignee === null ? null : <span>· {row.assignee}</span>}
                    </p>
                  </button>
                ),
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
