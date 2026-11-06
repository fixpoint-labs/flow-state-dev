import { useInterruptKeys, useJumpToLatest } from "@flow-state-dev/react";
import type { LabAdapter, ProjectRow, SessionRow, TaskRow } from "../adapter";
import { elapsed, useNow, useWatch } from "../lib/use-watch";
import { modeOfWorker } from "../modes";
import { cn } from "../lib/utils";
import { Composer } from "./Composer";
import { PaneHeader } from "./PaneHeader";
import { WorkingDots } from "./WorkingLine";
import { ConnectionBanner, isFeedStale, STALE_CLASS } from "./flow-state/connection-banner";
import { JumpToLatestButton } from "./JumpToLatest";
import { LoadEarlier } from "./LoadEarlier";
import { Entry } from "./Entry";
import { ThreadCard } from "./ThreadCard";
import { STARTER_LINES } from "../lib/first-run";
import { useState } from "react";

/**
 * The center: the open session's thread, its working indicator, and the
 * composer. A thread whose feed has failed a retry draws the registry's
 * `connection-banner` and greys its working line, whose clock stops there.
 * The header names the session's project; a session with none gets
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
  // What the thread's feed last heard from the server; a stale one greys the working line and stops its clock.
  const connection = view?.connection ?? "connecting";
  const stale = isFeedStale(connection);
  const now = useNow(running && !stale);
  const count = view?.entries.length ?? 0;
  const feed = useJumpToLatest({ resetKey: session.id });
  const retryOf = (requestId: string) => () => adapter.retry(session.id, requestId);
  // A starter line picked from the empty thread: the composer takes it as its text, and nothing is sent.
  const [seed, setSeed] = useState<{ text: string; at: number }>();
  // On the document, so the keys work wherever focus is; a sheet's Esc arrives already spent.
  const keys = useInterruptKeys({
    enabled: running && session.projectId !== null,
    onInterrupt: () => void adapter.interrupt(session.id),
    target: "document",
  });

  return (
    <main aria-label="Main thread" className="flex h-full min-h-0 min-w-0 flex-col">
      <PaneHeader className="px-6">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{session.title}</h1>
          <div className="truncate font-mono text-xs text-muted-foreground">
            {session.projectId === null ? "no project" : `in project: ${project?.name ?? session.projectId}`}
          </div>
        </div>
      </PaneHeader>
      {/* A stopped feed comes back with the page: the thread's feed reopens on load. */}
      <ConnectionBanner feed={{ state: connection }} onRetry={() => window.location.reload()} />
      <div ref={feed.ref} className="flex-1 overflow-y-auto px-6 pt-4 pb-10">
        {count === 0 ? (
          <div className="mx-auto mt-24 max-w-sm text-center text-sm text-muted-foreground">
            {mode?.pane === "board"
              ? "Ask the main session for something. It hands each piece to a task of its own, and each comes back to you when it needs you."
              : "Ask the main session for something. It does what it can itself and starts background tasks for the long pieces."}
            {mode === undefined || session.projectId === null ? null : (
              <ul aria-label="Starter lines" className="mt-4 flex flex-col gap-2">
                {STARTER_LINES[mode.id].map((line) => (
                  <li key={line}>
                    <button
                      type="button"
                      onClick={() => setSeed({ text: line, at: Date.now() })}
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-left text-xs text-foreground hover:bg-accent"
                    >
                      {line}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-3 [&>*]:shrink-0">
            <LoadEarlier load={view?.loadEarlier} />
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
                  <Entry
                    entry={entry}
                    mark={entry.kind === "user" ? feed.mine(entry.id) : undefined}
                    // Retry only the newest turn, and not while one runs: the engine retries a failed request as a new one.
                    onRetry={entry.kind === "failed" && entry.retryable && !running && entry.requestId !== undefined ? retryOf(entry.requestId) : undefined}
                  />
                </div>
              ),
            )}
            {running && view?.turnStartedAt !== undefined ? (
              <div role="status" className={cn("flex items-center gap-3 py-1 text-sm text-muted-foreground", stale && STALE_CLASS)} data-request-id={view.requestId}>
                <WorkingDots />
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
          sessionId={session.id}
          running={running}
          armed={keys.armed}
          seed={seed}
          onSend={(text) => {
            // Your own line brings you back to the end, wherever you had scrolled to.
            feed.sent();
            return adapter.send(session.id, text);
          }}
          onStop={() => void adapter.interrupt(session.id)}
        />
      )}
    </main>
  );
}
