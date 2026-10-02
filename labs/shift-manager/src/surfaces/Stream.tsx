/**
 * A workstream's Stream (S7, BR-18 to BR-21): its channel's transcript, one
 * live stream for that session, older lines paged in; beside it, the pending
 * asks of the channel's member seats; and a composer that posts through the
 * channel's own `post` action.
 *
 * A line is drawn only once the channel holds it: a post keeps its draft
 * until the request settles, then the line arrives from the stream or the
 * read after it. A refused post keeps the draft and says why.
 *
 * A line that starts with `@` and a member's name goes to that worker instead
 * (BR-19, BR-20): into its task's run on this workstream's boards, through
 * the one send path, and nothing is posted to the channel. Several tasks and
 * the composer asks which; none and Send is off, saying so. A delivered line
 * leaves a receipt in the stream, linking to the task's Session, until the
 * page reloads.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createSessionSSEClient } from "@flow-state-dev/client";
import type { ChannelTranscriptLine } from "@flow-state-dev/workforce/browser";
import { AskCard } from "../components/AskCard";
import { EmptyState, SectionFailure } from "../components/ui";
import { addressedSeat, asksFor, doorOf, messageableRows, rosterOf, type LoadedSnapshot } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import { describeFailure, type BoardRow, type Failure, type Workstream } from "../lib/reads";
import { navigate } from "../lib/routes";
import { resolveRunFlow } from "../lib/run";
import { sendTurn, TurnNotDelivered } from "../lib/send";
import { TurnSendStatus, useTurnSend } from "../components/TurnComposer";
import { lineLabel, lineOf, mergeLines, postLine, readTranscriptPage } from "../lib/transcript";
import type { Gaps } from "../gaps";

type Transcript = { lines: ChannelTranscriptLine[]; offset: number };

export function Stream({ workstream, snapshot, gaps }: { workstream: Workstream; snapshot: LoadedSnapshot; gaps: Gaps }) {
  const { clients, refresh } = useLab();
  const [transcript, setTranscript] = useState<Transcript | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);

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
          await sendTurn(clients, { sessionId: link.sessionId, flowId, door }, message);
          setReceipts((held) => [...held, { id: held.length, row }]);
        },
      };
    },
    [clients, gaps, snapshot, workstream],
  );

  return (
    <div className="flex min-h-0 flex-1" data-testid="stream">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto" data-testid="transcript">
          {failure !== undefined ? (
            <div className="p-4">
              <SectionFailure what="The transcript" failure={failure} onRetry={() => setAttempt((a) => a + 1)} />
            </div>
          ) : transcript === undefined ? (
            <p className="p-4 text-sm text-muted-foreground">Reading the transcript…</p>
          ) : (
            <ol className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4">
              {transcript.offset > 0 ? (
                <li>
                  <button type="button" className="text-xs underline" onClick={() => void loadOlder()} data-testid="load-older">
                    Load older lines
                  </button>
                </li>
              ) : null}
              <TranscriptLines lines={transcript.lines} />
              {transcript.lines.length === 0 ? (
                <li className="py-6 text-center text-sm text-muted-foreground">Nothing has been posted here yet.</li>
              ) : null}
              {receipts.map((receipt) => (
                <li key={`receipt-${receipt.id}`} className="text-xs text-muted-foreground" data-testid="turn-receipt" data-task-id={receipt.row.id}>
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
          )}
        </div>
        <Composer
          key={workstream.id}
          addressing={addressing}
          send={(body) => {
            // A channel row written before it recorded its kind names no flow to post through.
            if (workstream.kind === null) throw new Error("This channel's inventory row names no flow kind, so there is no post action to send through.");
            return postLine(clients, { id: workstream.id, kind: workstream.kind }, body);
          }}
          onKept={afterPost}
        />
      </div>
      <aside className="w-80 shrink-0 overflow-y-auto border-l p-3" data-testid="stream-asks" aria-label="Waiting on you">
        <h3 className="pb-2 text-[11px] font-semibold tracking-wider text-muted-foreground">WAITING ON YOU</h3>
        {!snapshot.asks.ok ? (
          <SectionFailure what="Asks" failure={snapshot.asks.failure} onRetry={() => void refresh()} />
        ) : asks.length === 0 ? (
          <EmptyState title="Nothing waiting" testId="stream-asks-empty">
            No member of this workstream is waiting on you.
          </EmptyState>
        ) : (
          <div className="space-y-3">
            {asks.map((ask) => (
              <div key={ask.item.suspensionId}>
                <p className="text-xs text-muted-foreground">{ask.seatId} asks</p>
                <AskCard ask={ask} />
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}

/**
 * The lines of a transcript, oldest first: who wrote each, then its words.
 * A workstream's Stream and a project's draw lines with this one list.
 */
