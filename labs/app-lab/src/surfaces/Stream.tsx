/**
 * A workstream's Stream (S7, BR-18 to BR-21): its channel's transcript, one
 * live stream for that session, older lines paged in; beside it, the pending
 * asks of the channel's member seats; and a composer that posts through the
 * channel's own `post` action.
 *
 * A line is drawn only once the channel holds it: a post keeps its draft
 * until the request settles, then the line arrives from the stream or the
 * read after it. A refused post keeps the draft and says why.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { createSessionSSEClient } from "@flow-state-dev/client";
import type { ChannelTranscriptLine } from "@flow-state-dev/workforce/browser";
import { AskCard } from "../components/AskCard";
import { EmptyState, SectionFailure } from "../components/ui";
import { asksFor, type LoadedSnapshot } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import { describeFailure, type Failure, type Workstream } from "../lib/reads";
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
              {transcript.lines.map((line) => (
                <li key={line.id} className="flex flex-col gap-0.5" data-testid="transcript-line" data-line-id={line.id}>
                  <span className="text-xs font-medium text-muted-foreground">{lineLabel(line)}</span>
                  <span className="whitespace-pre-wrap text-sm" data-testid="transcript-line-body">
                    {line.body}
                  </span>
                </li>
              ))}
              {transcript.lines.length === 0 ? (
                <li className="py-6 text-center text-sm text-muted-foreground">Nothing has been posted here yet.</li>
              ) : null}
            </ol>
          )}
        </div>
        <Composer
          key={workstream.id}
          addressWorkerGap={gaps.addressWorker}
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

/** The composer: posts to the whole channel, keeps its draft until the channel keeps the line. */
function Composer({
  send,
  onKept,
  addressWorkerGap,
}: {
  send: (body: string) => Promise<void>;
  onKept: () => Promise<void>;
  addressWorkerGap: string;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => () => void (mounted.current = false), []);

  const addressesWorker = /^\s*@/.test(draft);
  const canSend = draft.trim().length > 0 && !sending && !addressesWorker;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      await send(draft.trim());
      if (!mounted.current) return;
      setDraft("");
      await onKept();
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mounted.current) setSending(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="border-t p-3" data-testid="composer">
      <label className="sr-only" htmlFor="composer-input">
        Post to this workstream
      </label>
      <textarea
        id="composer-input"
        data-testid="composer-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        rows={2}
        placeholder="Post a line to this workstream…"
        className="w-full resize-none rounded-md border bg-background px-3 py-2 text-sm"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e);
        }}
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground" data-testid="composer-status">
          {addressesWorker ? addressWorkerGap : sending ? "Posting… the line appears once the channel keeps it." : null}
          {error === null ? null : (
            <span role="alert" className="text-destructive" data-testid="composer-error">
              {error}
            </span>
          )}
        </p>
        <button
          type="submit"
          disabled={!canSend}
          data-testid="composer-send"
          className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
        >
          Post
        </button>
      </div>
    </form>
  );
}
