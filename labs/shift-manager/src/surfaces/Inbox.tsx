/**
 * Inbox (S10): every pending approval and question in the seat sessions the
 * Lab lists for this person, dispatch runs included, oldest first (BR-24).
 * A list and a detail pane; the detail draws the ask with the same card a
 * workstream's Stream uses, and answers it through the same resume (BR-25).
 *
 * Drawn as design v2's Inbox (v2:559-645): a 400px list whose items carry the
 * highlighter square (each one waits on the person), and a detail on the
 * inspector surface headed by the question at 26px. Under it, *From the
 * session* lists the worker's last tool calls before it asked, and the
 * person's own lines sent into that session follow (BR-18), both read from
 * the ask's session.
 *
 * Under the detail, a reply box sends a line into the session the ask sits in,
 * through the door of the seat that owns that session (BR-21). A seat whose
 * kind has no door gets the box disabled, saying so; Approve and Reject are
 * untouched (BR-22).
 */
import { useEffect, useState } from "react";
import { AskCard } from "../components/AskCard";
import { TurnComposer } from "../components/TurnComposer";
import { EmptyState, Meta, ScreenTitle, SectionFailure, StateSquare, Tabs } from "../components/ui";
import { askSessionOf, type SessionCall, type SessionReply } from "../lib/ask-session";
import { doorOf, rosterOf, workstreamsOf, waited, type LoadedSnapshot } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import { describeFailure, type Ask, type Failure } from "../lib/reads";
import { navigate } from "../lib/routes";
import { readSessionItems, RunReadError } from "../lib/run";
import { sendTurn, TurnNotDelivered } from "../lib/send";
import { emptyInboxSentence } from "../lib/tasks";
import { cn } from "../lib/utils";
import type { Gaps } from "../gaps";

const FILTERS = ["All", "Approvals", "Questions"] as const;
type Filter = (typeof FILTERS)[number];

function matches(filter: Filter, ask: Ask): boolean {
  return filter === "All" || (filter === "Approvals") === (ask.kind === "approval");
}