export function TranscriptLines({ lines }: { lines: readonly ChannelTranscriptLine[] }) {
  return (
    <>
      {lines.map((line) => (
        <li key={line.id} className="flex flex-col gap-0.5" data-testid="transcript-line" data-line-id={line.id}>
          <span className="text-xs font-medium text-muted-foreground">{lineLabel(line)}</span>
          <span className="whitespace-pre-wrap text-sm" data-testid="transcript-line-body">
            {line.body}
          </span>
        </li>
      ))}
    </>
  );
}

/** Where an `@name` line goes: nowhere, and why; or one of the worker's tasks. */
type Addressing =
  | { blocked: string }
  | { blocked: null; rows: BoardRow[]; send: (row: BoardRow, message: string) => Promise<void> };

/** `@name rest` → the name and the line, or `undefined` for a line to the channel. */
function parseAddress(draft: string): { name: string; message: string } | undefined {
  const match = /^\s*@(\S*)\s*([\s\S]*)$/.exec(draft);
  return match === null ? undefined : { name: match[1]!, message: match[2]!.trim() };
}

/**
 * The composer: posts to the whole channel, keeps its draft until the channel
 * keeps the line. A line to `@name` goes to that worker's task instead, with
 * the send state every turn composer shares ({@link useTurnSend}): delivered
 * only once the run's session holds it (BR-4).
 */
export function Composer({
  send,
  onKept,
  addressing,
  label = "Post to this workstream",
  placeholder = "Post a line to this workstream, or @worker to message one…",
}: {
  send: (body: string) => Promise<void>;
  onKept: () => Promise<void>;
  /** Where an `@name` line goes. Absent: every line, `@` or not, is a post. */
  addressing?: (name: string) => Addressing;
  label?: string;
  placeholder?: string;
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
    if (address !== undefined) {
      const to = target as Extract<Addressing, { blocked: null }>;
      setPostError(null);
      if (await turn.run(() => to.send(row!, address.message))) {
        setDraft("");
        setChosen("");
      }
      return;
    }
    setPosting(true);
    setPostError(null);
    turn.clear();
    try {
      await send(draft.trim());
      if (!mounted.current) return;
      setDraft("");
      await onKept();
    } catch (err) {
      if (mounted.current) setPostError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setPosting(false);
    }
  };

  const state = blocked !== null ? "blocked" : posting ? "sending" : turn.state.kind;
  return (
    <form onSubmit={(e) => void submit(e)} className="border-t p-3" data-testid="composer">
      <label className="sr-only" htmlFor="composer-input">
        {label}
      </label>
      <textarea
        id="composer-input"
        data-testid="composer-input"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          turn.reset();
        }}
        rows={2}
        placeholder={placeholder}
        className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e);
        }}
      />
      {rows.length > 1 ? (
        <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          Which task?
          <select
            value={chosen}
            onChange={(e) => setChosen(e.target.value)}
            data-testid="composer-task-picker"
            className="rounded-md border bg-background px-2 py-1 text-xs"
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
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" data-testid="composer-status" data-state={state}>
          {blocked !== null ? (
            blocked
          ) : posting ? (
            "Posting… the line appears once it is kept."
          ) : postError !== null ? (
            <span role="alert" className="text-destructive" data-testid="composer-error">
              {postError}
            </span>
          ) : (
            <TurnSendStatus state={turn.state} testId="composer" onRetry={() => void submit()} />
          )}
        </p>
        <button
          type="submit"
          disabled={!canSend}
          data-testid="composer-send"
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        >
          {address === undefined ? "Post" : "Send"}
        </button>
      </div>
    </form>
  );
}
