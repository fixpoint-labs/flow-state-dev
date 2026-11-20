import { FlowProvider, useInterruptKeys, useJumpToLatest, type ItemLine } from "@flow-state-dev/react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SENT_MESSAGE_DATA_TYPE, type RosterEntry, type SentMessageValue } from "@flow-state-dev/workforce/browser";
import type { AppContext } from "../../flows/lab-context.mts";
import { useAppClient, useConversation, useConversationCalls } from "../app";
import { delegatesOf, emptyLine, starterLines } from "../lib/first-run";
import type { Look } from "../lib/looks";
import { displayName, roleOf, useWorkforce } from "../lib/roster";
import { answeringStep, PLAIN, useStatus, type Status } from "../lib/status";
import { ANSWERED_LINES_MAX, pendingFor, useTalk } from "../lib/talk";
import { cn } from "../lib/utils";
import { Avatar } from "./Avatar";
import { Composer } from "./Composer";
import { ContextStrip } from "./ContextStrip";
import { Divider } from "./Divider";
import { EditForm } from "./TeammateForms";
import { ResetButton } from "./TeammatePanel";
import { ConnectionBanner, isFeedStale, STALE_CLASS } from "./flow-state/connection-banner";
import type { HarnessReadinessChipRow } from "./flow-state/harness-readiness";
import { ConversationScrollButton } from "./flow-state/conversation";
import { LoadEarlier } from "./LoadEarlier";
import { LineContext, stillRunningLine, type LineContextValue } from "./flow-state/conversation-lines";
import { drawsLine, Line, teammatesRenderers, useLinesNames } from "./lines";
import { answerIn, type Popup } from "./Popups";

/** A button in the conversation's header. */
const HEADER_BUTTON =
  "h-8 shrink-0 rounded-sm border border-border-strong px-3 text-sm font-medium hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** The header pill's colours: amber when it asks you to act, green while it works, quiet when idle, a task's own tone otherwise. */
const pillTone = (status: Status) =>
  status.needsYou
    ? "border border-warning-line bg-warning-soft text-warning-text"
    : status.tone !== PLAIN
      ? cn("border border-border bg-surface", status.tone)
      : status.text.startsWith("Idle")
        ? "border border-border bg-surface text-text-2"
        : "bg-success-soft text-success-text";
const pillDot = (status: Status) => (status.needsYou ? "bg-warning" : status.tone === PLAIN && status.text.startsWith("Idle") ? "bg-presence-idle" : status.tone !== PLAIN ? "bg-current" : "bg-success");

/** The ids of the messages the worker's sent lines sent. */
const sentIds = (lines: readonly ItemLine[]) =>
  lines.flatMap((line) => (line.kind === "data" && line.item.dataType === SENT_MESSAGE_DATA_TYPE && typeof (line.item.value as Partial<SentMessageValue>)?.messageId === "string" ? [(line.item.value as SentMessageValue).messageId!] : []));

