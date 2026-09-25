"use client";

/**
 * A channel's or a seat's session, opened from the rail, with a composer that
 * talks to it.
 *
 * Every composer here calls an action the picked flow already declares, on the
 * picked session's own address — nothing is added for the page. A channel is
 * posted to through its own `post`, with the body only: the person at the page
 * is not a member, so naming them as `author` would be refused, and the line's
 * server-set `principal` already says who posted. A seat is sent the action
 * its kind answers with (`SEAT_ASKS`); a kind with none shows its reason and
 * no composer.
 *
 * A channel's panel shows its transcript, which is its `channel-post` items,
 * not the session's item stream: a post leaves nothing else worth reading.
 * Only what the server kept is drawn. There is no optimistic copy of the
 * person's line or message, so what shows after a reload is what showed
 * before it.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { useSession } from "@flow-state-dev/react";
import { CHANNEL_POST_COMPONENT } from "@flow-state-dev/workforce";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { CHANNEL_KINDS, seatAskFor } from "@/lib/workforce-shell";

type Session = ReturnType<typeof useSession>;

/** One channel line as its `channel-post` item carries it. */
type ChannelLine = { id: string; at?: number; author?: string; principal?: string; body: string };

/** Who a line names: its author claim, else the server's principal, else nobody. */
export function lineLabel(line: Pick<ChannelLine, "author" | "principal">): string {
  return line.author ?? line.principal ?? "unattributed";
}

/** The session's `channel-post` lines, in the order the session holds them. */
function channelLines(items: Session["items"]): ChannelLine[] {
  return items.flatMap((item) => {
    const component = item as { type: string; component?: string; data?: unknown };
    if (component.type !== "component" || component.component !== CHANNEL_POST_COMPONENT) return [];
    const data = component.data as Partial<ChannelLine> | undefined;
    return typeof data?.id === "string" && typeof data.body === "string" ? [data as ChannelLine] : [];
  });
}

/**
 * The picked session's panel.
 *
 * @param session The picked session, as `useSession` returns it.
 * @param kind The picked flow's kind: a channel kind or a seat kind.
 * @param conversation The session's item stream, drawn for a seat.
 */
export function PickedSessionPanel({
  session,
  kind,
  conversation,
}: {
  session: Session;
  kind: string;
  conversation: ReactNode;
}) {
  if ((CHANNEL_KINDS as readonly string[]).includes(kind)) {
    return (
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden" data-testid="picked-session">
        <ChannelTranscript session={session} />
        <Composer
          session={session}
          label="Post to this channel"
          placeholder="Write a line for this channel…"
          send={(text) => session.sendAction("post", { body: text })}
        />
      </section>
    );
  }

  const ask = seatAskFor(kind);
  return (
    <section className="flex min-w-0 flex-1 flex-col overflow-hidden" data-testid="picked-session">
      {conversation}
      {ask === undefined || "none" in ask ? (
        <p className="border-t px-4 py-3 text-xs text-muted-foreground" data-testid="picked-read-only">
          {ask?.none ?? `This ${kind} seat takes no messages from this page.`}
        </p>
      ) : (
        <Composer
          session={session}
          label="Message this seat"
          placeholder="Write to this seat…"
          send={(text) => session.sendAction(ask.action, { [ask.field]: text })}
        />
      )}
    </section>
  );
}

/** A channel's transcript, oldest first, each line under who it names. */
function ChannelTranscript({ session }: { session: Session }) {
  const lines = useMemo(() => channelLines(session.items), [session.items]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="channel-transcript">
      <ol className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-3 py-4 sm:px-4">
        {lines.map((line) => (
          <li key={line.id} className="flex flex-col gap-0.5" data-testid="channel-line">
            <span className="text-xs font-medium text-muted-foreground" data-testid="channel-line-label">
              {lineLabel(line)}
            </span>
            <span className="whitespace-pre-wrap text-sm" data-testid="channel-line-body">
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
 * The composer. The text stays until the server has taken it: a send that
 * fails, at the door or in the request, shows why and keeps the text.
 */
function Composer({
  session,
  label,
  placeholder,
  send,
}: {
  session: Session;
  label: string;
  placeholder: string;
  send: (text: string) => Promise<{ request: { id: string } }>;
}) {
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  // A sent request is settled by the stream: an error item on it is a
  // failure, and the stream closing without one is the server keeping it.
  useEffect(() => {
    if (pending === null) return;
    const error = session.items.find((item) => item.type === "error" && item.requestId === pending) as
      | { message?: string }
      | undefined;
    if (error !== undefined) {
      setFailure(error.message ?? "The request failed.");
      setPending(null);
    } else if (!session.isStreaming) {
      setDraft("");
      setPending(null);
    }
  }, [pending, session.items, session.isStreaming]);

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
