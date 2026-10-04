/**
 * The workstream level (S7, S8): a declared channel and the boards attached
 * to it (D2). A header as design v2 draws it (v2:215): `#`, the name and a
 * boxed WORKSTREAM tag. Four tabs, each mounted only when opened: Stream,
 * Board, Brief (the channel's charter) and Results. The right panel shows
 * Progress, the channel's members with their status, and its rows by column.
 */
import { useEffect, useState } from "react";
import { Board } from "../components/Board";
import { EmptyState, PartialMark, ScreenTitle, SectionFailure, STATE_OF_COLUMN, StateSquare, StatusWord, Tabs } from "../components/ui";
import { COLUMNS } from "../lib/columns";
import { byColumn, seatStates, type LoadedSnapshot } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import { describeFailure, type Failure, type Workstream } from "../lib/reads";
import { navigate, WORKSTREAM_TABS, type WorkstreamTab } from "../lib/routes";
import type { Gaps } from "../gaps";
import { Stream } from "./Stream";

/** The workstream a route names, or why there is none. */
export function findWorkstream(snapshot: LoadedSnapshot, channelId: string): Workstream | undefined {
  return snapshot.inventory.ok ? snapshot.inventory.value.workstreams.find((w) => w.id === channelId) : undefined;
}

export function WorkstreamView({
  snapshot,
  workstream,
  tab,
  gaps,
}: {
  snapshot: LoadedSnapshot;
  workstream: Workstream;
  tab: WorkstreamTab;
  gaps: Gaps;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="workstream" data-channel-id={workstream.id}>
      <header className="flex items-baseline gap-2 px-[22px] pt-3.5 pb-3" data-testid="workstream-header">
        <span className="font-mono text-[15px] font-medium text-muted-foreground" data-look="title-hash">
          #
        </span>
        <ScreenTitle>{workstream.id}</ScreenTitle>
        <span className="border border-foreground/40 px-[5px] py-px font-mono text-[10px] font-medium tracking-[0.12em]" data-look="screen-tag">
          WORKSTREAM
        </span>
      </header>
      <Tabs
        label="Workstream"
        tabs={WORKSTREAM_TABS}
        selected={tab}
        onSelect={(next) => navigate({ level: "workstream", channelId: workstream.id, tab: next })}
        counts={boardCount(snapshot, workstream)}
      />
      <div className="flex min-h-0 flex-1 flex-col" role="tabpanel" data-tabpanel={tab}>
        {tab === "stream" ? <Stream workstream={workstream} snapshot={snapshot} gaps={gaps} /> : null}
        {tab === "board" ? <BoardTab snapshot={snapshot} workstream={workstream} gaps={gaps} /> : null}
        {tab === "brief" ? <Brief workstream={workstream} /> : null}
        {tab === "results" ? <EmptyState title={gaps.results.title}>{gaps.results.body}</EmptyState> : null}
      </div>
    </div>
  );
}

/** The Board tab's count: every row on the workstream's boards (v2:222), once they loaded. */
function boardCount(snapshot: LoadedSnapshot, workstream: Workstream): { board: number } | undefined {
  const boards = snapshot.boards[workstream.id];
  return boards?.ok === true && boards.value.refs.length > 0 ? { board: boards.value.rows.length } : undefined;
}

