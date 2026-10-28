/**
 * Shift Coordinator (FIX-1722): where Shift Manager opens. The shift summary,
 * then the user's conversation with the Lab's shift-coordinator worker; the right
 * panel lists its delegates and tasks.
 *
 * **The summary is Shift Manager's, not the worker's (D1).** It is drawn from
 * the one snapshot, with the helpers Inbox and Tasks use, so its numbers are
 * theirs. Each ask is drawn by Inbox's card and answered through Inbox's path,
 * so answering it in either place clears both (BR-4 to BR-8).
 *
 * **The conversation is the worker's session (BR-10 to BR-18).** Which worker is
 * the Shift Coordinator is one rule, `shiftCoordinatorOf`. A line goes in through the
 * worker's door by the one send path, and shows *delivered* only once the
 * session holds it. What is drawn below it is what the session stores, read
 * back when the view opens and after each line, never on the snapshot's
 * refresh. Nothing is drawn in the worker's voice that its session doesn't hold.
 *
 * **Drawn in design v2's form (v2:120-180).** A 720px feed under v2's header,
 * the summary as unboxed prose with its asks in one bordered list, each
 * tagged with the highlighter; the worker's messages labelled with the time;
 * and the composer pinned under the feed. The
 * registry's cards (the ask's Approve and Reject, the messages) are drawn as
 * the registry draws them.
 */
import { useEffect, type ReactNode } from "react";
import { Settings } from "lucide-react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { AskCard } from "../components/AskCard";
import { Conversation, ConversationFrame } from "../components/Conversation";
import { DelegatesPanel } from "../components/DelegatesPanel";
import { TasksPanel } from "../components/TasksPanel";
import { COORDINATOR_FLOW, useConversationSession } from "../lib/conversation";
import { useSessionItems } from "../components/flow-state/session-items-context";
import { ItemRenderer } from "@flow-state-dev/react";
import { Meta, PartialMark, ScreenTitle, SectionFailure, ShiftMark } from "../components/ui";
import { clearHandedLine, useHandedLine } from "../lib/outbox";
import { shiftCoordinatorOf, inboxItemIdOf, workerLabel, workerStates, shiftSummary, type LoadedSnapshot } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import type { SessionSummary } from "@flow-state-dev/client";
import type { Worker } from "../lib/reads";
import { navigate } from "../lib/routes";
import { startShiftCoordinatorWork, useShiftCoordinatorWorking } from "../lib/working";
import type { Gaps } from "../gaps";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What Shift Manager calls the Shift Coordinator worker (FIX-1747); the worker keeps its id. */
const NAME = "Shift Coordinator";

export function ShiftCoordinatorView({ snapshot, gaps }: { snapshot: LoadedSnapshot; gaps: Gaps }) {
  const lead = (
    <>
      <Header snapshot={snapshot} />
      <ShiftSummary snapshot={snapshot} />
    </>
  );
  return <ShiftCoordinatorConversation snapshot={snapshot} gaps={gaps} lead={lead} />;
}

/**
 * v2's header (v2:125-128): the 40px CS square, the title, and a mono line
 * with the worker's status and what it watches, or *working…* while it works on
 * a line from this page (v2:1424). When there is one Shift Coordinator, a gear at
 * the end opens that worker's settings, on any flow.
 */
function Header({ snapshot }: { snapshot: LoadedSnapshot }) {
  const working = useShiftCoordinatorWorking();
  let status: string | undefined;
  let watching: string | null = null;
  let workerId: string | undefined;
  if (snapshot.inventory.ok) {
    const { workers } = snapshot.inventory.value;
    const shiftCoordinator = shiftCoordinatorOf(workers);
    workerId = shiftCoordinator.kind === "one" ? shiftCoordinator.worker.id : undefined;
    status = workerId === undefined ? undefined : workerStates(snapshot).workers.get(workerId)?.status;
    watching = `watching ${plural(workers.length, "worker", "workers")}`;
  }
  return (
    <header className="flex items-center gap-3" data-testid="shift-coordinator-header">
      <span
        className="flex size-10 shrink-0 items-center justify-center bg-primary font-mono text-[13px] font-semibold text-primary-foreground"
        data-look="avatar"
        aria-hidden
      >
        SC
      </span>
      <div className="min-w-0">
        <ScreenTitle scale="shift-coordinator">{NAME}</ScreenTitle>
        {working ? (
          <Meta className="block text-[11.5px] text-muted-foreground" testId="shift-coordinator-sub">
            working…
          </Meta>
        ) : watching === null ? null : (
          <Meta className="block text-[11.5px] text-muted-foreground" testId="shift-coordinator-sub">
            {status === undefined ? null : `${status} · `}
            <span data-testid="shift-coordinator-watching">{watching}</span>
          </Meta>
        )}
      </div>
      {workerId === undefined ? null : (
        <button
          type="button"
          onClick={() => navigate({ level: "worker-settings", worker: workerId })}
          title={`${NAME} settings`}
          aria-label={`${NAME} settings`}
          className="ml-auto flex size-8 shrink-0 items-center justify-center text-muted-foreground hover:bg-foreground/6 hover:text-foreground"
          data-testid="shift-coordinator-settings"
        >
          <Settings className="size-4" aria-hidden />
        </button>
      )}
    </header>
  );
}

