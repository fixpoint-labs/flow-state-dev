import { useMemo, useState } from "react";
import { FlowProvider, useInterruptKeys, useJumpToLatest, type ItemLine } from "@flow-state-dev/react";
import { FILED_TASK_DATA_TYPE, type FiledTaskValue } from "@flow-state-dev/workforce/browser";
import { useApp, useThread, type AppProject, type AppSession, type AppTask } from "../app";
import { elapsed, useNow } from "../lib/use-watch";
import { modeOfWorker } from "../modes";
import { cn } from "../lib/utils";
import { Composer } from "./Composer";
import { PaneHeader } from "./PaneHeader";
import { WorkingDots } from "./WorkingDots";
import { ConnectionBanner, isFeedStale, STALE_CLASS } from "./flow-state/connection-banner";
import { ConversationScrollButton } from "./flow-state/conversation";
import { LineContext, stillRunningLine, type LineContextValue } from "./flow-state/conversation-lines";
import { SessionItemsProvider } from "./flow-state/session-items-context";
import { isTaskBrief } from "./flow-state/workforce-lines";
import { LoadEarlier } from "./LoadEarlier";
import { claudeCodeRenderers, Line, useLines } from "./lines";
import { ThreadCard } from "./ThreadCard";
import { STARTER_LINES } from "../lib/first-run";

/**
 * The center: the open session's thread, its working indicator, and the
 * composer. A thread whose feed has failed a retry draws the registry's
 * `connection-banner` and greys its working line, whose clock stops there.
 * The header names the session's project; a session with none gets
 * no composer, so nothing runs until it has one (spec D3). The lines are the
 * lab's (`lines.tsx`), drawn with this thread's line context: Retry on the
 * newest failed turn while nothing runs, and the work still running on the
 * stopped line that can say it truly. In threads mode a thread the lead filed
 * is a card here, read from the board's task, and your line is marked *Sent to a
 * task* when its turn filed one. A result line, and the line where the main
 * session started a task, open that task through `onOpenThread`, as the pane
 * does.
 *
 * Esc twice, or Cmd/Ctrl+., stops the turn from anywhere on the page. One Esc
 * never does: it closes a sheet, or belongs to the text box it was typed in.
 * A stopped turn leaves its line in the thread; the count of background work
 * still running shows on the newest one only while nothing came after it,
 * since a line about work started since would be false.
 */
export function Thread({
  session,
  project,
  tasks,
  onOpenThread,
  onViewTasks,
}: {
  session: AppSession;
  project: AppProject | undefined;
  /** The session's task rows, as the app reads them for this thread and its pane; `undefined` until read. */
  tasks: AppTask[] | undefined;
  onOpenThread: (taskId: string) => void;
  /** Show where this session's background tasks are listed. */
  onViewTasks?: () => void;
}) {
  const lab = useApp();
  const mode = modeOfWorker(session.worker);
  const threads = mode?.pane === "board";
  const view = useThread(session.id);
  const lines = useLines(view?.items, view?.turns);
  const running = view?.running ?? false;
  // What the thread's feed last heard from the server; a stale one greys the working line and stops its clock.
  const connection = view?.connection ?? "connecting";
  const stale = isFeedStale(connection);
  const now = useNow(running && !stale);
  const count = lines?.length ?? 0;
  const feed = useJumpToLatest({ resetKey: session.id });
  const stopping = view?.stopping ?? false;
  // Why the server refused the last Stop, shown beside the button until the next one.
  const [stopRefused, setStopRefused] = useState<string>();
  const stop = () => {
    setStopRefused(undefined);
    lab.interrupt(session.id).catch((error: unknown) => setStopRefused(error instanceof Error ? error.message : String(error)));
  };
  // A starter line picked from the empty thread: the composer takes it as its text, and nothing is sent.
  const [seed, setSeed] = useState<{ text: string; at: number }>();
  // On the document, so the keys work wherever focus is; a sheet's Esc arrives already spent.
  const keys = useInterruptKeys({
    enabled: running && !stopping && session.projectId !== null,
    onInterrupt: stop,
    target: "document",
  });
  // The count belongs to the newest stopped line, while no later turn has started.
  const runningLine = lines === undefined ? undefined : stillRunningLine(lines, running);
  const backgroundRunning = view?.backgroundRunning ?? undefined;
  const lineContext = useMemo<LineContextValue>(
    () => ({
      who: "The main session",
      openTask: onOpenThread,
      // Retry only while nothing runs: the engine retries a failed request as a new one.
      ...(running ? {} : { retry: (requestId: string) => lab.retry(session.id, requestId) }),
      stillRunning: (lineId) => (lineId === runningLine ? backgroundRunning : undefined),
      ...(onViewTasks === undefined ? {} : { onViewRunning: onViewTasks }),
      readFile: lab.readFile,
    }),
    [onOpenThread, running, lab, session.id, runningLine, backgroundRunning, onViewTasks],
  );
  // Threads mode: the turns that filed a thread, whose line is marked.
  const filingTurns = useMemo(() => new Set((threads ? (lines ?? []) : []).filter((line) => filedTask(line) !== undefined).map((line) => line.requestId)), [threads, lines]);

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
            <FlowProvider sessionId={session.id} renderers={claudeCodeRenderers}>
              <LineContext.Provider value={lineContext}>
                <SessionItemsProvider value={view?.items ?? []}>
                  {lines?.map((line) => {
                    const filed = threads ? filedTask(line) : undefined;
                    if (filed !== undefined) {
                      return <ThreadCard key={line.id} sessionId={session.id} task={tasks?.find((t) => t.id === filed)} onOpen={onOpenThread} />;
                    }
                    // Your line, with the feed's mark, so a line you send rises to near the top of the feed.
                    if (line.kind === "user" && !isTaskBrief(line.item)) {
                      return (
                        <div key={line.id} className="flex flex-col items-end gap-1.5" data-request-id={line.requestId} {...feed.mine(line.id)}>
                          <Line line={line} />
                          {filingTurns.has(line.requestId) ? <span className="text-xs text-muted-foreground">↳ Sent to a task</span> : null}
                        </div>
                      );
                    }
                    // The request a line came in on, so a check can tell which turn it landed in.
                    return (
                      <div key={line.id} className="contents" data-request-id={line.requestId}>
                        <Line line={line} />
                      </div>
                    );
                  })}
                </SessionItemsProvider>
              </LineContext.Provider>
            </FlowProvider>
            {running && view?.turnStartedAt !== undefined ? (
              <div role="status" className={cn("flex items-center gap-3 py-1 text-sm text-muted-foreground", stale && STALE_CLASS)} data-request-id={view.requestId}>
                <WorkingDots />
                working · {elapsed(view.turnStartedAt, now)}
              </div>
            ) : null}
          </div>
        )}
        <ConversationScrollButton feed={feed} className="size-8" />
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
          stopping={stopping}
          stopRefused={stopRefused}
          armed={keys.armed}
          seed={seed}
          uploader={lab}
          onSend={(text, attachments) => {
            // Your own line brings you back to the end, wherever you had scrolled to.
            feed.sent();
            return lab.send(session.id, text, attachments);
          }}
          onStop={stop}
        />
      )}
    </main>
  );
}

/** The task a thread's line filed, when it is a filed task's line (`workforce:task`). */
function filedTask(line: ItemLine): string | undefined {
  return line.kind === "data" && line.item.dataType === FILED_TASK_DATA_TYPE ? (line.item.value as Partial<FiledTaskValue>).taskId : undefined;
}
