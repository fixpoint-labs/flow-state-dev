import { FlowProvider, useInterruptKeys, useJumpToLatest } from "@flow-state-dev/react";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { RosterEntry } from "@flow-state-dev/workforce/browser";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import type { AppContext } from "../../flows/lab-context.mts";
import { useAppClient, useConversation, useConversationCalls, useTasks } from "../app";
import type { ConversationEntry } from "../lib/conversation";
import { delegatesOf, emptyLine, starterLines } from "../lib/first-run";
import type { Look } from "../lib/looks";
import { displayName, roleOf } from "../lib/roster";
import { answeringStep, useStatusLine } from "../lib/status";
import { ANSWERED_LINES_MAX, pendingFor, useTalk } from "../lib/talk";
import { cn } from "../lib/utils";
import { Avatar } from "./Avatar";
import { Composer } from "./Composer";
import { ContextStrip } from "./ContextStrip";
import { ConnectionBanner, isFeedStale, STALE_CLASS } from "./flow-state/connection-banner";
import type { HarnessReadinessChipRow } from "./flow-state/harness-readiness";
import { ConversationScrollButton } from "./flow-state/conversation";
import { LoadEarlier } from "./LoadEarlier";
import { Entry } from "./Entry";
import { answerIn, type Popup } from "./Popups";
import { workerOf } from "../lib/task";
import { TaskCard } from "./TaskCard";

/** A small button in the conversation's header. */
const HEADER_BUTTON = "rounded-sm border border-border px-2 py-0.5 font-mono text-xs tracking-widest uppercase hover:bg-accent";

type TaskEntry = Extract<ConversationEntry, { kind: "task" }>;
const placeholders = new WeakMap<TaskEntry, CodingBoardTask>();
/**
 * The card a filed task shows until its board row arrives, as a pending row with what the filing said: one object per
 * (reused) entry, so the memoized card skips re-renders.
 */
function placeholderOf(entry: TaskEntry, harness: string | undefined): CodingBoardTask {
  let task = placeholders.get(entry);
  if (task === undefined) {
    task = { id: entry.taskId, goal: entry.title, title: entry.title, assignee: entry.to, status: "pending", attempts: 0, asks: [], harness: harness ?? null, review: null, landed: null, error: null, pullRequests: [], runFlow: null, detail: null };
    placeholders.set(entry, task);
  }
  return task;
}

/**
 * The center: the worker's one conversation. A divider marks where the turns
 * the worker reads word for word begin. A message another worker sent that
 * waits for the current answer shows as a pending line until it lands. A
 * teammate the user hired also gets a fire control in the header; its
 * instructions are edited from its panel. Fire asks first in a row under the header, with Keep focused,
 * so a stray Enter keeps the teammate.
 *
 * New content settles in place: the list follows it only while you are at
 * the end, and offers *Jump to latest* when you have scrolled up. A task card
 * is drawn at its full size the moment it is filed, before its row arrives,
 * and "is answering" shows only until the turn's answer text starts.
 *
 * Stop, beside Send, stops every turn the worker is answering; so do Esc twice
 * and Cmd/Ctrl+., from anywhere on the page, never one Esc. A stopped turn
 * leaves its line in the conversation, and the newest one says how much
 * background work still runs while nothing came after it.
 */
