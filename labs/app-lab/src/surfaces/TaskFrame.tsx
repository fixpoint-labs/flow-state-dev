/**
 * The task level's frame (BR-17): the route `/tasks/:boardRef/:taskId/:tab`
 * and the right panel's task slot, both FIX-1664's to fill. Until then the
 * frame shows the row as its board holds it and a named empty state in each.
 *
 * While the row is not yet on the board, or has not finished, the frame
 * re-reads that one board every 2 s, at most 30 times (S3's bounded re-read):
 * a task opened just after it was filed shows up without a manual refresh,
 * and a screen left open does not poll forever.
 */
import { useEffect, useState } from "react";
import { EmptyState, SectionFailure, Tabs } from "../components/ui";
import { columnFor, isDone } from "../lib/columns";
import { allRows, type LoadedSnapshot } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import { describeFailure, type BoardRow, type Failure } from "../lib/reads";
import { navigate, TASK_TABS, type TaskTab } from "../lib/routes";
import type { Gaps } from "../gaps";

/** How often, and how many times, a task screen re-reads its board. */
export const REREAD_EVERY_MS = 2_000;
export const REREAD_AT_MOST = 30;

/** The channel a board ref belongs to: everything before its last dot. */
function channelOf(boardRef: string): string {
  const dot = boardRef.lastIndexOf(".");
  return dot > 0 ? boardRef.slice(0, dot) : boardRef;
}

function useTaskRow(snapshot: LoadedSnapshot, boardRef: string, taskId: string) {
  const { reader } = useLab();
  const fromSnapshot = allRows(snapshot).find((r) => r.boardRef === boardRef && r.id === taskId);
  const [row, setRow] = useState<BoardRow | undefined>(fromSnapshot);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const [reads, setReads] = useState(0);

  useEffect(() => {
    setRow(fromSnapshot);
    setReads(0);
    // Only on a new task or a new snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardRef, taskId, snapshot]);

  const waiting = row === undefined || !isDone(row.status);
  useEffect(() => {
    if (!waiting || reads >= REREAD_AT_MOST) return;
    const timer = setTimeout(() => {
      reader
        .readBoard(channelOf(boardRef), boardRef)
        .then((rows) => {
          setRow(rows.find((r) => r.id === taskId));
          setFailure(undefined);
        })
        .catch((error: unknown) => setFailure(describeFailure(error)))
        .finally(() => setReads((n) => n + 1));
    }, REREAD_EVERY_MS);
    return () => clearTimeout(timer);
  }, [waiting, reads, reader, boardRef, taskId]);

  return { row, failure, retry: () => setReads(0) };
}

export function TaskFrame({
  snapshot,
  boardRef,
  taskId,
  tab,
  gaps,
}: {
  snapshot: LoadedSnapshot;
  boardRef: string;
  taskId: string;
  tab: TaskTab;
  gaps: Gaps;
}) {
  const { row, failure, retry } = useTaskRow(snapshot, boardRef, taskId);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="task-frame" data-board-ref={boardRef} data-task-id={taskId}>
      <header className="px-4 pt-3">
        <p className="text-[11px] font-semibold tracking-wider text-muted-foreground">
          TASK · <button type="button" className="hover:underline" onClick={() => navigate({ level: "workstream", channelId: channelOf(boardRef), tab: "board" })}>{boardRef}</button>
        </p>
        <h1 className="text-base font-semibold" data-testid="task-title">
          {row?.title ?? taskId}
        </h1>
        <p className="text-xs text-muted-foreground" data-testid="task-status">
          {row === undefined ? "Not on this board yet." : `${row.status} · ${columnFor(row.status)}`}
          {row?.assignee == null ? "" : ` · ${row.assignee}`}
        </p>
        {failure === undefined ? null : (
          <div className="mt-2">
            <SectionFailure what="This task's board" failure={failure} onRetry={retry} />
          </div>
        )}
      </header>
      <Tabs label="Task" tabs={TASK_TABS} selected={tab} onSelect={(next) => navigate({ level: "task", boardRef, taskId, tab: next })} />
      <div role="tabpanel" data-tabpanel={tab} data-testid="task-slot">
        <EmptyState title={gaps.taskScreen.title}>{gaps.taskScreen.body}</EmptyState>
      </div>
    </div>
  );
}

/** The right panel's task slot. */
export function TaskPanel({ gaps }: { gaps: Gaps }) {
  return (
    <div data-testid="task-panel-slot">
      <EmptyState title={gaps.taskInspector.title}>{gaps.taskInspector.body}</EmptyState>
    </div>
  );
}
