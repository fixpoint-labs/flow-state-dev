/**
 * A workstream's Stream (S7, BR-18 to BR-21): its mailbox's transcript, one
 * live stream for that session, older lines paged in; the pending asks of the
 * mailbox's member seats in the same feed, each at the time it was raised; and
 * a composer that posts through the mailbox's own `post` action.
 *
 * A line is drawn only once the mailbox holds it: a post keeps its draft
 * until the request settles, then the line arrives from the stream or the
 * read after it. A refused post keeps the draft and says why.
 *
 * A line that starts with `@` and a member's name goes to that worker instead
 * (BR-19, BR-20): into its task's run on this workstream's boards, through
 * the one send path, and nothing is posted to the mailbox. Several tasks and
 * the composer asks which; none and Send is off, saying so. A delivered line
 * leaves a receipt in the stream, linking to the task's Session, until the
 * page reloads.
 *
 * The composer is v2's (v2:305-309), drawn through the shared
 * {@link ComposerShell}: one line over a mono footer that offers `@` for each
 * member running a task here (by its id when two members share a name) and ⏎.
 */
import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createSessionSSEClient } from "@flow-state-dev/client";
import type { MailboxTranscriptLine } from "@flow-state-dev/workforce/browser";
import { AskCard } from "../components/AskCard";
import { SectionFailure } from "../components/ui";
import { addressedSeat, asksFor, doorOf, liveWorkers, mentionOf, messageableRows, rosterOf, type LoadedSnapshot } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import { describeFailure, type Ask, type BoardRow, type Failure, type Workstream } from "../lib/reads";
import { useFollowLatest } from "../lib/follow";
import { navigate } from "../lib/routes";
import { resolveRunFlow } from "../lib/run";
import { sendTurn, TurnNotDelivered, type TurnStop } from "../lib/send";
import { ComposerShell, TurnSendStatus, useTurnSend } from "../components/TurnComposer";
import { lineLabel, lineOf, mergeLines, postLine, readTranscriptPage } from "../lib/transcript";
import type { Gaps } from "../gaps";

type Transcript = { lines: MailboxTranscriptLine[]; offset: number };

