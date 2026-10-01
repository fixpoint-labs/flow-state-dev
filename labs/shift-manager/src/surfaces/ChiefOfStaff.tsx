/**
 * Chief of Staff (FIX-1722): where Shift Manager opens. The shift summary,
 * then the person's conversation with the Lab's chief-of-staff seat; the right
 * panel lists each workstream's counts and who is on call.
 *
 * **The summary is Shift Manager's, not the seat's (D1).** It is drawn from
 * the one snapshot, with the helpers Inbox and Tasks use, so its numbers are
 * theirs. Each ask is drawn by Inbox's card and answered through Inbox's path,
 * so answering it in either place clears both (BR-4 to BR-8).
 *
 * **The conversation is the seat's session (BR-10 to BR-18).** Which seat is
 * the chief of staff is one rule, `chiefOfStaffOf`. A line goes in through the
 * seat's door by the one send path, and shows *delivered* only once the
 * session holds it. What is drawn below it is what the session stores, read
 * back when the view opens and after each line, never on the snapshot's
 * refresh. Nothing is drawn in the seat's voice that its session doesn't hold.
 */
import { useEffect, useMemo, useState } from "react";
import { buildItemRenderStream, FlowProvider, ItemRenderer, useFlowContext } from "@flow-state-dev/react";
import { AskCard } from "../components/AskCard";
import { chatAssistantRenderers } from "../components/flow-state/chat-assistant";
import { SessionItemsProvider } from "../components/flow-state/session-items-context";
import { TurnComposer } from "../components/TurnComposer";
import { SectionFailure } from "../components/ui";
import { conversationSession, readConversation, sendToChiefOfStaff } from "../lib/cos";
import { chiefOfStaffOf, shiftSummary, streamCounts, type LoadedSnapshot } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import { describeFailure, type Failure, type Seat } from "../lib/reads";
import { navigate } from "../lib/routes";
import { RunReadError, type SessionItems } from "../lib/run";
import type { Gaps } from "../gaps";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function ChiefOfStaffView({ snapshot, gaps }: { snapshot: LoadedSnapshot; gaps: Gaps }) {
  return (
    <div className="h-full overflow-y-auto" data-testid="cos">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-5">
        <header>
          <p className="text-[11px] font-semibold tracking-wider text-muted-foreground">CHIEF OF STAFF</p>
          <h1 className="text-base font-semibold">Your shift</h1>
        </header>
        <ShiftSummary snapshot={snapshot} />
        <Conversation snapshot={snapshot} gaps={gaps} />
      </div>
    </div>
  );
}