/** The highlighter tag v2 sets on what waits on the user (v2:142): an ask, here. */
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
 * The summary: what waits on the user, and what is running (D1). Drawn as
 * v2 draws the opening of the feed, unboxed 16px prose under a mono label
 * (v2:135-136), with the asks as v2's one bordered list (v2:138-153). The
 * label says whose summary it is: Shift Manager's, not the worker's.
 */
function ShiftSummary({ snapshot }: { snapshot: LoadedSnapshot }) {
  const { refresh } = useLab();
  const retry = () => void refresh();
  const { inbox, asks, running } = shiftSummary(snapshot);
  // What needs the user is what Inbox lists: one item per task held on a
  // question, a review or an approval, and per ask no task holds, each once.
  const needsYou = inbox.ok ? inbox.value.length : 0;
  return (
    <section aria-label="Shift summary" className="flex flex-col gap-2.5" data-testid="shift-coordinator-summary">
      <p className="font-mono text-[10.5px] font-medium tracking-[0.12em] text-muted-foreground" data-look="message-label">
        SHIFT SUMMARY · FROM SHIFT MANAGER
      </p>
      <div className="text-base leading-[1.55]" data-look="summary-prose">
        {inbox.ok ? (
          <p data-testid="shift-coordinator-summary-asks">
            {needsYou === 0 ? (
              "Nothing needs you."
            ) : (
              <>
                <span data-testid="shift-coordinator-needs-you">{needsYou}</span> {needsYou === 1 ? "thing needs" : "things need"} you.
              </>
            )}
          </p>
        ) : (
          <SectionFailure what="What needs you" failure={inbox.failure} onRetry={retry} testId="shift-coordinator-summary-asks-failure" />
        )}
        {running.ok ? (
          <p data-testid="shift-coordinator-summary-running" data-runs={running.value.runs} data-workstreams={running.value.workstreams}>
            {plural(running.value.runs, "run", "runs")} going across {plural(running.value.workstreams, "workstream", "workstreams")}.
          </p>
        ) : (
          <SectionFailure what="What is running" failure={running.failure} onRetry={retry} testId="shift-coordinator-summary-running-failure" />
        )}
      </div>
      {asks.ok && asks.value.length > 0 ? (
        <ol className="flex flex-col border border-foreground bg-card" data-testid="shift-coordinator-asks">
          {asks.value.map((ask, i) => (
            <li
              key={ask.item.suspensionId}
              className={`flex flex-col gap-[9px] px-3.5 py-3 ${i > 0 ? "border-t border-foreground/15" : ""}`}
              data-testid="shift-coordinator-ask"
              data-suspension-id={ask.item.suspensionId}
            >
              <div className="flex items-baseline gap-[9px]">
                <NeedsYouTag />
                <p className="min-w-0 font-mono text-[11px] font-medium text-muted-foreground" data-look="ask-meta">
                  {workerLabel(ask.workerId ?? "unknown worker")} asks{" · "}
                  <button
                    type="button"
                    className="text-info hover:text-foreground"
                    onClick={() => navigate({ level: "inbox", item: inboxItemIdOf(snapshot, ask.item.suspensionId) })}
                    data-testid="shift-coordinator-ask-open"
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
function ShiftCoordinatorConversation({ snapshot, gaps, lead }: { snapshot: LoadedSnapshot; gaps: Gaps; lead: ReactNode }) {
  const { refresh } = useLab();
  if (!snapshot.inventory.ok) {
    return (
      <ConversationFrame testId="shift-coordinator">
        {lead}
        <SectionFailure what="The shift coordinator" failure={snapshot.inventory.failure} onRetry={() => void refresh()} testId="shift-coordinator-worker-failure" />
      </ConversationFrame>
    );
  }
  const shiftCoordinator = shiftCoordinatorOf(snapshot.inventory.value.workers);
  if (shiftCoordinator.kind === "none") {
    return (
      <ConversationFrame testId="shift-coordinator">
        {lead}
        <section className="border border-dashed p-4 text-sm" data-testid="shift-coordinator-none">
          <p className="font-medium">{gaps.shiftCoordinator.none.title}</p>
          <p className="mt-1 text-muted-foreground">{gaps.shiftCoordinator.none.body}</p>
        </section>
      </ConversationFrame>
    );
  }
  if (shiftCoordinator.kind === "several") {
    return (
      <ConversationFrame testId="shift-coordinator">
        {lead}
        <section className="border border-dashed p-4 text-sm" data-testid="shift-coordinator-several">
          <p>{gaps.shiftCoordinator.several}</p>
          <ul className="mt-1 list-inside list-disc text-muted-foreground">
            {shiftCoordinator.workers.map((worker) => (
              <li key={worker.id}>{worker.id}</li>
            ))}
          </ul>
        </section>
      </ConversationFrame>
    );
  }
  return (
    <Talk key={shiftCoordinator.worker.id} worker={shiftCoordinator.worker} sessions={snapshot.sessions} gaps={gaps} lead={lead} />
  );
}

/**
 * An ask the worker raised: a needs-you line that opens Inbox, where it is
 * answered, until the user has answered it (the session holds its resume).
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
    <button type="button" className="flex items-baseline gap-[9px] text-left" onClick={() => navigate({ level: "inbox", item: null })}>
      <NeedsYouTag />
      <span className="font-mono text-[11px] font-medium text-info" data-look="ask-meta">
        Waiting on you: answer it in Inbox
      </span>
    </button>
  );
}

/**
 * The conversation with the Shift Coordinator worker: the shared conversation
 * component, with the summary above it, an ask the worker raised drawn as a
 * needs-you line that opens Inbox (where it is answered), and a line the
 * palette handed over sent by its composer.
 */
function Talk({
  worker,
  sessions,
  gaps,
  lead,
}: {
  worker: Worker;
  sessions: readonly SessionSummary[];
  gaps: Gaps;
  lead: ReactNode;
}) {
  const working = useShiftCoordinatorWorking();
  // A line the palette handed over is sent by this screen's composer, and is dropped if it is never taken.
  const handed = useHandedLine();
  useEffect(() => clearHandedLine, []);
  return (
    <Conversation
      testId="shift-coordinator"
      worker={worker}
      sessions={sessions}
      gaps={gaps}
      name={NAME}
      lead={lead}
      working={working}
      startWork={startShiftCoordinatorWork}
      autoSend={handed}
      onAutoSend={clearHandedLine}
      renderItem={renderAsk}
      scale="shift-coordinator"
      startAtEnd
    />
  );
}

/**
 * The right panel at Shift Coordinator: the delegates and tasks of a Shift Coordinator on the coordinator flow.
 * Its standing rules are on its settings page, behind the header's gear.
 */
export function ShiftCoordinatorPanel({ snapshot }: { snapshot: LoadedSnapshot }) {
  const found = snapshot.inventory.ok ? shiftCoordinatorOf(snapshot.inventory.value.workers) : undefined;
  const one = found?.kind === "one" ? found.worker : undefined;
  const shiftCoordinator = one?.kind === COORDINATOR_FLOW ? one : undefined;
  const conversation = useConversationSession(shiftCoordinator, snapshot.sessions);
  return (
    <div className="p-3" data-testid="shift-coordinator-panel">
      {shiftCoordinator !== undefined ? (
        <>
          <p className="px-1 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground">DELEGATES</p>
          <DelegatesPanel key={shiftCoordinator.id} worker={shiftCoordinator} sessionId={conversation} />
          <p className="px-1 pt-4 pb-1 text-[11px] font-semibold tracking-wider text-muted-foreground">TASKS</p>
          <TasksPanel key={`tasks-${shiftCoordinator.id}`} worker={shiftCoordinator} sessionId={conversation} readAt={snapshot.readAt} activeOnly />
        </>
      ) : (
        <p className="px-1 text-xs text-muted-foreground" data-testid="shift-coordinator-panel-empty">
          No delegates or tasks yet.
        </p>
      )}
    </div>
  );
}