export function Stream({ workstream, snapshot, gaps }: { workstream: Workstream; snapshot: LoadedSnapshot; gaps: Gaps }) {
  const { clients, refresh } = useLab();
  const [transcript, setTranscript] = useState<Transcript | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const feed = useFollowLatest();

  // The newest page, then one live stream for this session, closed on leave.
  useEffect(() => {
    let closed = false;
    let stream: { close(): void } | undefined;
    setTranscript(undefined);
    setFailure(undefined);
    readTranscriptPage(clients, workstream.id)
      .then((page) => {
        if (closed) return;
        setTranscript({ lines: page.lines, offset: page.offset });
        stream = createSessionSSEClient({
          sessionId: workstream.id,
          fetcher: clients.fetcher,
          ...(clients.baseUrl === undefined ? {} : { baseUrl: clients.baseUrl }),
          ...(page.at === undefined ? {} : { since: page.at }),
          ...(page.sessionCreatedAt === undefined ? {} : { sessionCreatedAt: page.sessionCreatedAt }),
          itemTypes: ["component"],
          onItem: (event) => {
            const line = lineOf(event.item);
            if (line !== undefined) setTranscript((t) => (t === undefined ? t : { ...t, lines: mergeLines(t.lines, [line]) }));
          },
        });
      })
      .catch((error: unknown) => {
        if (!closed) setFailure(describeFailure(error));
      });
    return () => {
      closed = true;
      stream?.close();
    };
  }, [clients, workstream.id, attempt]);

  const loadOlder = useCallback(async () => {
    if (transcript === undefined || transcript.offset === 0) return;
    try {
      const page = await readTranscriptPage(clients, workstream.id, transcript.offset);
      setTranscript((t) => (t === undefined ? t : { lines: mergeLines(page.lines, t.lines), offset: page.offset }));
    } catch (error) {
      setFailure(describeFailure(error));
    }
  }, [clients, transcript, workstream.id]);

  /** After a kept post, read the newest page too, so the line shows even when the stream is down. */
  const afterPost = useCallback(async () => {
    const page = await readTranscriptPage(clients, workstream.id);
    setTranscript((t) => ({ lines: mergeLines(t?.lines ?? [], page.lines), offset: Math.min(t?.offset ?? page.offset, page.offset) }));
  }, [clients, workstream.id]);

  const asks = snapshot.asks.ok ? asksFor(workstream, snapshot.asks.value) : [];
  const [receipts, setReceipts] = useState<Array<{ id: number; row: BoardRow }>>([]);

  /** Where an `@name` line goes, worked out from the snapshot this screen drew. */
  const addressing = useCallback(
    (name: string): Addressing => {
      const roster = rosterOf(snapshot);
      const seat = addressedSeat(roster, workstream, name);
      if (seat === undefined) return { blocked: `@${name} ${gaps.turn.noWorker}` };
      const boards = snapshot.boards[workstream.id];
      if (boards !== undefined && !boards.ok) return { blocked: boards.failure.message };
      const rows = messageableRows(roster, boards?.value.rows ?? [], seat);
      if (rows.length === 0) return { blocked: `${seat.id} ${gaps.turn.noTask}` };
      return {
        blocked: null,
        rows,
        send: async (row, message) => {
          const link = row.run;
          if (link === null) throw new TurnNotDelivered("refused", gaps.turn.notStarted);
          const flowId = await resolveRunFlow(clients, link.sessionId).catch((error: unknown) => {
            throw new TurnNotDelivered("not-sent", describeFailure(error).message);
          });
          const door = doorOf(roster.seats, flowId);
          if (door === null) throw new TurnNotDelivered("refused", `${seat.id} ${gaps.turn.noDoor}`);
          const sent = await sendTurn(clients, { sessionId: link.sessionId, flowId, door }, message);
          setReceipts((held) => [...held, { id: held.length, row }]);
          // It stopped short, maybe on a new ask: read the Lab again so this Stream and Inbox list whatever it raised.
          if (sent.suspended) void refresh();
          return sent;
        },
      };
    },
    [clients, gaps, refresh, snapshot, workstream],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="stream">
      <div ref={feed.ref} className="min-h-0 flex-1 overflow-y-auto" data-testid="transcript">
        {failure !== undefined ? (
          <div className="p-4">
            <SectionFailure what="The transcript" failure={failure} onRetry={() => setAttempt((a) => a + 1)} />
          </div>
        ) : transcript === undefined ? (
          <p className="p-4 text-sm text-muted-foreground">Reading the transcript…</p>
        ) : null}
        {snapshot.asks.ok ? null : (
          <div className="p-4">
            <SectionFailure what="Asks" failure={snapshot.asks.failure} onRetry={() => void refresh()} testId="stream-asks-failure" />
          </div>
        )}
        <ol className="flex w-full flex-col gap-0.5 px-3.5 py-2">
          {transcript !== undefined && transcript.offset > 0 ? (
            <li className="px-2">
              <button type="button" className="text-xs underline" onClick={() => void loadOlder()} data-testid="load-older">
                Load older lines
              </button>
            </li>
          ) : null}
          {transcript === undefined && failure === undefined ? null : <TranscriptLines lines={transcript?.lines ?? []} asks={asks} />}
          {transcript !== undefined && transcript.lines.length === 0 && asks.length === 0 ? (
            <li className="py-6 text-center text-sm text-muted-foreground" data-testid="feed-empty">
              Nothing has been posted here yet.
            </li>
          ) : null}
          {receipts.map((receipt) => (
            <li key={`receipt-${receipt.id}`} className="px-2 text-xs text-muted-foreground" data-testid="turn-receipt" data-task-id={receipt.row.id}>
              sent into{" "}
              <button
                type="button"
                className="underline"
                onClick={() => navigate({ level: "task", boardRef: receipt.row.boardRef, taskId: receipt.row.id, tab: "session" })}
              >
                {receipt.row.title}
              </button>
            </li>
          ))}
        </ol>
      </div>
      <Composer
        key={workstream.id}
        addressing={addressing}
        mentions={liveWorkers(snapshot, workstream).map((seat) => mentionOf(rosterOf(snapshot), workstream, seat))}
        send={(body) => {
          // A mailbox row written before it recorded its kind names no flow to post through.
          if (workstream.kind === null) throw new Error("This mailbox's inventory row names no flow kind, so there is no post action to send through.");
          return postLine(clients, { id: workstream.id, kind: workstream.kind }, body);
        }}
        onKept={afterPost}
      />
    </div>
  );
}