/** The summary: what waits on the person, and what is running (D1). */
function ShiftSummary({ snapshot }: { snapshot: LoadedSnapshot }) {
  const { refresh } = useLab();
  const retry = () => void refresh();
  const { asks, running } = shiftSummary(snapshot);
  return (
    <section aria-label="Shift summary" className="rounded-md border bg-card p-4" data-testid="cos-summary">
      <p className="text-[11px] font-semibold tracking-wider text-muted-foreground">SHIFT SUMMARY · FROM SHIFT MANAGER</p>
      <div className="mt-2 space-y-1 text-sm">
        {asks.ok ? (
          <p data-testid="cos-summary-asks">
            {asks.value.length === 0 ? (
              "Nothing needs you."
            ) : (
              <>
                <span data-testid="cos-needs-you">{asks.value.length}</span> {asks.value.length === 1 ? "thing needs" : "things need"} you.
              </>
            )}
          </p>
        ) : (
          <SectionFailure what="What needs you" failure={asks.failure} onRetry={retry} testId="cos-summary-asks-failure" />
        )}
        {running.ok ? (
          <p data-testid="cos-summary-running" data-runs={running.value.runs} data-workstreams={running.value.workstreams}>
            {plural(running.value.runs, "run", "runs")} going across {plural(running.value.workstreams, "workstream", "workstreams")}.
          </p>
        ) : (
          <SectionFailure what="What is running" failure={running.failure} onRetry={retry} testId="cos-summary-running-failure" />
        )}
      </div>
      {asks.ok && asks.value.length > 0 ? (
        <ol className="mt-3 space-y-3" data-testid="cos-asks">
          {asks.value.map((ask) => (
            <li key={ask.item.suspensionId} data-testid="cos-ask" data-suspension-id={ask.item.suspensionId}>
              <p className="mb-1 text-xs text-muted-foreground">
                {ask.seatId ?? "unknown seat"} asks{" · "}
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => navigate({ level: "inbox", suspensionId: ask.item.suspensionId })}
                  data-testid="cos-ask-open"
                >
                  open in Inbox
                </button>
              </p>
              <AskCard ask={ask} />
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

/** The conversation, or the named state in its place (BR-10 to BR-12). */
function Conversation({ snapshot, gaps }: { snapshot: LoadedSnapshot; gaps: Gaps }) {
  const { refresh } = useLab();
  if (!snapshot.inventory.ok) {
    return <SectionFailure what="The chief of staff" failure={snapshot.inventory.failure} onRetry={() => void refresh()} testId="cos-seat-failure" />;
  }
  const cos = chiefOfStaffOf(snapshot.inventory.value.seats, snapshot.orgId);
  if (cos.kind === "none") {
    return (
      <section className="rounded-md border border-dashed p-4 text-sm" data-testid="cos-none">
        <p className="font-medium">{gaps.chiefOfStaff.none.title}</p>
        <p className="mt-1 text-muted-foreground">{gaps.chiefOfStaff.none.body}</p>
      </section>
    );
  }
  if (cos.kind === "several") {
    return (
      <section className="rounded-md border border-dashed p-4 text-sm" data-testid="cos-several">
        <p>{gaps.chiefOfStaff.several}</p>
        <ul className="mt-1 list-inside list-disc text-muted-foreground">
          {cos.seats.map((seat) => (
            <li key={seat.id}>{seat.id}</li>
          ))}
        </ul>
      </section>
    );
  }
  return <Talk key={cos.seat.id} seat={cos.seat} listed={conversationSession(snapshot.sessions, cos.seat.id)} gaps={gaps} />;
}

/** The conversation with one seat: its stored items, and the composer. */
function Talk({ seat, listed, gaps }: { seat: Seat; listed: string | null; gaps: Gaps }) {
  const { clients } = useLab();
  // The session a first line opened, until the snapshot lists it.
  const [opened, setOpened] = useState<string | null>(null);
  const sessionId = opened ?? listed;
  const [stored, setStored] = useState<SessionItems | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const [reads, setReads] = useState(0);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (sessionId === null) return;
    let closed = false;
    setFailure(undefined);
    readConversation(clients, sessionId)
      .then((read) => {
        if (!closed) setStored(read);
      })
      .catch((error: unknown) => {
        if (!closed) setFailure(error instanceof RunReadError ? error.failure : describeFailure(error));
      });
    return () => {
      closed = true;
    };
  }, [clients, sessionId, reads]);

  const blocked =
    seat.door === null
      ? `${seat.id} ${gaps.turn.noDoor}`
      : failure !== undefined
        ? "The conversation didn't load, so nothing can be sent until it does."
        : null;

  return (
    <section aria-label={`Conversation with ${seat.id}`} className="rounded-md border" data-testid="cos-conversation" data-seat-id={seat.id} data-session-id={sessionId ?? ""}>
      <header className="border-b px-4 py-2">
        <p className="text-sm font-medium">{seat.id}</p>
        <p className="text-xs text-muted-foreground">Your chief of staff. What it says here is what its session holds.</p>
      </header>
      {failure !== undefined ? (
        <div className="p-4">
          <SectionFailure what="The conversation" failure={failure} onRetry={() => setReads((n) => n + 1)} testId="cos-conversation-failure" />
        </div>
      ) : sessionId === null ? (
        <p className="px-4 py-3 text-sm text-muted-foreground" data-testid="cos-conversation-empty">
          You haven't talked with {seat.id} yet. Your first line starts the conversation.
        </p>
      ) : stored === undefined ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">Reading the conversation…</p>
      ) : (
        <FlowProvider renderers={chatAssistantRenderers}>
          <Items stored={stored} />
        </FlowProvider>
      )}
      {working ? (
        <p className="px-4 pb-2 text-xs text-muted-foreground" data-testid="cos-working">
          {seat.id} is working on it…
        </p>
      ) : null}
      <TurnComposer
        testId="cos-composer"
        label={`Message ${seat.id}`}
        placeholder={`Message ${seat.id}…`}
        blocked={blocked}
        send={async (message) => {
          setWorking(true);
          try {
            const sent = await sendToChiefOfStaff(clients, { seatId: seat.id, door: seat.door!, sessionId }, message);
            setOpened(sent.sessionId);
          } finally {
            setWorking(false);
          }
        }}
        onDelivered={() => setReads((n) => n + 1)}
      />
    </section>
  );
}

/** The session's items as stored, with the same render filters the task session applies. */
function Items({ stored }: { stored: SessionItems }) {
  const { renderers } = useFlowContext();
  const shown = useMemo(
    () => buildItemRenderStream(stored.items, renderers).flatMap((segment) => (segment.kind === "item" ? [segment.item] : segment.items)),
    [stored, renderers],
  );
  return (
    <SessionItemsProvider value={stored.items}>
      {stored.truncated ? (
        <p className="px-4 pt-3 text-xs text-muted-foreground" data-testid="cos-truncated">
          More than shown: this conversation holds more than one read returns.
        </p>
      ) : null}
      <ol className="flex flex-col gap-2 px-4 py-3" data-testid="cos-items">
        {shown.map((item) => (
          <li
            key={`${item.requestId}/${item.id}`}
            data-testid="cos-item"
            data-item-id={item.id}
            data-request-id={item.requestId}
            data-item-type={item.type}
            data-role={(item as { role?: string }).role ?? ""}
          >
            {item.type === "suspension" ? (
              <button type="button" className="text-sm underline" onClick={() => navigate({ level: "inbox", suspensionId: null })}>
                Waiting on you: answer it in Inbox
              </button>
            ) : (
              <ItemRenderer item={item} />
            )}
          </li>
        ))}
      </ol>
    </SessionItemsProvider>
  );
}

/** The right panel at Chief of Staff: STREAMS and ON CALL (BR-19, BR-20). */
export function ChiefOfStaffPanel({ snapshot, gaps }: { snapshot: LoadedSnapshot; gaps: Gaps }) {
  const { refresh } = useLab();
  const streams = streamCounts(snapshot);
  return (
    <div className="p-3" data-testid="cos-panel">
      <p className="px-1 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground">STREAMS</p>
      {streams.ok ? (
        <ul data-testid="cos-streams">
          {streams.value.map(({ workstream, running, needsYou }) => (
            <li key={workstream.id}>
              <button
                type="button"
                onClick={() => navigate({ level: "workstream", channelId: workstream.id, tab: "stream" })}
                className="flex w-full items-center justify-between gap-2 rounded px-1 py-1 text-left text-sm hover:bg-accent/60"
                data-testid="cos-stream"
                data-channel-id={workstream.id}
              >
                <span className="truncate">{workstream.id}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  <span data-testid="cos-stream-running" title={running.ok ? undefined : running.failure.message}>
                    {running.ok ? running.value : "!"}
                  </span>{" "}
                  running ·{" "}
                  <span data-testid="cos-stream-needs-you">{needsYou ?? "!"}</span> need you
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <SectionFailure what="Workstreams" failure={streams.failure} onRetry={() => void refresh()} testId="cos-streams-failure" />
      )}
      <p className="px-1 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground">ON CALL</p>
      <p className="px-1 text-xs text-muted-foreground" data-testid="cos-on-call-gap">
        {gaps.chiefOfStaff.onCall}
      </p>
    </div>
  );
}
