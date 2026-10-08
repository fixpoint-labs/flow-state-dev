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
 *
 * **Drawn in design v2's form (v2:120-180).** A 720px feed under v2's header,
 * the summary as unboxed prose with its asks in one bordered list, each
 * tagged with the highlighter; the seat's messages labelled with the time;
 * and the composer pinned under the feed with suggestions above it. The
 * registry's cards (the ask's Approve and Reject, the messages) are drawn as
 * the registry draws them.
 */
import { useEffect, type ReactNode } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { AskCard } from "../components/AskCard";
import { Conversation, ConversationFrame } from "../components/Conversation";
import { useSessionItems } from "../components/flow-state/session-items-context";
import { ItemRenderer } from "@flow-state-dev/react";
import { Meta, PartialMark, ScreenTitle, SectionFailure, ShiftMark } from "../components/ui";
import { clearHandedLine, useHandedLine } from "../lib/outbox";
import { chiefOfStaffOf, seatStates, shiftSummary, streamCounts, type LoadedSnapshot } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import type { SessionSummary } from "@flow-state-dev/client";
import type { Seat } from "../lib/reads";
import { navigate } from "../lib/routes";
import { chiefOfStaffSuggestions } from "../lib/shell";
import { startChiefOfStaffWork, useChiefOfStaffWorking } from "../lib/working";
import type { Gaps } from "../gaps";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What Shift Manager calls the chief of staff seat (FIX-1747); the seat keeps its id. */
const NAME = "Shift Coordinator";

export function ChiefOfStaffView({ snapshot, gaps }: { snapshot: LoadedSnapshot; gaps: Gaps }) {
  const lead = (
    <>
      <Header snapshot={snapshot} />
      <ShiftSummary snapshot={snapshot} />
    </>
  );
  return <ChiefOfStaffConversation snapshot={snapshot} gaps={gaps} lead={lead} />;
}

/**
 * v2's header (v2:125-128): the 40px CS square, the title, and a mono line
 * with the seat's status and what it watches, or *working…* while it works on
 * a line from this page (v2:1424).
 */
function Header({ snapshot }: { snapshot: LoadedSnapshot }) {
  const working = useChiefOfStaffWorking();
  let status: string | undefined;
  let watching: string | null = null;
  if (snapshot.inventory.ok) {
    const { seats, workstreams } = snapshot.inventory.value;
    const cos = chiefOfStaffOf(seats);
    status = cos.kind === "one" ? seatStates(snapshot).seats.get(cos.seat.id)?.status : undefined;
    watching = `watching ${plural(workstreams.length, "stream", "streams")} and ${plural(seats.length, "worker", "workers")}`;
  }
  return (
    <header className="flex items-center gap-3" data-testid="cos-header">
      <span
        className="flex size-10 shrink-0 items-center justify-center bg-primary font-mono text-[13px] font-semibold text-primary-foreground"
        data-look="avatar"
        aria-hidden
      >
        SC
      </span>
      <div className="min-w-0">
        <ScreenTitle scale="cos">{NAME}</ScreenTitle>
        {working ? (
          <Meta className="block text-[11.5px] text-muted-foreground" testId="cos-sub">
            working…
          </Meta>
        ) : watching === null ? null : (
          <Meta className="block text-[11.5px] text-muted-foreground" testId="cos-sub">
            {status === undefined ? null : `${status} · `}
            <span data-testid="cos-watching">{watching}</span>
          </Meta>
        )}
      </div>
    </header>
  );
}

/** The highlighter tag v2 sets on what waits on the person (v2:142): an ask, here. */
function NeedsYouTag() {
  return (
    <span
      className="shrink-0 border border-foreground bg-attention px-[5px] py-px font-mono text-[9.5px] font-semibold tracking-[0.12em] text-attention-foreground"
      data-look="needs-tag"
    >
      NEEDS YOU
    </span>
  );
}

/**
 * The summary: what waits on the person, and what is running (D1). Drawn as
 * v2 draws the opening of the feed, unboxed 16px prose under a mono label
 * (v2:135-136), with the asks as v2's one bordered list (v2:138-153). The
 * label says whose summary it is: Shift Manager's, not the seat's.
 */
