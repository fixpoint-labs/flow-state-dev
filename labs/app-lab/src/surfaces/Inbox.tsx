/**
 * Inbox (S10): every pending approval and question in the seat sessions the
 * Lab lists for this person, dispatch runs included, oldest first (BR-24).
 * A list and a detail pane; the detail draws the ask with the same card a
 * workstream's Stream uses, and answers it through the same resume (BR-25).
 *
 * Under the card, a reply box sends a line into the session the ask sits in,
 * through the door of the seat that owns that session (BR-21). A seat whose
 * kind has no door gets the box disabled, saying so; Approve and Reject are
 * untouched (BR-22).
 */
import { useState } from "react";
import { AskCard } from "../components/AskCard";
import { TurnComposer } from "../components/TurnComposer";
import { EmptyState, SectionFailure } from "../components/ui";
import { doorOf, rosterOf, workstreamsOf, waited, type LoadedSnapshot } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import type { Ask } from "../lib/reads";
import { navigate } from "../lib/routes";
import { sendTurn, TurnNotDelivered } from "../lib/send";
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

  return (
    <div className="flex h-full min-h-0" data-testid="inbox">
      <section className="flex w-96 shrink-0 flex-col border-r">
        <header className="border-b px-4 py-3">
          <h1 className="text-base font-semibold">Inbox</h1>
          <div role="tablist" aria-label="Inbox filter" className="mt-2 flex gap-1">
            {FILTERS.map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={f === filter}
                data-filter={f}
                onClick={() => setFilter(f)}
                className={`rounded-md px-2 py-1 text-xs ${f === filter ? "bg-accent font-medium" : "text-muted-foreground"}`}
              >
                {f} <span data-testid={`inbox-filter-count-${f}`}>{asks.filter((a) => matches(f, a)).length}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground" data-testid="inbox-scope">
            {gaps.inboxScope}
          </p>
        </header>
        {shown.length === 0 ? (
          <EmptyState title="Nothing is waiting on you" testId="inbox-empty">
            No seat in this Lab is waiting on an approval or an answer from you.
          </EmptyState>
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
                    className={`w-full border-b px-4 py-3 text-left ${isSelected ? "bg-accent" : "hover:bg-accent/50"}`}
                  >
                    <p className="flex items-center justify-between text-xs text-muted-foreground">
                      <span data-testid="inbox-item-kind">{ask.kind === "approval" ? "Approval" : "Question"}</span>
                      <span data-testid="inbox-item-wait">waiting {waited(ask.since, now)}</span>
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-sm">{ask.item.message ?? "(no message)"}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {ask.seatId ?? "unknown seat"} · task — ·{" "}
                      <span data-testid="inbox-item-workstream">
                        {streams.length === 0 ? "no workstream" : streams.map((w) => w.id).join(", ")}
                      </span>
                    </p>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </section>
      <section className="min-w-0 flex-1 overflow-y-auto p-6" data-testid="inbox-detail">
        {selected === null ? (
          <EmptyState title="Pick an ask">Choose an ask on the left to answer it.</EmptyState>
        ) : (
          <div className="mx-auto max-w-xl">
            <p className="mb-2 text-xs text-muted-foreground">
              {selected.seatId ?? "unknown seat"} asked, in session {selected.sessionId}
            </p>
            <AskCard ask={selected} />
            <Reply key={selected.item.suspensionId} ask={selected} snapshot={snapshot} gaps={gaps} clients={clients} onDelivered={() => void refresh()} />
          </div>
        )}
      </section>
    </div>
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
    <div className="mt-4 rounded-md border">
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
