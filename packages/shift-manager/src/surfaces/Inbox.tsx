// BR-24; BR-25; BR-18; BR-21; BR-22; FIX-2774.
/**
 * Inbox (S10): everything waiting on the user, oldest first: every
 * pending approval and question in their workers' sessions, dispatch runs
 * included, every one from a worker run with no conversation, and every task
 * holding questions for them. It draws workforce's inbox view and reads no
 * other list (`lib/inbox.ts`).
 * A list and a detail pane; the detail draws an ask with the same card Shift
 * Coordinator uses, and answers it through the same resume. The list groups
 * every ask no task holds under the worker that raised it, with a count, each
 * ask showing its heading and, when it differs, its message's first line; a
 * task's item stands on its own.
 *
 * Drawn as design v2's Inbox (v2:559-645): a 400px list whose items carry the
 * highlighter square (each one waits on the user), and a detail on the
 * inspector surface headed by the ask's short title at 26px; an ask that gave a
 * title has its message drawn under it at body size, as markdown, rather than
 * the whole ask set in display type. Under it, *From the
 * session* lists the worker's last tool calls before it asked, and the
 * user's own lines sent into that session follow, both read from
 * the ask's session.
 *
 * Under the detail, a reply box sends a line into the session the ask sits in,
 * through the door of the worker that owns that session. A worker whose
 * worker flow has no door gets the box disabled, saying so; Approve and Reject are
 * untouched. An ask from a run with no conversation names no worker and has
 * no session to read or reply into: its box is disabled, saying so.
 */