/** One entry in the feed: a line the mailbox kept, or a member's ask still waiting on the person. */
type FeedEntry = { at: number; line: MailboxTranscriptLine } | { at: number; ask: Ask };

/**
 * The feed as design v2 draws it (v2:225-232): lines and pending asks in time
 * order, under a divider per day, TODAY for today's.
 */
function feedOf(lines: readonly MailboxTranscriptLine[], asks: readonly Ask[], now: number): Array<{ label: string; entries: FeedEntry[] }> {
  const entries: FeedEntry[] = [...lines.map((line) => ({ at: line.at, line })), ...asks.map((ask) => ({ at: ask.since, ask }))].sort((a, b) => a.at - b.at);
  const today = new Date(now).toDateString();
  const days: Array<{ label: string; entries: FeedEntry[] }> = [];
  for (const entry of entries) {
    const day = new Date(entry.at);
    const label = day.toDateString() === today ? "TODAY" : day.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }).toUpperCase();
    if (days.at(-1)?.label !== label) days.push({ label, entries: [] });
    days.at(-1)!.entries.push(entry);
  }
  return days;
}

/**
 * The lines of a transcript as design v2 draws them, oldest first: who wrote
 * each, then its words, under a divider per day. A workstream's Stream and a
 * project's draw lines with this one list; a workstream's also passes its
 * members' pending asks, each placed at the time it was raised.
 */
export function TranscriptLines({ lines, asks = [] }: { lines: readonly MailboxTranscriptLine[]; asks?: readonly Ask[] }) {
  return (
    <>
      {feedOf(lines, asks, Date.now()).map((day) => (
        <Fragment key={day.label}>
          <li className="flex items-center gap-2.5 px-2 pt-2 pb-1" data-look="day-divider" aria-label={day.label}>
            <span className="font-mono text-[10.5px] font-medium tracking-[0.14em] text-muted-foreground">{day.label}</span>
            <span className="h-px flex-1 bg-foreground/[0.14]" data-look="day-rule" />
          </li>
          {day.entries.map((entry) =>
            "line" in entry ? (
              <li key={entry.line.id} className="px-2 py-2.5" data-testid="transcript-line" data-line-id={entry.line.id}>
                <span className="text-[13.5px] font-semibold" data-look="feed-name">
                  {lineLabel(entry.line)}
                </span>
                <span className="mt-0.5 block whitespace-pre-wrap text-sm leading-[1.55]" data-testid="transcript-line-body">
                  {entry.line.body}
                </span>
              </li>
            ) : (
              <FeedAsk key={entry.ask.item.suspensionId} ask={entry.ask} />
            ),
          )}
        </Fragment>
      ))}
    </>
  );
}

/**
 * A member's pending ask, in the feed at the time it was raised (v2:229-298):
 * the seat, the highlighter's NEEDS YOU (the ask waits on the person, and only
 * while it does), the one ask card Inbox draws too, and a way to it in Inbox.
 * Answering it here clears it from Inbox: both read the same pending asks.
 */
function FeedAsk({ ask }: { ask: Ask }) {
  return (
    <li className="px-2 py-2.5" data-testid="feed-ask" data-suspension-id={ask.item.suspensionId}>
      <div className="flex items-baseline gap-2">
        <span className="text-[13.5px] font-semibold" data-look="feed-name">
          {ask.seatId ?? "A worker"}
        </span>
        <span className="bg-attention px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-[0.12em] text-attention-foreground" data-look="needs-tag">
          NEEDS YOU
        </span>
      </div>
      <div className="mt-1.5 max-w-[580px]">
        <AskCard ask={ask} />
      </div>
      <button
        type="button"
        className="mt-1 font-mono text-xs font-medium text-muted-foreground hover:text-info"
        onClick={() => navigate({ level: "inbox", suspensionId: ask.item.suspensionId })}
        data-testid="feed-ask-inbox"
      >
        in inbox ↗
      </button>
    </li>
  );
}

/** Where an `@name` line goes: nowhere, and why; or one of the worker's tasks. */
/** Where an `@name` line goes, or why it can't. */
export type Addressing =
  | { blocked: string }
  | { blocked: null; rows: BoardRow[]; send: (row: BoardRow, message: string) => Promise<{ suspended: boolean; stopped: TurnStop }> };