function ShiftSummary({ snapshot }: { snapshot: LoadedSnapshot }) {
  const { refresh } = useLab();
  const retry = () => void refresh();
  const { asks, running } = shiftSummary(snapshot);
  return (
    <section aria-label="Shift summary" className="flex flex-col gap-2.5" data-testid="cos-summary">
      <p className="font-mono text-[10.5px] font-medium tracking-[0.12em] text-muted-foreground" data-look="message-label">
        SHIFT SUMMARY · FROM SHIFT MANAGER
      </p>
      <div className="text-base leading-[1.55]" data-look="summary-prose">
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
        <ol className="flex flex-col border border-foreground bg-card" data-testid="cos-asks">
          {asks.value.map((ask, i) => (
            <li
              key={ask.item.suspensionId}
              className={`flex flex-col gap-[9px] px-3.5 py-3 ${i > 0 ? "border-t border-foreground/15" : ""}`}
              data-testid="cos-ask"
              data-suspension-id={ask.item.suspensionId}
            >
              <div className="flex items-baseline gap-[9px]">
                <NeedsYouTag />
                <p className="min-w-0 font-mono text-[11px] font-medium text-muted-foreground" data-look="ask-meta">
                  {ask.seatId ?? "unknown seat"} asks{" · "}
                  <button
                    type="button"
                    className="text-info hover:text-foreground"
                    onClick={() => navigate({ level: "inbox", suspensionId: ask.item.suspensionId })}
                    data-testid="cos-ask-open"
                  >
                    open in Inbox
                  </button>
                </p>
              </div>
              <AskCard ask={ask} />
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

/** The conversation, or the named state in its place (BR-10 to BR-12), under `lead`. */
function ChiefOfStaffConversation({ snapshot, gaps, lead }: { snapshot: LoadedSnapshot; gaps: Gaps; lead: ReactNode }) {
  const { refresh } = useLab();
  if (!snapshot.inventory.ok) {
    return (
      <ConversationFrame testId="cos">
        {lead}
        <SectionFailure what="The shift coordinator" failure={snapshot.inventory.failure} onRetry={() => void refresh()} testId="cos-seat-failure" />
      </ConversationFrame>
    );
  }
  const cos = chiefOfStaffOf(snapshot.inventory.value.seats);
  if (cos.kind === "none") {
    return (
      <ConversationFrame testId="cos">
        {lead}
        <section className="border border-dashed p-4 text-sm" data-testid="cos-none">
          <p className="font-medium">{gaps.chiefOfStaff.none.title}</p>
          <p className="mt-1 text-muted-foreground">{gaps.chiefOfStaff.none.body}</p>
        </section>
      </ConversationFrame>
    );
  }
  if (cos.kind === "several") {
    return (
      <ConversationFrame testId="cos">
        {lead}
        <section className="border border-dashed p-4 text-sm" data-testid="cos-several">
          <p>{gaps.chiefOfStaff.several}</p>
          <ul className="mt-1 list-inside list-disc text-muted-foreground">
            {cos.seats.map((seat) => (
              <li key={seat.id}>{seat.id}</li>
            ))}
          </ul>
        </section>
      </ConversationFrame>
    );
  }
  return (
    <Talk key={cos.seat.id} seat={cos.seat} sessions={snapshot.sessions} gaps={gaps} lead={lead} suggestions={chiefOfStaffSuggestions(snapshot)} />
  );
}

/**
 * An ask the seat raised: a needs-you line that opens Inbox, where it is
 * answered, until the person has answered it (the session holds its resume).
 * Answered, it is the registry's own card.
 */
function renderAsk(item: OutputItem) {
  return item.type === "suspension" ? <AskLine item={item} /> : undefined;
}

function AskLine({ item }: { item: OutputItem }) {
  const items = useSessionItems();
  const id = (item as { suspensionId?: string }).suspensionId;
  if (items.some((other) => other.type === "suspension_resume" && (other as { suspensionId?: string }).suspensionId === id)) {
    return (
      <div data-look="registry-item">
        <ItemRenderer item={item} />
      </div>
    );
  }
  return (
    <button type="button" className="flex items-baseline gap-[9px] text-left" onClick={() => navigate({ level: "inbox", suspensionId: null })}>
      <NeedsYouTag />
      <span className="font-mono text-[11px] font-medium text-info" data-look="ask-meta">
        Waiting on you: answer it in Inbox
      </span>
    </button>
  );
}

/**
 * The conversation with the Shift Coordinator seat: the shared conversation
 * component, with the summary above it, an ask the seat raised drawn as a
 * needs-you line that opens Inbox (where it is answered), and a line the
 * palette handed over sent by its composer.
 */
function Talk({
  seat,
  sessions,
  gaps,
  lead,
  suggestions,
}: {
  seat: Seat;
  sessions: readonly SessionSummary[];
  gaps: Gaps;
  lead: ReactNode;
  suggestions: readonly string[];
}) {
  const working = useChiefOfStaffWorking();
  // A line the palette handed over is sent by this screen's composer, and is dropped if it is never taken.
  const handed = useHandedLine();
  useEffect(() => clearHandedLine, []);
  return (
    <Conversation
      testId="cos"
      seat={seat}
      sessions={sessions}
      gaps={gaps}
      name={NAME}
      lead={lead}
      working={working}
      startWork={startChiefOfStaffWork}
      suggestions={suggestions}
      autoSend={handed}
      onAutoSend={clearHandedLine}
      renderItem={renderAsk}
      scale="cos"
    />
  );
}

/** The right panel at Shift Coordinator: STREAMS (BR-19) and ON CALL, the workers Roster reads on call. */
export function ChiefOfStaffPanel({ snapshot, gaps }: { snapshot: LoadedSnapshot; gaps: Gaps }) {
  const { refresh } = useLab();
  const streams = streamCounts(snapshot);
  const states = seatStates(snapshot);
  const onCall = [...states.seats.values()].filter((state) => state.status === "on call");
  return (
    <div className="p-3" data-testid="cos-panel">
      <p className="px-1 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground">STREAMS</p>
      {snapshot.asks.ok ? null : (
        <SectionFailure what="What needs you" failure={snapshot.asks.failure} onRetry={() => void refresh()} testId="cos-streams-asks-failure" />
      )}
      {streams.ok ? (
        <ul data-testid="cos-streams">
          {streams.value.map(({ workstream, running, needsYou }) => (
            <li key={workstream.id}>
              <button
                type="button"
                onClick={() => navigate({ level: "workstream", mailboxId: workstream.id, tab: "stream" })}
                className="flex w-full items-center justify-between gap-2 px-1 py-1 text-left text-sm hover:bg-accent/60"
                data-testid="cos-stream"
                data-mailbox-id={workstream.id}
              >
                <span className="truncate">{workstream.id}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  <span data-testid="cos-stream-running">
                    {running.ok ? running.value : "–"}
                  </span>{" "}
                  running ·{" "}
                  <span data-testid="cos-stream-needs-you">{needsYou ?? "–"}</span> need you
                </span>
              </button>
              {running.ok ? null : (
                <SectionFailure what={`${workstream.id}'s boards`} failure={running.failure} onRetry={() => void refresh()} testId="cos-stream-failure" />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <SectionFailure what="Workstreams" failure={streams.failure} onRetry={() => void refresh()} testId="cos-streams-failure" />
      )}
      <p className="px-1 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground">
        ON CALL
        {states.partial ? <PartialMark title={gaps.roster.partial} /> : null}
      </p>
      {onCall.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground" data-testid="cos-on-call-none">
          No worker is on call.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {onCall.map(({ seat }) => (
            <li key={seat.id}>
              <button
                type="button"
                onClick={() => navigate({ level: "roster", team: seat.team })}
                className="flex w-full items-center gap-2 px-1 py-1 text-left text-sm hover:bg-accent/60"
                data-testid="cos-on-call"
                data-seat-id={seat.id}
              >
                <ShiftMark status="on call" />
                <span className="truncate">{seat.id}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
