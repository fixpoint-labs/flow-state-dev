import { FlowProvider, useInterruptKeys, useJumpToLatest, type ItemLine } from "@flow-state-dev/react";
import { EllipsisIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SENT_MESSAGE_DATA_TYPE, type RosterEntry, type SentMessageValue } from "@flow-state-dev/workforce/browser";
import type { AppContext } from "../../flows/lab-context.mts";
import { useAppClient, useConversation, useConversationCalls, useTasks } from "../app";
import { delegatesOf, emptyLine, starterLines } from "../lib/first-run";
import type { BotStatus, Look } from "../lib/looks";
import { displayName, settingOf, useWorkforce } from "../lib/roster";
import { dayLabel } from "../lib/day-label";
import { answeringStep, PLAIN, useStatus } from "../lib/status";
import { ANSWERED_LINES_MAX, pendingFor, useTalk } from "../lib/talk";
import { cn } from "../lib/utils";
import { BotFigure } from "./Avatar";
import { Composer } from "./Composer";
import { ContextStrip } from "./ContextStrip";
import { Divider } from "./Divider";
import { EditForm, TeammateDialog } from "./TeammateForms";
import { ResetButton } from "./TeammatePanel";
import { ConnectionBanner, isFeedStale, STALE_CLASS } from "./flow-state/connection-banner";
import type { HarnessReadinessChipRow } from "./flow-state/harness-readiness";
import { ConversationScrollButton } from "./flow-state/conversation";
import { LoadEarlier } from "./LoadEarlier";
import { LineContext, stillRunningLine, type LineContextValue } from "./flow-state/conversation-lines";
import { drawsLine, Line, teammatesRenderers, useLinesNames } from "./lines";
import { answerIn, type Popup } from "./Popups";
import { WaitingCard } from "./WaitingCard";
import type { CodingBoardTask } from "@flow-state-dev/harness-manager/browser";
import type { InboxHold } from "@flow-state-dev/orchestration/inbox";
import { taskStatus, workerOf } from "../lib/task";

/** A borderless button in the conversation's header. */
const HEADER_BUTTON =
  "h-7 shrink-0 rounded-md border border-transparent px-2.5 text-sm font-medium text-text-2 hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/**
 * The header pill follows the bot: blue while it works, the highlighter when
 * it needs you (a pill, never a panel), green once done, a dashed ring while
 * it waits on someone else, quiet when idle.
 */
