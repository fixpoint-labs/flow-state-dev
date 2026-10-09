"use client";

/**
 * A coordinator's or a seat's session, opened from the rail, with a composer
 * that talks to it.
 *
 * Every composer here calls an action the picked flow already declares, on the
 * picked session's own address — nothing is added for the page. A coordinator
 * is posted to through its door (`COORDINATOR_ASK`), with the post only: who
 * posted is the session's own user. A seat is sent the action its kind
 * answers with (`SEAT_ASKS`); a kind with none shows its reason and no
 * composer.
 *
 * A coordinator's panel shows its lines: the person's posts, under the
 * person's name, and each delegate's answer, under the delegate's. It reads
 * the session's kept messages and nothing else: the routing records beside
 * them are bookkeeping, not lines. Only what the server kept is drawn. There
 * is no optimistic copy of the person's line or message, so what shows after
 * a reload is what showed before it.
 *
 * Both panels show a `<worker> is working` row for each run under the session
 * that hasn't finished: on a coordinator, each delegate still working on a
 * post it was handed. With the session followed live (`useSession`'s
 * `live`), an answer lands and its row clears without a reload; the panel
 * keeps no timer or poll of its own for either. When the list could not be
 * read again, the rows it still has say `was working at the last check`.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { useSession } from "@flow-state-dev/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { COORDINATOR_ASK, delegateOfRun, isCoordinatorKind, seatAskFor } from "@/lib/workforce-shell";

type Session = ReturnType<typeof useSession>;

/** Reads one request's own status from the server, by id. */
export type RequestStatusLookup = (requestId: string) => Promise<string>;

/** One line of a coordinator's conversation: who wrote it, and what it says. */
interface CoordinatorLine {
  id: string;
  /** A delegate's worker id, the person's id, or, for the coordinator's own word, the coordinator. */
  label: string;
  body: string;
}

/**
 * The conversation's kept messages as lines, in the order the session holds
 * them. A delegate's answer carries its name (`agentName`); the person's post
 * is a `user` message, under `person`; anything else the coordinator said
 * itself is under `coordinator`. Transient messages are not lines.
 *
 * @param items The session's items.
 * @param person The name the person's own posts are drawn under.
 */
function coordinatorLines(items: Session["items"], person: string): CoordinatorLine[] {
  return items.flatMap((item) => {
    const message = item as {
      type: string;
      id?: string;
      role?: string;
      agentName?: string;
      transient?: boolean;
      content?: Array<{ text?: string }>;
    };
    if (message.type !== "message" || message.transient === true || typeof message.id !== "string") return [];
    const body = (message.content ?? []).map((part) => part.text ?? "").join("");
    const label = message.agentName ?? (message.role === "user" ? person : "coordinator");
    return [{ id: message.id, label, body }];
  });
}

/**
 * The picked session's panel.
 *
 * @param session The picked session, as `useSession` returns it.
 * @param kind The picked flow's kind: a coordinator kind or a seat kind.
 * @param person The name the person's own posts are drawn under, on a coordinator.
 * @param requestStatus Reads a sent request's own status, so a send settles
 *   on its request and not on whatever the session's stream did.
 * @param conversation The session's item stream, drawn for a seat. A
 *   coordinator draws its lines instead, so the page need not build one for it.
 */
export function PickedSessionPanel({
  session,
  kind,
  person,
  requestStatus,
  conversation,
}: {
  session: Session;
  kind: string;
  person: string;
  requestStatus: RequestStatusLookup;
  conversation?: ReactNode;
}) {
  // Each composer is keyed by the session it talks to, so a draft, a pending
  // send or a failure never carries over to the next pick.
  const composerKey = session.sessionId ?? "none";
  if (isCoordinatorKind(kind)) {
    return (
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden" data-testid="picked-session">
        <CoordinatorTranscript session={session} person={person} />
        <WorkingRows session={session} />
        <Composer
          key={composerKey}
          session={session}
          requestStatus={requestStatus}
          label="Post to this coordinator"
          placeholder="Write a post for the team…"
          send={(text) => session.sendAction(COORDINATOR_ASK.action, { [COORDINATOR_ASK.field]: text })}
        />
      </section>
    );
  }

  const ask = seatAskFor(kind);
  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden" data-testid="picked-session">
      {conversation}
      <WorkingRows session={session} />
      {ask === undefined || "none" in ask ? (
        <p className="border-t px-4 py-3 text-xs text-muted-foreground" data-testid="picked-read-only">
          {ask?.none ?? `This ${kind} seat takes no messages from this page.`}
        </p>
      ) : (
        <Composer
          key={composerKey}
          session={session}
          requestStatus={requestStatus}
          label="Message this seat"
          placeholder="Write to this seat…"
          send={(text) => session.sendAction(ask.action, { [ask.field]: text })}
        />
      )}
    </section>
  );
}