import { useMemo, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import { AskCard } from "../components/AskCard";
import { TurnComposer } from "../components/TurnComposer";
import { EmptyState, Meta, ScreenTitle, SectionFailure, StateSquare, Tabs } from "../components/ui";
import { askSessionOf, type SessionCall, type SessionReply } from "../lib/ask-session";
import { doorOf, waited, workerLabel } from "../lib/shift";
import { useWorkers, type Workers } from "../lib/directory";
import type { InboxHold, InboxAnswer, InboxItem as OrchestrationInboxItem } from "@flow-state-dev/orchestration/inbox";
import type { SuspensionItem } from "@flow-state-dev/core/items";
import { describeFailure, type Failure } from "../lib/failure";
import { useInbox, useInboxAnswer, type InboxAsk } from "../lib/inbox";
import { groupedByWorker, itemAtRoute, sessionOfHold, workerOfHold } from "../lib/inbox-list";
import { navigate } from "../lib/routes";
import { RouteLink } from "../components/RouteLink";
import { useRetrySessionFeed, useSharedSessionFeed } from "../lib/session-feeds";
import { TurnNotDelivered, useDeliverLine } from "../lib/deliver";
import { useWorkforce } from "../lib/workforce";
import { nothingWaitingSentence } from "../lib/tasks";
import { cn } from "../lib/utils";
import type { Gaps } from "../gaps";

const FILTERS = ["All", "Approvals", "Questions"] as const;
type Filter = (typeof FILTERS)[number];

/** An Inbox item, its suspensions drawn with the ask the view found for them. */
type InboxItem = OrchestrationInboxItem<InboxAsk>;
/** One hold of an Inbox item. */
type InboxViewHold = InboxHold<InboxAsk>;

/** What a run with no conversation is drawn as: no session to read, and none to reply into. */
const NO_CONVERSATION_REPLY = "This ask comes from a run with no conversation, so there is nothing to reply into. Answer it with the card above.";

/** Whether `item` is an approval, as the filter and its tag read it: its first hold asks for a yes or a no. */
function isApproval(item: InboxItem): boolean {
  return item.holds[0]!.ask.kind === "approval";
}

function matches(filter: Filter, item: InboxItem): boolean {
  return filter === "All" || (filter === "Approvals") === isApproval(item);
}

function askHeading(hold: InboxViewHold): string {
  return hold.detail?.title || hold.detail?.message || hold.ask.title || hold.ask.prompt || "(no message)";
}

/** An item's heading: its first hold's title, else what it asks. */
function itemHeading(item: InboxItem): string {
  const { ask } = item.holds[0]!;
  return ask.title || ask.prompt || "(no message)";
}

/**
 * Who an item waits for the user on behalf of: the task's assignee, else the
 * worker that asked, and the task. A run with no conversation names no
 * worker: its flow is named instead.
 */
function itemFrom(item: InboxItem): string {
  const hold = item.holds[0]!;
  const noConversation = item.task === null && sessionOfHold(hold) === null;
  const who = item.task?.assignee ?? workerOfHold(hold) ?? (noConversation ? `${hold.detail?.flowKind ?? "a worker flow"}, no conversation` : "unknown worker");
  const more = item.holds.length > 1 ? ` · ${item.holds.length} asks` : "";
  return `${workerLabel(who)} · task ${item.task?.title ?? "—"}${more}`;
}

/** What a grouped item says under its heading: its message's first line, or nothing when the heading already is that (an untitled ask). */
function groupedFrom(item: InboxItem): string | null {
  const line = item.holds[0]!.ask.prompt.split("\n")[0] ?? "";
  return line === "" || line === itemHeading(item) ? null : line;
}

/** One item of the list: approval or question, its heading, `from` under it when there is one, and how long it has waited. */
function ItemButton({ item, selected, from, now }: { item: InboxItem; selected: boolean; from: string | null; now: number }) {
  return (
    <button
      type="button"
      onClick={() => /* in place: picks the item shown beside the list */ navigate({ level: "inbox", item: item.id })}
      aria-selected={selected}
      data-testid="inbox-item"
      data-item-id={item.id}
      data-source={item.holds[0]!.source.kind}
      data-suspension-id={item.holds[0]!.source.kind === "suspension" ? item.holds[0]!.source.suspensionId : undefined}
      data-session-id={sessionOfHold(item.holds[0]!) ?? undefined}
      className={cn(
        "grid w-full grid-cols-[10px_minmax(0,1fr)_auto] gap-2.5 border-b border-foreground/10 px-[18px] py-[13px] text-left",
        selected ? "bg-card shadow-[inset_2px_0_0_var(--color-info)]" : "hover:bg-foreground/5",
      )}
    >
      {/* The highlighter: every ask waits on the user. */}
      <StateSquare state="needs" className="mt-1" />
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex">
          <span className="border border-foreground/50 px-1 font-mono text-xs font-medium tracking-[0.1em]" data-testid="inbox-item-kind">
            {isApproval(item) ? "APPROVAL" : "QUESTION"}
          </span>
        </span>
        <span className="line-clamp-2 text-sm leading-[1.3] font-semibold" data-testid="inbox-item-question">
          {itemHeading(item)}
        </span>
        {from === null ? null : (
          <Meta className="text-muted-foreground" testId="inbox-item-from">
            {from}
          </Meta>
        )}
      </span>
      <Meta role="count" className="text-muted-foreground" testId="inbox-item-wait">
        waiting {waited(item.since, now)}
      </Meta>
    </button>
  );
}

export function Inbox({ itemId, gaps }: { itemId: string | null; gaps: Gaps }) {
  const inbox = useInbox();
  const [filter, setFilter] = useState<Filter>("All");
  // Bumped when a reply is delivered, so the ask's session is read again then.
  const [replies, setReplies] = useState(0);
  if (inbox.section === undefined) {
    return (
      <p className="p-6 text-sm text-muted-foreground" data-testid="inbox-loading">
        Reading the Inbox…
      </p>
    );
  }
  if (!inbox.section.ok) {
    return (
      <div className="p-6">
        <SectionFailure what="Inbox" failure={inbox.section.failure} onRetry={inbox.refresh} />
      </div>
    );
  }
  const view = inbox.section.value;
  // A refresh that failed after a good read: the older list stays, saying it may be out of date and why.
  const lapsed = inbox.failure !== undefined ? <SectionFailure what="The Inbox's latest read" failure={inbox.failure} onRetry={inbox.refresh} testId="inbox-stale" /> : null;
  const items = view.items;
  const shown = items.filter((item) => matches(filter, item));
  // An older link names a suspension id; it opens the item that holds it.
  const selected = itemAtRoute(items, itemId);
  const now = Date.now();

  const oldest = items.reduce<number | null>((min, item) => (min === null || item.since < min ? item.since : min), null);

  return (
    <div className="flex h-full min-h-0" data-testid="inbox">
      <section className="flex w-[400px] shrink-0 flex-col border-r" data-testid="inbox-list">
        <header className="pt-3.5">
          <div className="flex items-baseline justify-between gap-3 px-[18px]">
            <ScreenTitle>Inbox</ScreenTitle>
            <Meta className="text-muted-foreground" testId="inbox-sub">
              {oldest === null ? "all clear" : `${items.length} waiting · oldest ${waited(oldest, now)}`}
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
              counts={Object.fromEntries(FILTERS.map((f) => [f, items.filter((item) => matches(f, item)).length]))}
            />
          </div>
          {lapsed !== null ? <div className="mx-[18px] mt-3">{lapsed}</div> : null}
        </header>
        {items.length === 0 ? (
          <p className="px-[18px] py-7 text-sm leading-normal text-muted-foreground" data-testid="inbox-empty">
            {nothingWaitingSentence(view)}
          </p>
        ) : shown.length === 0 ? (
          <p className="px-[18px] py-7 text-sm leading-normal text-muted-foreground" data-testid="inbox-filter-empty">
            No {filter.toLowerCase()} waiting.
          </p>
        ) : (
          <ol className="min-h-0 flex-1 overflow-y-auto">
            {groupedByWorker(shown).map((entry) =>
              entry.kind === "item" ? (
                <li key={entry.item.id}>
                  <ItemButton item={entry.item} selected={entry.item === selected} from={itemFrom(entry.item)} now={now} />
                </li>
              ) : (
                <li key={`worker:${entry.worker}`} data-testid="inbox-group" data-worker={entry.worker}>
                  <Meta className="block border-b border-foreground/10 px-[18px] pt-3 pb-1.5 text-muted-foreground" testId="inbox-group-head">
                    {`${workerLabel(entry.worker)} · ${entry.items.length} waiting`}
                  </Meta>
                  <ol>
                    {entry.items.map((item) => (
                      <li key={item.id}>
                        {/* The group names the worker, so each item says what it asks instead. */}
                        <ItemButton item={item} selected={item === selected} from={groupedFrom(item)} now={now} />
                      </li>
                    ))}
                  </ol>
                </li>
              ),
            )}
          </ol>
        )}
      </section>
      <section className="flex min-w-0 flex-1 flex-col bg-inspector" data-testid="inbox-detail">
        {selected === null ? (
          <EmptyState title="Pick an ask">Choose an ask on the left to answer it.</EmptyState>
        ) : selected.holds[0]!.source.kind === "task" ? (
          <HeldQuestions item={selected} />
        ) : (
          <AskDetail
            hold={selected.holds[0]!}
            gaps={gaps}
            replies={replies}
            onDelivered={() => setReplies((n) => n + 1)}
          />
        )}
      </section>
    </div>
  );
}

/** A suspension's detail: its card, its session, and the reply box under it. */
function AskDetail({
  hold: selected,
  gaps,
  replies,
  onDelivered,
}: {
  hold: InboxViewHold;
  gaps: Gaps;
  replies: number;
  onDelivered: () => void;
}) {
  return (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-[34px] py-6">
              <div className="flex max-w-[660px] flex-col gap-[18px]">
                <Meta className="text-muted-foreground" testId="inbox-detail-head">
                  {sessionOfHold(selected) === null
                    ? `${selected.detail?.flowKind ?? (selected.source.kind === "suspension" ? selected.source.flowId : null) ?? "A worker flow"} asked, from a run with no conversation`
                    : `${workerLabel(workerOfHold(selected) ?? "unknown worker")} asked, in session ${sessionOfHold(selected)}`}
                </Meta>
                <ScreenTitle scale="detail" testId="inbox-detail-title">
                  {askHeading(selected)}
                </ScreenTitle>
                {selected.detail?.title && selected.detail.message ? <AskBody text={selected.detail.message} /> : null}
                <AskCard hold={selected} titled />
                {sessionOfHold(selected) === null ? null : <AskSession key={selected.id} hold={selected} reread={replies} />}
              </div>
            </div>
            <div className="px-[34px] pt-3 pb-4">
              <div className="max-w-[660px]">
                <Reply
                  key={selected.id}
                  hold={selected}
                  gaps={gaps}
                  onDelivered={onDelivered}
                />
              </div>
            </div>
          </>
  );
}

// FIX-2133.
/**
 * A task holding questions: every open one, oldest first, and the task they
 * hold. One item however many it holds (rule 11). Each is answered here,
 * through the task's board as the user: a question with words, a
 * confirm with a yes or a no.
 */
function HeldQuestions({ item }: { item: InboxItem }) {
  const task = item.task === null ? null : { level: "task" as const, boardRef: item.task.board, taskId: item.task.taskId, tab: "brief" as const };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-[34px] py-6" data-testid="inbox-held">
      <div className="flex max-w-[660px] flex-col gap-[18px]">
        {task === null ? null : (
          <Meta className="text-muted-foreground" testId="inbox-detail-head">
            {workerLabel(item.task!.assignee ?? "unassigned")} waits on {item.holds.length === 1 ? "your answer" : `${item.holds.length} answers`} to start or go on with{" "}
            <RouteLink to={task} className="underline" data-testid="inbox-held-task">
              {item.task!.title}
            </RouteLink>
          </Meta>
        )}
        <ol className="flex flex-col gap-3" data-testid="inbox-held-questions">
          {item.holds.map((hold) => (
            <li key={hold.id} className="flex flex-col gap-2" data-testid="inbox-held-question" data-question-id={hold.id}>
              <ScreenTitle scale="detail">{hold.ask.prompt}</ScreenTitle>
              <HeldAnswer hold={hold} />
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** One held question's answer: words for a question, a yes or a no (with a note) for a confirm. */
function HeldAnswer({ hold }: { hold: InboxHold<unknown> }) {
  const answerOne = useInboxAnswer();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  if (!hold.answerable) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="inbox-held-unanswerable">
        {hold.unanswerable}
      </p>
    );
  }
  const send = async (answer: InboxAnswer) => {
    setSending(true);
    setFailure(null);
    try {
      await answerOne(hold, answer);
      setText("");
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    } finally {
      setSending(false);
    }
  };
  const confirm = hold.ask.kind === "confirm";
  return (
    <div className="flex flex-col gap-1.5" data-testid="inbox-held-answer">
      <textarea
        className="min-h-[56px] w-full border border-foreground/20 bg-card px-2.5 py-1.5 text-sm"
        placeholder={confirm ? "A note, if you like" : "Your answer"}
        aria-label={confirm ? `A note for: ${hold.ask.prompt}` : `Answer: ${hold.ask.prompt}`}
        value={text}
        disabled={sending}
        onChange={(event) => setText(event.target.value)}
        data-testid="inbox-held-answer-text"
      />
      <div className="flex gap-2">
        {confirm ? (
          <>
            <button type="button" className="border border-foreground/30 px-3 py-1 text-sm" disabled={sending} onClick={() => void send({ done: true, ...(text.trim() !== "" ? { note: text } : {}) })} data-testid="inbox-held-yes">
              Yes
            </button>
            <button type="button" className="border border-foreground/30 px-3 py-1 text-sm" disabled={sending} onClick={() => void send({ done: false, ...(text.trim() !== "" ? { note: text } : {}) })} data-testid="inbox-held-no">
              No
            </button>
          </>
        ) : (
          <button type="button" className="border border-foreground/30 px-3 py-1 text-sm" disabled={sending || text.trim() === ""} onClick={() => void send({ text })} data-testid="inbox-held-send">
            Answer
          </button>
        )}
      </div>
      {failure !== null ? (
        <p className="text-xs text-destructive" role="alert" data-testid="inbox-held-failure">
          {failure}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A titled ask's message, under its title: body text drawn from markdown, so
 * a list of questions is a list and code is code. Headings in it stay body
 * size; the ask's title is the only heading.
 */
const bodyHeading = ({ children }: { children?: ReactNode }) => <p className="font-semibold">{children}</p>;
const BODY_COMPONENTS = { h1: bodyHeading, h2: bodyHeading, h3: bodyHeading, h4: bodyHeading, h5: bodyHeading, h6: bodyHeading };

function AskBody({ text }: { text: string }) {
  return (
    <div
      className={cn(
        "text-sm leading-[1.55]",
        "[&_p]:my-1.5 [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1",
        "[&_code]:bg-foreground/10 [&_code]:px-1 [&_code]:font-mono [&_code]:text-sm",
        "[&_pre]:my-1.5 [&_pre]:overflow-x-auto [&_pre]:bg-foreground/10 [&_pre]:p-2.5 [&_pre_code]:bg-transparent [&_pre_code]:px-0",
      )}
      data-testid="inbox-detail-body"
    >
      <Markdown components={BODY_COMPONENTS}>{text}</Markdown>
    </div>
  );
}

/** A time of day as v2 writes it, `10:31`. */
function clock(at: number): string {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

type AskSessionRead =
  | { ok: true; value: { calls: SessionCall[]; replies: SessionReply[] } | null; truncated: boolean }
  | { ok: false; failure: Failure };

// BR-18.
/**
 * *From the session* and the user's replies, read from the ask's session.
 * Read from the page's one feed for the ask's session, so a reply shows once
 * the session holds it, with no read of its own. The component is keyed by
 * the ask, so the ask it reads around never changes under it.
 */
function AskSession({ hold }: { hold: InboxViewHold; reread?: number }) {
  const sessionId = sessionOfHold(hold)!;
  const feed = useSharedSessionFeed(sessionId);
  const retry = useRetrySessionFeed(sessionId);
  const items = feed?.items;
  const hasEarlier = feed?.hasEarlier ?? false;
  const error = feed?.error ?? null;
  const read = useMemo<AskSessionRead | null>(() => {
    if (items !== undefined) {
      // The stop as the session holds it, where *From the session* is read around.
      const stop = items.find((item) => item.type === "suspension" && (item as SuspensionItem).suspensionId === hold.id);
      return { ok: true, value: stop === undefined ? null : askSessionOf(items, stop), truncated: hasEarlier };
    }
    return error !== null ? { ok: false, failure: describeFailure(error) } : null;
  }, [items, hasEarlier, error, hold.id]);
  if (read === null) {
    return (
      <Meta className="text-muted-foreground" testId="inbox-session-loading">
        Reading the session…
      </Meta>
    );
  }
  if (!read.ok) {
    // A feed whose read gave up is opened anew.
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
      {read.truncated ? (
        <p className="text-xs text-muted-foreground" data-testid="inbox-session-truncated">
          More than shown: this session holds more than one read returns, so a later reply may not be shown here.
        </p>
      ) : null}
      {(found?.replies ?? []).map((reply) => (
        <div key={reply.id} className="border-l-2 border-info py-1 pl-2.5" data-testid="inbox-reply-line">
          <Meta role="count" className="text-muted-foreground" testId="inbox-reply-line-label">
            You · {clock(reply.at)} · sent into {sessionId}
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
function replyRoute(hold: InboxViewHold, directory: Workers, gaps: Gaps): { blocked: string } | { blocked: null; sessionId: string; flowId: string; door: string } {
  const sessionId = sessionOfHold(hold);
  // A run with no conversation has no session to reply into.
  if (sessionId === null) return { blocked: NO_CONVERSATION_REPLY };
  const flowId = hold.source.flowId;
  // A session written before instance ownership names no flow, so no door.
  if (flowId === null) return { blocked: hold.unanswerable ?? "This session names no flow to send through." };
  if (directory.inventory === undefined) return { blocked: "Reading the Lab's workers first…" };
  if (!directory.inventory.ok) return { blocked: directory.inventory.failure.message };
  const door = doorOf(directory.workers, flowId);
  if (door === null) return { blocked: `${workerLabel(workerOfHold(hold) ?? flowId)} ${gaps.turn.replyNoDoor}` };
  return { blocked: null, sessionId, flowId, door };
}

// BR-21, BR-22.
/** The reply box under an ask. */
function Reply({
  hold,
  gaps,
  onDelivered,
}: {
  hold: InboxViewHold;
  gaps: Gaps;
  onDelivered: () => void;
}) {
  const route = replyRoute(hold, useWorkers(), gaps);
  const worker = workerOfHold(hold);
  const workforce = useWorkforce();
  const deliver = useDeliverLine();
  return (
    <div>
      <TurnComposer
        testId="inbox-reply"
        draftKey={`reply:${hold.id}`}
        label={`Reply to ${workerLabel(worker ?? "this worker")}`}
        placeholder={`Reply to ${workerLabel(worker ?? "this worker")}…`}
        blocked={route.blocked}
        // Through the flow the reply goes to, whose sign-in its send runs.
        uploader={route.blocked === null && worker !== null ? { upload: (file) => workforce.upload(worker, file) } : null}
        send={async (message, held, attachments) => {
          // The box is disabled while blocked; a send that got here anyway
          // must not read as delivered.
          if (route.blocked !== null) throw new TurnNotDelivered("refused", route.blocked);
          return await deliver({ sessionId: route.sessionId }, message, { onHeld: held, attachments });
        }}
        onHeld={onDelivered}
        onDelivered={onDelivered}
      />
    </div>
  );
}
