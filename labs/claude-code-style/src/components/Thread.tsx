import { useInterruptKeys, useJumpToLatest } from "@flow-state-dev/react";
import type { LabAdapter, ProjectRow, SessionRow, TaskRow } from "../adapter";
import { elapsed, useNow, useWatch } from "../lib/use-watch";
import { modeOfWorker } from "../modes";
import { Composer } from "./Composer";
import { JumpToLatestButton } from "./JumpToLatest";
import { Entry } from "./Entry";
import { ThreadCard } from "./ThreadCard";

/**
 * The center: the open session's thread, its working indicator, and the
 * composer. The header names the session's project; a session with none gets
 * no composer, so nothing runs until it has one (spec D3). In threads mode a
 * thread the lead filed is a card here, read from its task row.
 *
 * Esc twice, or Cmd/Ctrl+., stops the turn from anywhere on the page. One Esc
 * never does: it closes a sheet, or belongs to the text box it was typed in.
 */
export function Thread({
  adapter,
  session,
  project,
  onOpenThread,
}: {
  adapter: LabAdapter;
  session: SessionRow;
  project: ProjectRow | undefined;
  onOpenThread: (taskId: string) => void;
}) {
  const view = useWatch((emit: Parameters<LabAdapter["watchThread"]>[1]) => adapter.watchThread(session.id, emit), [adapter, session.id]);
  const mode = modeOfWorker(session.worker);
  // Only threads mode draws a card from a task row; session mode's rows are the tasks pane's own read.
  const board = mode?.pane === "board";
  const tasks =
    useWatch(
      (emit: (rows: TaskRow[]) => void) => (board ? adapter.watchTasks(session.id, emit) : () => undefined),
      [adapter, session.id, board],
    ) ?? [];
  const running = view?.running ?? false;
  const now = useNow(running);
  const count = view?.entries.length ?? 0;
  const feed = useJumpToLatest({ resetKey: session.id });
  // On the document, so the keys work wherever focus is; a sheet's Esc arrives already spent.
  const keys = useInterruptKeys({
    enabled: running && session.projectId !== null,
    onInterrupt: () => void adapter.interrupt(session.id),
    target: "document",
  });

  return (
    <main aria-label="Main thread" className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{session.title}</h1>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {session.projectId === null ? "no project" : `in project: ${project?.name ?? session.projectId}`}
          </div>
        </div>
        <span className="border border-border px-2 py-0.5 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          {mode?.label ?? session.worker}
        </span>
      </header>
      <div ref={feed.ref} className="flex-1 overflow-y-auto px-6 pt-4 pb-10">
        {count === 0 ? (
          <div className="mx-auto mt-24 max-w-sm text-center text-sm text-muted-foreground">
            {mode?.pane === "board"
              ? "Ask the main session for something. It hands each piece to a task of its own, and each comes back to you when it needs you."
              : "Ask the main session for something. It does what it can itself and starts background tasks for the long pieces."}
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-3">
            {view?.entries.map((entry) =>
              entry.kind === "thread" ? (
                <ThreadCard
                  key={entry.id}
                  adapter={adapter}
                  sessionId={session.id}
                  task={tasks.find((t) => t.id === entry.taskId)}
                  onOpen={onOpenThread}
                />
              ) : (
                // The request an entry came in on, so a check can tell which turn it landed in.
                <div key={entry.id} className="contents" data-request-id={entry.requestId}>
                  <Entry entry={entry} />
                </div>
              ),
            )}
            {running && view?.turnStartedAt !== undefined ? (
              <div role="status" className="flex items-center gap-2 text-xs text-info" data-request-id={view.requestId}>
                <span className="size-2 animate-pulse rounded-full bg-info" />
                working · {elapsed(view.turnStartedAt, now)}
              </div>
            ) : null}
          </div>
        )}
        <JumpToLatestButton feed={feed} />
      </div>
      {session.projectId === null ? (
        <div role="note" className="border-t border-border px-6 py-4 text-sm">
          <span className="font-semibold">Choose a project</span>
          <span className="text-muted-foreground"> · This session has none, so nothing runs here. Start a new session and pick one.</span>
        </div>
      ) : (
        <Composer
          running={running}
          armed={keys.armed}
          onSend={(text) => {
            // Your own line brings you back to the end, wherever you had scrolled to.
            feed.sent();
            void adapter.send(session.id, text);
          }}
          onStop={() => void adapter.interrupt(session.id)}
        />
      )}
    </main>
  );
}