export function Inbox({ snapshot, suspensionId, gaps }: { snapshot: LoadedSnapshot; suspensionId: string | null; gaps: Gaps }) {
  const { clients, refresh } = useLab();
  const [filter, setFilter] = useState<Filter>("All");
  if (!snapshot.asks.ok) {
    return (
      <div className="p-6">
        <SectionFailure what="Inbox" failure={snapshot.asks.failure} onRetry={() => void refresh()} />
      </div>
    );
  }
  const asks = snapshot.asks.value;
  const shown = asks.filter((ask) => matches(filter, ask));
  const selected = asks.find((ask) => ask.item.suspensionId === suspensionId) ?? null;
  const workstreams = snapshot.inventory.ok ? snapshot.inventory.value.workstreams : [];
  const now = snapshot.readAt;

  const oldest = asks.reduce<number | null>((min, ask) => (min === null || ask.since < min ? ask.since : min), null);

  return (
    <div className="flex h-full min-h-0" data-testid="inbox">
      <section className="flex w-[400px] shrink-0 flex-col border-r" data-testid="inbox-list">
        <header className="pt-3.5">
          <div className="flex items-baseline justify-between gap-3 px-[18px]">
            <ScreenTitle>Inbox</ScreenTitle>
            <Meta className="text-muted-foreground" testId="inbox-sub">
              {oldest === null ? "all clear" : `${asks.length} waiting · oldest ${waited(oldest, now)}`}
            </Meta>
          </div>
          <p className="mt-2 px-[18px] text-xs text-muted-foreground" data-testid="inbox-scope">
            {gaps.inboxScope}
          </p>
          <div className="mt-3">
            <Tabs<Filter>
              tabs={FILTERS}
              selected={filter}
              onSelect={setFilter}
              label="Inbox filter"
              counts={Object.fromEntries(FILTERS.map((f) => [f, asks.filter((a) => matches(f, a)).length]))}
            />
          </div>
        </header>
        {asks.length === 0 ? (
          <p className="px-[18px] py-7 text-sm leading-normal text-muted-foreground" data-testid="inbox-empty">
            {emptyInboxSentence(snapshot)}
          </p>
        ) : shown.length === 0 ? (
          <p className="px-[18px] py-7 text-sm leading-normal text-muted-foreground" data-testid="inbox-filter-empty">
            No {filter.toLowerCase()} waiting.
          </p>
        ) : (
          <ol className="min-h-0 flex-1 overflow-y-auto">
            {shown.map((ask) => {
              const streams = workstreamsOf(ask, workstreams);
              const isSelected = ask === selected;
              return (
                <li key={ask.item.suspensionId}>
                  <button
                    type="button"
                    onClick={() => navigate({ level: "inbox", suspensionId: ask.item.suspensionId })}
                    aria-selected={isSelected}
                    data-testid="inbox-item"
                    data-suspension-id={ask.item.suspensionId}
                    data-session-id={ask.sessionId}
                    className={cn(
                      "grid w-full grid-cols-[10px_minmax(0,1fr)_auto] gap-2.5 border-b border-foreground/10 px-[18px] py-[13px] text-left",
                      isSelected ? "bg-card shadow-[inset_2px_0_0_var(--color-info)]" : "hover:bg-foreground/5",
                    )}
                  >
                    {/* The highlighter: every ask waits on the person. */}
                    <StateSquare state="needs" className="mt-1" />
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex">
                        <span className="border border-foreground/50 px-1 font-mono text-[9.5px] font-medium tracking-[0.1em]" data-testid="inbox-item-kind">
                          {ask.kind === "approval" ? "APPROVAL" : "QUESTION"}
                        </span>
                      </span>
                      <span className="line-clamp-2 text-sm leading-[1.3] font-semibold" data-testid="inbox-item-question">
                        {ask.item.message ?? "(no message)"}
                      </span>
                      <Meta className="text-muted-foreground" testId="inbox-item-from">
                        {ask.seatId ?? "unknown seat"} · task — ·{" "}
                        <span data-testid="inbox-item-workstream">{streams.length === 0 ? "no workstream" : streams.map((w) => w.id).join(", ")}</span>
                      </Meta>
                    </span>
                    <Meta role="count" className="text-muted-foreground" testId="inbox-item-wait">
                      waiting {waited(ask.since, now)}
                    </Meta>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>
      <section className="flex min-w-0 flex-1 flex-col bg-inspector" data-testid="inbox-detail">
        {selected === null ? (
          <EmptyState title="Pick an ask">Choose an ask on the left to answer it.</EmptyState>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-[34px] py-6">
              <div className="flex max-w-[660px] flex-col gap-[18px]">
                <Meta className="text-muted-foreground" testId="inbox-detail-head">
                  {selected.seatId ?? "unknown seat"} asked, in session {selected.sessionId}
                </Meta>
                <ScreenTitle scale="detail" testId="inbox-detail-title">
                  {selected.item.message ?? "(no message)"}
                </ScreenTitle>
                <AskCard ask={selected} titled />
                <AskSession key={selected.item.suspensionId} ask={selected} readAt={snapshot.readAt} />
              </div>
            </div>
            <div className="px-[34px] pt-3 pb-4">
              <div className="max-w-[660px]">
                <Reply key={selected.item.suspensionId} ask={selected} snapshot={snapshot} gaps={gaps} clients={clients} onDelivered={() => void refresh()} />
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/** A time of day as v2 writes it, `10:31`. */
function clock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type AskSessionRead = { ok: true; value: { calls: SessionCall[]; replies: SessionReply[] } | null } | { ok: false; failure: Failure };

/**
 * *From the session* and the person's replies, read from the ask's session
 * (BR-18). Read again on every refresh, so a reply that was just delivered
 * shows once the session holds it. Drawn once the read settles.
 */
function AskSession({ ask, readAt }: { ask: Ask; readAt: number }) {
  const { clients } = useLab();
  const [read, setRead] = useState<AskSessionRead | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    readSessionItems(clients, ask.sessionId).then(
      (got) => live && setRead({ ok: true, value: askSessionOf(got.items, ask.item) }),
      (error: unknown) => live && setRead({ ok: false, failure: error instanceof RunReadError ? error.failure : describeFailure(error) }),
    );
    return () => {
      live = false;
    };
  }, [clients, ask, readAt, attempt]);
  if (read === null) return null;
  if (!read.ok) {
    const retry = () => {
      setRead(null);
      setAttempt((n) => n + 1);
    };
    return <SectionFailure what="The ask's session" failure={read.failure} onRetry={retry} testId="inbox-session-failure" />;
  }
  const found = read.value;
  return (
    <>
      <section className="flex flex-col gap-1.5" data-testid="inbox-from-session">
        <Meta role="count" className="tracking-[0.12em] text-muted-foreground" testId="inbox-from-session-label">
          FROM THE SESSION
        </Meta>
        <div className="border border-foreground/20 bg-card px-[11px] py-1.5" data-testid="inbox-from-session-calls">
          {found === null ? (
            <p className="py-1 font-mono text-xs text-muted-foreground" data-testid="inbox-from-session-unread">
              The session is longer than Shift Manager reads, so what came before the ask isn't shown.
            </p>
          ) : found.calls.length === 0 ? (
            <p className="py-1 font-mono text-xs text-muted-foreground" data-testid="inbox-from-session-none">
              No tool call before this ask.
            </p>
          ) : (
            found.calls.map((call) => (
              <div key={call.id} className="grid grid-cols-[12px_44px_minmax(0,1fr)_auto] items-center gap-2 py-1 font-mono text-xs font-medium" data-testid="inbox-session-call">
                <StateSquare state="done" className="size-[7px]" />
                <span className="truncate font-semibold">{call.tool}</span>
                <span className="truncate text-foreground/80">{call.target}</span>
                <span className="text-muted-foreground">{call.result}</span>
              </div>
            ))
          )}
        </div>
      </section>
      {(found?.replies ?? []).map((reply) => (
        <div key={reply.id} className="border-l-2 border-info py-1 pl-2.5" data-testid="inbox-reply-line">
          <Meta role="count" className="text-muted-foreground" testId="inbox-reply-line-label">
            You · {clock(reply.at)} · sent into {ask.sessionId}
          </Meta>
          <p className="mt-0.5 text-sm leading-[1.55]" data-testid="inbox-reply-line-text">
            {reply.text}
          </p>
        </div>
      ))}
    </>
  );
}

/** Why a reply can't go into the ask's session, or the door it goes through. */
function replyRoute(ask: Ask, snapshot: LoadedSnapshot, gaps: Gaps): { blocked: string } | { blocked: null; flowId: string; door: string } {
  // A session written before instance ownership names no flow, so no door.
  if (ask.flowId === null) return { blocked: ask.unanswerable ?? "This session names no flow to send through." };
  if (!snapshot.inventory.ok) return { blocked: snapshot.inventory.failure.message };
  const door = doorOf(rosterOf(snapshot).seats, ask.flowId);
  if (door === null) return { blocked: `${ask.seatId ?? ask.flowId} ${gaps.turn.replyNoDoor}` };
  return { blocked: null, flowId: ask.flowId, door };
}

/** The reply box under an ask (BR-21, BR-22). */
function Reply({
  ask,
  snapshot,
  gaps,
  clients,
  onDelivered,
}: {
  ask: Ask;
  snapshot: LoadedSnapshot;
  gaps: Gaps;
  clients: ReturnType<typeof useLab>["clients"];
  onDelivered: () => void;
}) {
  const route = replyRoute(ask, snapshot, gaps);
  return (
    <div>
      <TurnComposer
        testId="inbox-reply"
        label={`Reply to ${ask.seatId ?? "this worker"}`}
        placeholder={`Reply to ${ask.seatId ?? "this worker"}…`}
        blocked={route.blocked}
        send={async (message) => {
          // The box is disabled while blocked; a send that got here anyway
          // must not read as delivered.
          if (route.blocked !== null) throw new TurnNotDelivered("refused", route.blocked);
          await sendTurn(clients, { sessionId: ask.sessionId, flowId: route.flowId, door: route.door }, message);
        }}
        onDelivered={onDelivered}
      />
    </div>
  );
}