/** A coordinator's conversation, oldest first, each line under who wrote it. */
function CoordinatorTranscript({ session, person }: { session: Session; person: string }) {
  const lines = useMemo(() => coordinatorLines(session.items, person), [session.items, person]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="coordinator-transcript">
      <ol className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-3 py-4 sm:px-4">
        {lines.map((line) => (
          <li key={line.id} className="flex flex-col gap-0.5" data-testid="coordinator-line">
            <span className="text-xs font-medium text-muted-foreground" data-testid="coordinator-line-label">
              {line.label}
            </span>
            <span className="whitespace-pre-wrap text-sm" data-testid="coordinator-line-body">
              {line.body}
            </span>
          </li>
        ))}
      </ol>
      {lines.length === 0 && !session.isLoading && (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing has been posted here yet.</p>
      )}
    </div>
  );
}

/**
 * One row per run under the session that hasn't finished, named by the
 * delegate a coordinator handed a post to, or else by the run's flow; a run
 * with no recorded flow is background work, not a seat. A run waiting on an
 * approval reads as working until it ends.
 *
 * While the list is stale (`childSessionsStale`: the last re-read failed, and
 * the rows are the last list the hook had), a row says the run was working at
 * the last check, since it may have finished since.
 */
function WorkingRows({ session }: { session: Session }) {
  const working = session.childSessions.filter((run) => run.status === "active");
  if (working.length === 0) return null;
  const stale = session.childSessionsStale;
  return (
    <ul className="mx-auto flex w-full max-w-3xl flex-col gap-1 px-3 pb-2 sm:px-4" data-testid="working-rows">
      {working.map((run) => (
        <li key={run.id} className="text-xs italic text-muted-foreground" data-testid="working-row">
          {run.flowId === undefined
            ? `Background work ${stale ? "was running at the last check" : "is running"}`
            : `${delegateOfRun(run) ?? run.flowId} ${stale ? "was working at the last check" : "is working"}`}
        </li>
      ))}
    </ul>
  );
}

/**
 * The composer. The text stays until the server has taken it: a send that
 * fails, at the door or in the request, shows why and keeps the text.
 */
function Composer({
  session,
  requestStatus,
  label,
  placeholder,
  send,
}: {
  session: Session;
  requestStatus: RequestStatusLookup;
  label: string;
  placeholder: string;
  send: (text: string) => Promise<{ request: { id: string } }>;
}) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const items = useRef(session.items);
  items.current = session.items;
  const errorFor = (requestId: string) =>
    items.current.find((item) => item.type === "error" && item.requestId === requestId) as
      | { message?: string }
      | undefined;

  // A send is settled by its own request, never by the session at large:
  // another stream on this session closing says nothing about this one. An
  // error item on it is a failure. Once the stream has closed, the request's
  // own record decides: `completed` (or `suspended`, waiting on someone) is
  // the server keeping it and clears the text; any other end is a failure;
  // still running means some other stream closed, so ask again shortly. A
  // send the page loses track of (the stream dropped and the watchdog gave
  // up) keeps its text and says so, since nothing confirmed it.
  useEffect(() => {
    if (pending === null) return;
    const error = errorFor(pending);
    if (error !== undefined) {
      setFailure(error.message ?? "The request failed.");
      setPending(null);
      return;
    }
    if (session.isStuck) {
      setFailure("The page lost this send before the server confirmed it. Your text is kept.");
      setPending(null);
      return;
    }
    if (session.isStreaming) return;

    let cancelled = false;
    void (async () => {
      while (!cancelled) {
        const status = await requestStatus(pending).catch(() => "in_progress");
        if (cancelled) return;
        if (status === "completed" || status === "suspended") {
          setDraft("");
          setPending(null);
          return;
        }
        if (status !== "in_progress") {
          setFailure(errorFor(pending)?.message ?? `The request ended ${status}.`);
          setPending(null);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pending, session.items, session.isStreaming, session.isStuck, requestStatus]);

  const text = draft.trim();
  const busy = pending !== null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (text.length === 0 || busy) return;
    setFailure(null);
    try {
      const response = await send(text);
      setPending(response.request.id);
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return (
    <form className="border-t px-3 py-3 sm:px-4" onSubmit={(event) => void submit(event)} data-testid="picked-composer">
      <div className="mx-auto flex max-w-3xl flex-col gap-2">
        {failure !== null && (
          <p role="alert" className="text-sm text-destructive" data-testid="picked-composer-error">
            {failure}
          </p>
        )}
        <div className="flex items-end gap-2">
          <Textarea
            aria-label={label}
            placeholder={placeholder}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
            disabled={busy}
            rows={2}
            className="min-h-0 flex-1 resize-none"
          />
          <Button type="submit" disabled={text.length === 0 || busy}>
            Send
          </Button>
        </div>
      </div>
    </form>
  );
}