export function Conversation({
  worker,
  sessionId,
  nameOf,
  lookOf,
  isCoding,
  harnessOf,
  onFire,
  onOpen,
  prefill,
  onPrefilled,
  workers = [],
  context,
  harnesses,
  onRecheck,
  onViewTasks,
}: {
  worker: RosterEntry;
  /** The roster as read: an empty conversation names the worker's delegates from it. */
  workers?: readonly RosterEntry[];
  /** What the lab works on and with; drawn over the conversation. */
  context?: AppContext;
  harnesses?: HarnessReadinessChipRow[];
  onRecheck?: () => Promise<unknown>;
  sessionId: string;
  nameOf: (id: string) => string;
  lookOf: (id: string) => Look;
  /** The worker is the one coding tasks run on, not a teammate. */
  isCoding: (id: string) => boolean;
  /** A coding worker's harness, by the screen's name for it. */
  harnessOf: (id: string) => string | undefined;
  onFire: () => Promise<void>;
  /** Open a popup over the conversation: a task it filed, or a message it sent. */
  onOpen: (popup: Popup) => void;
  /** Words a popup's follow-up adds to this conversation's composer, once per `n`. */
  prefill?: { text: string; n: number };
  /** Called once the composer took `prefill`'s words. */
  onPrefilled?: () => void;
  /** Show where this conversation's tasks are listed. */
  onViewTasks?: () => void;
}) {
  const calls = useConversationCalls();
  const followed = useConversation(sessionId);
  const view = followed?.view;
  // What the conversation's feed last heard from the server; a stale one greys the status and stops its clock.
  const connection = followed?.connection ?? "connecting";
  const stale = isFeedStale(connection);
  const mark = followed?.mark;
  // The flow the conversation runs on: what an approval's answer goes through (react's `useApproval`).
  const flow = useAppClient().conversations.flows.get(sessionId);
  const entries = view?.entries ?? [];
  // The worker's open messages, and the answers to the newest lines it sent: an older line shows no status, never a wrong one.
  const answered = entries.flatMap((e) => (e.kind === "sent" ? [e.messageId] : [])).slice(-ANSWERED_LINES_MAX);
  const talk = useTalk(worker.id, answered) ?? [];
  const running = view?.running ?? false;
  const pending = pendingFor(worker.id, talk, entries, view?.since);
  const tasks = useTasks(sessionId).value ?? [];
  const status = useStatusLine(worker.id, sessionId, nameOf, isCoding, stale);
  const [panel, setPanel] = useState<"fire">();
  const delegates = delegatesOf(worker, workers, context);
  // A starter line picked from the empty conversation: the composer takes it as its text, and nothing is sent.
  const [seed, setSeed] = useState<{ text: string; at: number }>();
  const keep = useRef<HTMLButtonElement>(null);
  const fireButton = useRef<HTMLButtonElement>(null);
  // Keep (or Esc) closes the row and puts focus back on the header's Fire, where you were.
  const keepWorker = () => {
    setPanel(undefined);
    fireButton.current?.focus();
  };
  useEffect(() => {
    if (panel === "fire") keep.current?.focus();
  }, [panel]);

  const last = entries[entries.length - 1];
  // An answer on screen, written or being written, is the sign it is answering; the line shows only before one starts.
  const answering = running && last?.kind !== "assistant";
  // What it is doing while it answers; a stale feed can't say, so the line falls back to "is answering".
  const step = answering && !stale ? answeringStep(entries) : undefined;
  const feed = useJumpToLatest({ resetKey: sessionId });
  const stopping = view?.stopping ?? false;
  // Why the server refused the last Stop, shown beside the button until the next one.
  const [stopRefused, setStopRefused] = useState<string>();
  const stop = useCallback(() => {
    setStopRefused(undefined);
    calls.stop(sessionId).catch((error: unknown) => setStopRefused(error instanceof Error ? error.message : String(error)));
  }, [calls, sessionId]);
  // On the document, so the keys work wherever focus is; a popup's Esc arrives already spent.
  const keys = useInterruptKeys({ enabled: running && !stopping, onInterrupt: stop, target: "document" });
  // The count belongs to the newest stopped line, while no later turn has started.
  const stillRunningFor = (entry: ConversationEntry) =>
    entry === last && entry.kind === "stopped" && !running ? (view?.backgroundRunning ?? undefined) : undefined;

  // Stable, so a memoized line doesn't redraw for a new function.
  const openTask = useCallback((taskId: string) => onOpen({ kind: "task", sessionId, taskId }), [onOpen, sessionId]);
  const openMessage = useCallback(
    (sent: Extract<ConversationEntry, { kind: "sent" }>) => onOpen({ kind: "message", from: worker.id, to: sent.to, messageId: sent.messageId, text: sent.text }),
    [onOpen, worker.id],
  );

  // A line is drawn from the filing until the board's row arrives, then from the row, in the same place.
  const taskTile = (entry: TaskEntry) => {
    const task = tasks.find((t) => t.id === entry.taskId) ?? placeholderOf(entry, harnessOf(entry.to));
    return <TaskCard task={task} nameOf={nameOf} lookOf={lookOf} coding={isCoding(workerOf(task))} onOpen={openTask} />;
  };

  const markAt = mark ? entries.findIndex((e) => e.id === mark.firstVerbatimEntryId) : -1;
  return (
    <main aria-label="Conversation" className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3">
        <Avatar look={lookOf(worker.id)} />
        <div className="min-w-0">
          <h1 className="text-sm font-semibold">{displayName(worker)}</h1>
          <p className={cn("truncate text-xs text-muted-foreground", stale && STALE_CLASS)} data-header-status>
            {status}
          </p>
        </div>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{roleOf(worker)}</span>
        {worker.standard ? null : (
          <button ref={fireButton} type="button" onClick={() => setPanel("fire")} aria-expanded={panel === "fire"} className={HEADER_BUTTON}>
            Fire
          </button>
        )}
        {running ? (
          <span className={cn("flex items-center gap-1.5 font-mono text-xs tracking-widest text-info uppercase", stale && STALE_CLASS)}>
            <span className="size-2 animate-pulse rounded-full bg-info" /> working
          </span>
        ) : null}
      </header>
      {onRecheck === undefined ? null : <ContextStrip context={context} harnesses={harnesses} onRecheck={onRecheck} />}
      {/* A stopped feed comes back with the page: every conversation's feed reopens on load. */}
      <ConnectionBanner feed={{ state: connection }} onRetry={() => window.location.reload()} />
      {panel === "fire" ? (
        <div
          role="group"
          aria-label={`Fire ${displayName(worker)}?`}
          className="flex items-center gap-3 border-b border-border bg-destructive/10 px-6 py-2 text-sm"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              keepWorker();
            }
          }}
        >
          <span className="min-w-0 flex-1">Fire {displayName(worker)}? It leaves your roster; this conversation stays readable.</span>
          <button type="button" onClick={() => void onFire()} className={cn(HEADER_BUTTON, "text-destructive")}>
            Fire
          </button>
          <button ref={keep} type="button" onClick={keepWorker} className={HEADER_BUTTON}>
            Keep
          </button>
        </div>
      ) : null}
      <FlowProvider flowKind={flow}>
        <div ref={feed.ref} data-scroller className="relative flex-1 overflow-y-auto px-6 pt-4 pb-10">
          <div data-column className="mx-auto flex max-w-(--thread-width) flex-col gap-3">
            <LoadEarlier load={view?.loadEarlier} />
            {entries.length === 0 ? (
              <div className="mt-24 flex flex-col items-center gap-3 text-center text-sm text-muted-foreground">
                <p data-testid="conversation-empty">{emptyLine(worker, delegates)}</p>
                <ul aria-label="Starter lines" className="flex flex-col gap-1.5">
                  {starterLines(worker, delegates).map((line) => (
                    <li key={line}>
                      <button
                        type="button"
                        onClick={() => setSeed({ text: line, at: Date.now() })}
                        className="rounded-full border border-border bg-card px-3 py-1 text-xs text-foreground hover:bg-muted"
                      >
                        {line}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {entries.map((entry, i) => (
              <Fragment key={entry.id}>
                {i === markAt && mark ? (
                  <div role="separator" aria-label={mark.summarized ? "Earlier turns summarized" : "Earlier turns out of view"} className="my-2 flex items-center gap-3">
                    <span className="h-px flex-1 bg-border" />
                    <span className="font-mono text-xs tracking-widest text-muted-foreground uppercase">
                      {mark.summarized ? "Earlier turns summarized" : "Earlier turns out of view"}
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                ) : null}
                <div
                  className={cn(i < markAt && "opacity-60")}
                  data-in-window={markAt < 0 || i >= markAt ? "true" : "false"}
                  {...(entry.kind === "user" ? feed.mine(entry.id) : {})}
                >
                  {entry.kind === "task" ? (
                    taskTile(entry)
                  ) : (
                    <Entry
                      entry={entry}
                      workerName={displayName(worker)}
                      nameOf={nameOf}
                      lookOf={lookOf}
                      isCoding={isCoding}
                      answer={entry.kind === "sent" && answered.includes(entry.messageId) ? answerIn(talk, entry.messageId) : undefined}
                      onOpenMessage={openMessage}
                      onOpenTask={openTask}
                      stillRunning={stillRunningFor(entry)}
                      onViewTasks={onViewTasks}
                      readFile={calls.readFile}
                      // Retry only the newest turn, and not while one runs: the engine runs a failed request again as a new one.
                      {...(entry.kind === "failed" && entry.retryable && !running ? { onRetry: () => calls.retry(sessionId, entry.requestId) } : {})}
                    />
                  )}
                </div>
              </Fragment>
            ))}
            {answering ? (
              <div role="status" data-chat-activity className={cn("w-fit rounded-lg border border-border bg-card px-3 py-2 text-xs", step?.tone ?? "text-muted-foreground", stale && STALE_CLASS)}>
                {step === undefined ? `${displayName(worker)} is answering…` : `${displayName(worker)} · ${step.text}…`}
              </div>
            ) : null}
            {pending.map((m) => (
              <div
                key={m.id}
                data-pending={m.id}
                className="w-fit rounded-md border border-dashed border-attention bg-attention/15 px-3 py-1.5 font-mono text-xs text-foreground"
              >
                ← {nameOf(m.from)} {m.inReplyTo ? "replied" : "sent a message"} · {displayName(worker)} reads it {running ? "after this turn" : "next"}
              </div>
            ))}
          </div>
          <ConversationScrollButton feed={feed} className="size-8" />
        </div>
      </FlowProvider>
      <Composer
        sessionId={sessionId}
        workerName={displayName(worker)}
        running={running}
        stopping={stopping}
        stopRefused={stopRefused}
        armed={keys.armed}
        onStop={stop}
        seed={seed}
        prefill={prefill}
        onPrefilled={onPrefilled}
        uploader={calls}
        onSend={(text, attachments) => {
          // Your own line takes you to the end, wherever you had scrolled to.
          feed.sent();
          return calls.send(sessionId, text, attachments);
        }}
      />
    </main>
  );
}