/**
 * The center: the worker's one conversation. A divider marks where the turns
 * the worker reads word for word begin. A message another worker sent that
 * waits for the current answer shows as a pending line until it lands. The
 * header carries the teammate's status pill and description, and *Edit
 * teammate*, which opens the rename-and-instructions form in a row under it
 * (with *Reset to default* on a file's teammate you edited). A teammate the user
 * hired also gets *Fire*, which asks first in a row under the header, with Keep
 * focused, so a stray Enter keeps the teammate.
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
  const lines = view?.lines ?? [];
  // The worker's open messages, and the answers to the newest lines it sent: an older line shows no status, never a wrong one.
  const answered = sentIds(lines).slice(-ANSWERED_LINES_MAX);
  const talk = useTalk(worker.id, answered) ?? [];
  const running = view?.running ?? false;
  const pending = pendingFor(worker.id, talk, lines, view?.since);
  const status = useStatus(worker.id, sessionId, nameOf, isCoding, stale);
  const workforce = useWorkforce();
  const [panel, setPanel] = useState<"fire" | "edit">();
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

  // What is on screen: a line the lab draws as nothing neither ends an answer nor fills the conversation.
  const drawn = useMemo(() => lines.filter(drawsLine), [lines]);
  const last = drawn[drawn.length - 1];
  // An answer on screen, written or being written, is the sign it is answering; the line shows only before one starts.
  const answering = running && last?.kind !== "assistant";
  // What it is doing while it answers; a stale feed can't say, so the line falls back to "is answering".
  const step = answering && !stale ? answeringStep(drawn) : undefined;
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
  const workerName = displayName(worker);
  const backgroundRunning = view?.backgroundRunning ?? undefined;
  const talkKey = answered.map((id) => `${id}:${answerIn(talk, id)}`).join(",");
  const names = useLinesNames(nameOf, lookOf, isCoding);
  const runningLine = stillRunningLine(drawn, running);
  // What each line can do on this screen, one object while none of it changes, so a memoized line doesn't redraw.
  const screenOfLines = useMemo<LineContextValue>(
    () => ({
      who: workerName,
      ...names,
      sentStatusOf: (messageId) => (answered.includes(messageId) ? answerIn(talk, messageId) : undefined),
      openMessage: (sent) => onOpen({ kind: "message", from: worker.id, ...sent }),
      openTask: (taskId) => onOpen({ kind: "task", sessionId, taskId }),
      // Retry only the newest turn, and not while one runs: the engine runs a failed request again as a new one.
      ...(running ? {} : { retry: (requestId: string) => calls.retry(sessionId, requestId) }),
      stillRunning: (lineId) => (lineId === runningLine ? backgroundRunning : undefined),
      onViewRunning: onViewTasks,
      readFile: calls.readFile,
      canAnswer: true,
    }),
    // `answered` and `talk` are left out: `talkKey` stands for them, and changes only when how a sent message stands does,
    // where the message log's array is new on every read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workerName, names, talkKey, onOpen, worker.id, sessionId, running, calls, runningLine, backgroundRunning, onViewTasks],
  );

  const markAt = mark ? lines.findIndex((line) => line.id === mark.firstVerbatimLineId) : -1;
  return (
    <main aria-label="Conversation" className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3.5">
        <Avatar look={lookOf(worker.id)} size="lg" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="truncate text-base font-semibold">{displayName(worker)}</h1>
            {/* Drawn while empty too (before the first read), hidden: what reads the line finds it from the start. */}
            {(
              <span
                hidden={status.text === ""}
                className={cn("inline-flex min-w-0 shrink items-center gap-1.5 rounded-full px-2 py-0.5 text-xs", pillTone(status), stale && STALE_CLASS)}
                data-header-status
                title={status.text}
              >
                <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", pillDot(status))} />
                <span className="truncate">{status.text}</span>
              </span>
            )}
          </div>
          {roleOf(worker) === "" ? null : (
            <p className="truncate text-sm text-text-2" title={roleOf(worker)}>
              {roleOf(worker)}
            </p>
          )}
        </div>
        <button type="button" onClick={() => setPanel(panel === "edit" ? undefined : "edit")} aria-expanded={panel === "edit"} className={HEADER_BUTTON}>
          Edit teammate
        </button>
        {worker.standard ? null : (
          <button ref={fireButton} type="button" onClick={() => setPanel("fire")} aria-expanded={panel === "fire"} className={cn(HEADER_BUTTON, "text-danger")}>
            Fire
          </button>
        )}
      </header>
      {panel === "edit" ? (
        <div className="flex flex-col gap-2 border-b border-border bg-surface px-6 py-3">
          <EditForm
            name={displayName(worker)}
            onSave={async (edit) => {
              await workforce.edit({ id: worker.id, ...edit });
              setPanel(undefined);
            }}
            onCancel={() => setPanel(undefined)}
          />
          {/* A reset closes the form: left open, it would hold the old name and instructions, and Save would put them back. */}
          {worker.edited ? (
            <ResetButton
              name={displayName(worker)}
              onReset={async () => {
                await workforce.reset(worker.id);
                setPanel(undefined);
              }}
            />
          ) : null}
        </div>
      ) : null}
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
      {/* The session names the conversation's board, which a filed task's card reads. */}
      <FlowProvider flowKind={flow} sessionId={sessionId} renderers={teammatesRenderers}>
        <LineContext.Provider value={screenOfLines}>
        <div ref={feed.ref} data-scroller className="relative flex-1 overflow-y-auto px-6 pt-4 pb-10">
          <div data-column className="mx-auto flex max-w-(--thread-width) flex-col gap-3">
            <LoadEarlier load={view?.loadEarlier} />
            {drawn.length === 0 ? (
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
            {lines.map((line, i) => (
              <Fragment key={line.id}>
                {i === markAt && mark ? (
                  <Divider label={mark.summarized ? "Earlier turns summarized" : "Earlier turns out of view"} />
                ) : null}
                {/* A line its renderer draws nothing for takes no room. */}
                <div
                  className={cn("empty:hidden", i < markAt && "opacity-60")}
                  data-in-window={markAt < 0 || i >= markAt ? "true" : "false"}
                  {...(line.kind === "user" ? feed.mine(line.id) : {})}
                >
                  <Line line={line} />
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
        </LineContext.Provider>
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
        harnesses={harnesses}
        defaultHarness={context?.harness}
        // The teammate's own model when it has one set (a pick saved by Respond with), else the lab's.
        replyModel={typeof worker.settings.model === "string" ? worker.settings.model : context?.model}
        models={context?.models}
        onPickModel={async (model) => void (await workforce.edit({ id: worker.id, settingsPatch: { model } }))}
        onSend={(text, attachments) => {
          // Your own line takes you to the end, wherever you had scrolled to.
          feed.sent();
          return calls.send(sessionId, text, attachments);
        }}
      />
    </main>
  );
}