const PILL: Record<BotStatus, string> = {
  running: "bg-(--bluebg) text-brand",
  needs: "bg-attention text-attention-foreground",
  done: "bg-success-soft text-success-text",
  queued: "border border-dashed border-border-strong text-text-2",
  idle: "bg-muted text-text-2",
};
const DOT: Record<BotStatus, string> = { running: "bg-brand", needs: "bg-attention-foreground", done: "bg-success", queued: "border border-dashed border-current", idle: "bg-presence-idle" };

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
  // The header's ⋯ menu, and its button, where focus goes back to after Keep.
  const [menu, setMenu] = useState(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const delegates = delegatesOf(worker, workers, context);
  // A starter line picked from the empty conversation: the composer takes it as its text, and nothing is sent.
  const [seed, setSeed] = useState<{ text: string; at: number }>();
  const keep = useRef<HTMLButtonElement>(null);
  // Keep (or Esc) closes the fire confirmation and puts focus back on the header's ⋯, where Fire was picked.
  const keepWorker = () => {
    setPanel(undefined);
    moreButton.current?.focus();
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
  const model = settingOf(worker, "model") ?? context?.model;
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
  // What the conversation's tasks wait on you for, each a card where it was asked; one you answered here keeps its line.
  const tasks = useTasks(sessionId).value;
  // Kept with the conversation they were given in: switching teammates shows none of another's.
  const [given, setGiven] = useState<{ session: string; all: Readonly<Record<string, Answered>> }>({ session: sessionId, all: {} });
  const answers = given.session === sessionId ? given.all : NONE_ANSWERED;
  const waiting = useMemo(() => waitingCards(tasks ?? [], answers, lines), [tasks, answers, lines]);
  const card = (w: Waiting) => (
    <WaitingCard
      key={w.key}
      task={w.task}
      hold={w.hold}
      sessionId={sessionId}
      who={isCoding(workerOf(w.task)) ? "The coding task" : nameOf(workerOf(w.task))}
      answered={answers[w.key]?.line}
      onAnswered={(line) => setGiven((was) => ({ session: sessionId, all: { ...(was.session === sessionId ? was.all : {}), [w.key]: { line, openedAt: w.openedAt, task: w.task } } }))}
      onOpen={() => onOpen({ kind: "task", sessionId, taskId: w.task.id })}
    />
  );
  // The first drawn line of each day, and its day's label.
  const days = useMemo(() => dayBreaks(drawn), [drawn]);
  // A lost feed may be out of date: the bot and the pill both drop to idle, the words stay, dimmed.
  const shown = stale ? "idle" : status.state;
  // A failed coding task leaves the bot idle, but its pill keeps the failure's red, as the sidebar's line does.
  const failed = shown === "idle" && status.tone !== PLAIN;
  return (
    <main aria-label="Conversation" className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex items-start gap-4 border-b border-border px-6 pt-4 pb-3">
        <BotFigure look={lookOf(worker.id)} state={shown} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="truncate text-lg leading-7 font-semibold">{displayName(worker)}</h1>
            {/* Drawn while empty too (before the first read), hidden: what reads the line finds it from the start. */}
            {(
              <span
                // What waits on you is a card in the conversation, never a banner here: the rail and the task panel say it waits.
                hidden={status.text === "" || status.needsYou}
                className={cn("inline-flex min-w-0 shrink items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", failed ? cn("bg-(--redbg)", status.tone) : PILL[shown], stale && STALE_CLASS)}
                data-header-status
                data-state={shown}
                title={status.text}
              >
                <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", failed ? "bg-current" : DOT[shown])} />
                <span className="truncate">{status.text}</span>
              </span>
            )}
            <span aria-hidden className="flex-1" />
            <button type="button" onClick={() => setPanel("edit")} aria-haspopup="dialog" aria-label="Edit teammate" title="Edit teammate" className={HEADER_BUTTON}>
              Edit
            </button>
            {worker.standard ? null : (
              <div
                className="relative"
                onKeyDown={(event) => event.key === "Escape" && menu && (event.stopPropagation(), setMenu(false), moreButton.current?.focus())}
                // A click outside or a Tab away closes it: focus leaving the button and its menu.
                onBlur={(event) => menu && !event.currentTarget.contains(event.relatedTarget as Node | null) && setMenu(false)}
              >
                <button
                  ref={moreButton}
                  type="button"
                  aria-label={`More for ${displayName(worker)}`}
                  aria-haspopup="menu"
                  aria-expanded={menu}
                  onClick={() => setMenu((open) => !open)}
                  className={cn(HEADER_BUTTON, "grid w-8 place-items-center px-0")}
                >
                  <EllipsisIcon aria-hidden className="size-4" />
                </button>
                {menu ? (
                  <div role="menu" className="absolute top-full right-0 z-20 mt-1 min-w-40 rounded-lg border border-border bg-card p-1 shadow-(--shadow-card)">
                    <button
                      type="button"
                      role="menuitem"
                      autoFocus
                      onClick={() => {
                        setMenu(false);
                        setPanel("fire");
                      }}
                      className="flex w-full rounded-md px-2.5 py-1.5 text-left text-sm text-danger hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      Fire {displayName(worker)}
                    </button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
          {worker.description ? (
            <p className="truncate text-sm text-text-2" title={worker.description}>
              {worker.description}
            </p>
          ) : null}
          {onRecheck === undefined ? null : (
            <ContextStrip
              context={context}
              harnesses={harnesses}
              onRecheck={onRecheck}
              model={model}
              harness={context?.harness}
            />
          )}
        </div>
      </header>
      <TeammateDialog
        open={panel === "edit"}
        onOpenChange={(open) => setPanel(open ? "edit" : undefined)}
        title={`Edit ${displayName(worker)}`}
        description={`${displayName(worker)}'s name, instructions, look and model. Changes apply from its next turn.`}
      >
        <EditForm
          name={displayName(worker)}
          choices={{ models: context?.models }}
          current={{ model, icon: lookOf(worker.id).face, color: lookOf(worker.id).color }}
          onSave={async (edit) => {
            await workforce.edit({ id: worker.id, ...edit });
            setPanel(undefined);
          }}
          onCancel={() => setPanel(undefined)}
        >
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
        </EditForm>
      </TeammateDialog>
      {/* A stopped feed comes back with the page: every conversation's feed reopens on load. */}
      <ConnectionBanner feed={{ state: connection }} onRetry={() => window.location.reload()} />
      {panel === "fire" ? (
        <div
          role="group"
          aria-label={`Fire ${displayName(worker)}?`}
          className="flex items-center gap-3 border-b border-border bg-(--redbg) px-6 py-2 text-sm"
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              keepWorker();
            }
          }}
        >
          <span className="min-w-0 flex-1">Fire {displayName(worker)}? It leaves your roster; this conversation stays readable.</span>
          <button type="button" onClick={() => void onFire()} className={cn(HEADER_BUTTON, "border-border-strong text-destructive")}>
            Fire
          </button>
          <button ref={keep} type="button" onClick={keepWorker} className={cn(HEADER_BUTTON, "border-border-strong")}>
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
            {/* One keyed list, so a card stays mounted (and keeps your draft) when a new line moves it. */}
            {lines.flatMap((line, i) => [
              ...waiting.filter((w) => w.at === i).map(card),
              <Fragment key={line.id}>
                {days.get(line.id) === undefined ? null : <Divider label={days.get(line.id)!} data-day="" />}
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
              </Fragment>,
            ]).concat(waiting.filter((w) => w.at === lines.length).map(card))}
            {answering ? (
              <div role="status" data-chat-activity className={cn("w-fit rounded-lg border px-3 py-2 text-xs", step?.needsYou && !stale ? "border-transparent bg-attention text-attention-foreground" : cn("border-border bg-card", step?.tone ?? "text-muted-foreground"), stale && STALE_CLASS)}>
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
        // The lab's default coder, where Lead starts coding work; the teammate's own model when it has one set (in Edit teammate), else the lab's.
        defaultHarness={context?.harness}
        replyModel={model}
        onSend={(text, attachments) => {
          // Your own line takes you to the end, wherever you had scrolled to.
          feed.sent();
          return calls.send(sessionId, text, attachments);
        }}
      />
    </main>
  );
}

/** When a line was written: its item's time, or its first step's; `undefined` when it carries none. */
function lineTime(line: ItemLine): number | undefined {
  const ts = line.kind === "steps" ? line.items[0]?.ts : "item" in line ? line.item.ts : undefined;
  return typeof ts === "number" && Number.isFinite(ts) && ts > 0 ? ts : undefined;
}

/** The lines that start a day, by id, with the day's label: the first timed line of each day. */
function dayBreaks(lines: readonly ItemLine[], now: number = Date.now()): Map<string, string> {
  const breaks = new Map<string, string>();
  let last: string | undefined;
  for (const line of lines) {
    const ts = lineTime(line);
    if (ts === undefined) continue;
    const day = new Date(ts).toDateString();
    if (day !== last) breaks.set(line.id, dayLabel(ts, now));
    last = day;
  }
  return breaks;
}

/** No answers given yet: one object, so the cards' read doesn't change for a new empty one. */
const NONE_ANSWERED: Readonly<Record<string, Answered>> = {};

/** A card's hold you answered here: the line it keeps, and where it stood. */
type Answered = { line: string; openedAt: number; task: CodingBoardTask };

/** One card in the conversation: the task, its open hold (none once answered), when it was asked, and the line index it is drawn before. */
type Waiting = { key: string; task: CodingBoardTask; hold: InboxHold | undefined; openedAt: number; at: number };

/**
 * The cards the conversation draws for what its tasks wait on you for: each
 * open hold of each running task, and each hold answered here, drawn before the
 * first line written after it was asked (at the end when none was).
 */
function waitingCards(tasks: readonly CodingBoardTask[], answers: Readonly<Record<string, Answered>>, lines: readonly ItemLine[]): Waiting[] {
  const open = tasks.flatMap((task) =>
    taskStatus(task) === "running" ? task.asks.map((hold) => ({ key: `${task.id}:${hold.id}`, task, hold: hold as InboxHold, openedAt: hold.openedAt })) : [],
  );
  const done = Object.entries(answers)
    .filter(([key]) => !open.some((w) => w.key === key))
    .map(([key, a]) => ({ key, task: a.task, hold: undefined, openedAt: a.openedAt }));
  return [...open, ...done]
    .map((w) => {
      const at = lines.findIndex((line) => (lineTime(line) ?? 0) > w.openedAt);
      return { ...w, at: at < 0 ? lines.length : at };
    })
    .sort((a, b) => a.openedAt - b.openedAt);
}