/** `@name rest` → the name and the line, or `undefined` for a line to the mailbox. */
function parseAddress(draft: string): { name: string; message: string } | undefined {
  const match = /^\s*@(\S*)\s*([\s\S]*)$/.exec(draft);
  return match === null ? undefined : { name: match[1]!, message: match[2]!.trim() };
}

/**
 * The composer: posts to the whole mailbox, keeps its draft until the mailbox
 * keeps the line. A line to `@name` goes to that worker's task instead, with
 * the send state every turn composer shares ({@link useTurnSend}): delivered
 * only once the run's session holds it (BR-4). Exported for its tests.
 */
export function Composer({
  send,
  onKept,
  addressing,
  label = "Post to this workstream",
  placeholder = "Post a line to this workstream, or @worker to message one…",
  mentions = [],
}: {
  send: (body: string) => Promise<void>;
  onKept: () => Promise<void>;
  /** Where an `@name` line goes. Absent: every line, `@` or not, is a post. */
  addressing?: (name: string) => Addressing;
  label?: string;
  placeholder?: string;
  /** The names offered as `@name` in the footer: the members running a task here. Absent: none. */
  mentions?: readonly string[];
}) {
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const turn = useTurnSend();
  const [chosen, setChosen] = useState<string>("");
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);

  const address = addressing === undefined ? undefined : parseAddress(draft);
  const target = address === undefined ? undefined : addressing?.(address.name);
  const rows = target !== undefined && target.blocked === null ? target.rows : [];
  const row = rows.length === 1 ? rows[0] : rows.find((r) => r.id === chosen);
  const blocked =
    target === undefined
      ? null
      : target.blocked !== null
        ? target.blocked
        : row === undefined
          ? "This worker has several tasks here. Choose which one to message."
          : null;
  const busy = posting || turn.state.kind === "sending";
  const canSend =
    !busy &&
    blocked === null &&
    (address === undefined ? draft.trim().length > 0 : row !== undefined && address.message.length > 0);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!canSend) return;
    // What was sent. A send that finishes clears only this; a line typed since stays.
    const submitted = draft;
    const clearSent = () => setDraft((current) => (current === submitted ? "" : current));
    if (address !== undefined) {
      const to = target as Extract<Addressing, { blocked: null }>;
      setPostError(null);
      if (await turn.run(() => to.send(row!, address.message))) {
        clearSent();
        setChosen("");
      }
      return;
    }
    setPosting(true);
    setPostError(null);
    turn.clear();
    let sent = false;
    try {
      await send(submitted.trim());
      sent = true;
      // The draft goes only once the line is read back: a read that fails
      // leaves it here, with the reason.
      await onKept();
      if (mounted.current) clearSent();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (mounted.current) {
        setPostError(sent ? `Your line was posted, but reading it back failed: ${reason} Your draft is kept; check the conversation before sending it again.` : reason);
      }
    } finally {
      if (mounted.current) setPosting(false);
    }
  };

  const state = blocked !== null ? "blocked" : posting ? "sending" : turn.state.kind;
  return (
    <ComposerShell
      testId="composer"
      label={label}
      placeholder={placeholder}
      draft={draft}
      onDraft={(next) => {
        setDraft(next);
        turn.reset();
      }}
      canSend={canSend}
      onSubmit={(e) => void submit(e)}
      sendLabel={address === undefined ? "Post" : "Send"}
      statusState={state}
      status={
        blocked !== null ? (
          blocked
        ) : posting ? (
          "Posting… the line appears once it is kept."
        ) : postError !== null ? (
          <span role="alert" className="text-destructive" data-testid="composer-error">
            {postError}
          </span>
        ) : (
          <TurnSendStatus state={turn.state} testId="composer" onRetry={() => void submit()} />
        )
      }
      lead={
        <>
          {mentions.map((name) => (
            <button
              key={name}
              type="button"
              className="hover:text-info"
              onClick={() => {
                setDraft(`@${name} `);
                turn.reset();
              }}
              data-testid="composer-mention"
              data-name={name}
            >
              @{name}
            </button>
          ))}
          {rows.length > 1 ? (
            <label className="flex items-center gap-2">
              Which task?
              <select
                value={chosen}
                onChange={(e) => setChosen(e.target.value)}
                data-testid="composer-task-picker"
                className="border bg-background px-2 py-0.5"
              >
                <option value="">Choose a task…</option>
                {rows.map((r) => (
                  <option key={`${r.boardRef}/${r.id}`} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </>
      }
    />
  );
}