function BoardTab({ snapshot, workstream, gaps }: { snapshot: LoadedSnapshot; workstream: Workstream; gaps: Gaps }) {
  const { refresh } = useLab();
  const boards = snapshot.boards[workstream.id];
  if (boards === undefined) return null;
  if (!boards.ok) {
    return (
      <div className="p-4">
        <SectionFailure what="This workstream's boards" failure={boards.failure} onRetry={() => void refresh()} />
      </div>
    );
  }
  if (boards.value.refs.length === 0) {
    return (
      <EmptyState title="No board" testId="board-none">
        This workstream's channel attaches no board, so it has no tasks to show.
      </EmptyState>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className="px-4 pt-3 text-xs text-muted-foreground" data-testid="board-refs">
        {boards.value.refs.join(", ")}
      </p>
      <Board rows={boards.value.rows} inReviewGap={gaps.inReview} />
    </div>
  );
}

/** The channel's charter: its `CHANNEL.md` body, as the channel session holds it. Read when the tab opens. */
function Brief({ workstream }: { workstream: Workstream }) {
  const { clients } = useLab();
  const [charter, setCharter] = useState<{ text: string } | { failure: Failure } | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setCharter(undefined);
    clients.sessions
      .getSession(workstream.id)
      .then((detail) => {
        const text = detail.state?.instructions;
        if (live) setCharter({ text: typeof text === "string" ? text : "" });
      })
      .catch((error: unknown) => live && setCharter({ failure: describeFailure(error) }));
    return () => {
      live = false;
    };
  }, [clients, workstream.id, attempt]);

  if (charter === undefined) return <p className="p-4 text-sm text-muted-foreground">Reading the charter…</p>;
  if ("failure" in charter) {
    return (
      <div className="p-4">
        <SectionFailure what="The charter" failure={charter.failure} onRetry={() => setAttempt((a) => a + 1)} />
      </div>
    );
  }
  return charter.text.trim().length === 0 ? (
    <EmptyState title="No charter">This workstream's channel declares no charter.</EmptyState>
  ) : (
    <article className="mx-auto w-full max-w-3xl overflow-y-auto whitespace-pre-wrap p-6 text-sm" data-testid="brief">
      {charter.text}
    </article>
  );
}

/** The workstream's right panel (S8, BR-23). */
export function WorkstreamPanel({ snapshot, workstream, gaps }: { snapshot: LoadedSnapshot; workstream: Workstream; gaps: Gaps }) {
  const { refresh } = useLab();
  const seats = snapshot.inventory.ok ? snapshot.inventory.value.seats : [];
  const states = seatStates(snapshot);
  const boards = snapshot.boards[workstream.id];
  const columns = boards?.ok === true ? byColumn(boards.value.rows) : undefined;
  return (
    <div className="space-y-5 p-3" data-testid="workstream-panel">
      <section>
        <h3 className="pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground">PROGRESS</h3>
        <p className="text-xs text-muted-foreground" data-testid="panel-progress">
          {gaps.progress.body}
        </p>
      </section>
      <section data-testid="panel-team">
        <h3 className="pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground">
          TEAM{states.partial ? <PartialMark title={gaps.roster.partial} /> : null}
        </h3>
        <ul className="space-y-1">
          {workstream.members.map((member) => {
            const seat = seats.find((s) => s.id === member);
            return (
              <li key={member} className="flex items-center justify-between text-sm" data-testid="panel-member" data-seat-id={member}>
                <span>{member}</span>
                {seat === undefined ? (
                  <span className="text-xs text-muted-foreground">not in the seat inventory</span>
                ) : (
                  <StatusWord status={states.seats.get(seat.id)!.status} />
                )}
              </li>
            );
          })}
        </ul>
      </section>
      <section data-testid="panel-tasks">
        <h3 className="pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground">TASKS</h3>
        {boards === undefined ? null : !boards.ok ? (
          <SectionFailure what="Tasks" failure={boards.failure} onRetry={() => void refresh()} />
        ) : boards.value.refs.length === 0 ? (
          <p className="text-xs text-muted-foreground" data-testid="panel-tasks-none">
            This workstream's channel attaches no board, so it has no tasks.
          </p>
        ) : (
          COLUMNS.map((column) => {
            const inColumn = columns?.get(column) ?? [];
            return (
              <div key={column} className="mb-2" data-testid="panel-column" data-column={column}>
                <p className="text-xs font-medium">
                  {column} <span className="text-muted-foreground">{inColumn.length}</span>
                </p>
                <ul>
                  {inColumn.map((row) => (
                    <li key={`${row.boardRef}/${row.id}`}>
                      <button
                        type="button"
                        className="flex max-w-full items-center gap-1.5 text-left text-xs hover:underline"
                        onClick={() => navigate({ level: "task", boardRef: row.boardRef, taskId: row.id, tab: "session" })}
                      >
                        <StateSquare state={STATE_OF_COLUMN[column]} />
                        <span className="truncate">{row.title}</span> <span className="text-muted-foreground">({row.status})</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
