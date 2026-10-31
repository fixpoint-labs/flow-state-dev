/**
 * Inbox (S10): everything waiting on the user, oldest first (BR-24): every
 * pending approval and question in the worker sessions the Lab lists for this
 * user, dispatch runs included, and every task holding questions for them. It
 * draws the snapshot's `inbox` section and reads no other list (`inbox.ts`).
 * A list and a detail pane; the detail draws an ask with the same card Shift
 * Coordinator uses, and answers it through the same resume (BR-25).
 *
 * Drawn as design v2's Inbox (v2:559-645): a 400px list whose items carry the
 * highlighter square (each one waits on the user), and a detail on the
 * inspector surface headed by the ask's short title at 26px; an ask that gave a
 * title has its message drawn under it at body size, as markdown, rather than
 * the whole ask set in display type. Under it, *From the
 * session* lists the worker's last tool calls before it asked, and the
 * user's own lines sent into that session follow (BR-18), both read from
 * the ask's session.
 *
 * Under the detail, a reply box sends a line into the session the ask sits in,
 * through the door of the worker that owns that session (BR-21). A worker whose
 * worker flow has no door gets the box disabled, saying so; Approve and Reject are
 * untouched (BR-22).
 */
import { useEffect, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import { AskCard } from "../components/AskCard";
import { TurnComposer } from "../components/TurnComposer";
import { EmptyState, Meta, ScreenTitle, SectionFailure, StateSquare, Tabs } from "../components/ui";
import { askSessionOf, type SessionCall, type SessionReply } from "../lib/ask-session";
import { doorOf, inboxItemAt, rosterOf, waited, workerLabel, type LoadedSnapshot } from "../lib/derive";
import type { InboxHold, InboxItem as OrchestrationInboxItem } from "@flow-state-dev/orchestration/inbox";
import { useLab } from "../lib/lab-data";
import { describeFailure, type Ask, type Failure } from "../lib/reads";
import { navigate, pathFor } from "../lib/routes";
import { readSessionItems, RunReadError } from "../lib/run";
import { sendTurn, TurnNotDelivered } from "../lib/send";
import { emptyInboxSentence } from "../lib/tasks";
import { cn } from "../lib/utils";
import type { Gaps } from "../gaps";

const FILTERS = ["All", "Approvals", "Questions"] as const;
type Filter = (typeof FILTERS)[number];

/** An Inbox item, its suspensions drawn with the ask a worker session holds for them. */
type InboxItem = OrchestrationInboxItem<Ask>;

/** Whether `item` is an approval, as the filter and its tag read it: its first hold asks for a yes or a no. */
function isApproval(item: InboxItem): boolean {
  return item.holds[0]!.ask.kind === "approval";
}

function matches(filter: Filter, item: InboxItem): boolean {
  return filter === "All" || (filter === "Approvals") === isApproval(item);
}

function askHeading(ask: Ask): string {
  return ask.item.title || ask.item.message || "(no message)";
}

/** An item's heading: its first hold's title, else what it asks. */
function itemHeading(item: InboxItem): string {
  const { ask } = item.holds[0]!;
  return ask.title || ask.prompt || "(no message)";
}

/** Who an item waits for the user on behalf of: the task's assignee, else the worker that asked, and the task. */
function itemFrom(item: InboxItem): string {
  const who = item.task?.assignee ?? item.holds[0]!.detail?.workerId ?? "unknown worker";
  const more = item.holds.length > 1 ? ` · ${item.holds.length} asks` : "";
  return `${workerLabel(who)} · task ${item.task?.title ?? "—"}${more}`;
}

/**
 * The ask a suspension item's card is drawn with: the pending ask the
 * worker's session holds for it, or, when the session wasn't read, one made
 * from what the task's row records of the stop. Either answers through the
 * same route, by the hold's source.
 */
function askOfItem(item: InboxItem): Ask {
  const hold = item.holds[0]!;
  if (hold.detail !== undefined) return hold.detail;
  if (hold.source.kind !== "suspension") throw new Error(`Inbox item "${item.id}" holds no suspension`);
  const approval = hold.ask.kind === "approval";
  return {
    sessionId: hold.source.sessionId,
    workerId: item.task?.assignee ?? null,
    flowId: hold.source.flowId,
    parentSessionId: null,
    kind: approval ? "approval" : "question",
    item: {
      type: "suspension",
      id: hold.source.suspensionId,
      suspensionId: hold.source.suspensionId,
      requestId: hold.source.requestId,
      suspensionStatus: "pending",
      reason: approval ? "user_approval" : "user_input",
      message: hold.ask.prompt,
      ...(hold.ask.title !== undefined ? { title: hold.ask.title } : {}),
      allow: approval ? ["approve", "reject"] : ["submit"],
    } as Ask["item"],
    since: hold.openedAt,
    unanswerable: item.unanswerable,
  };
}

export function Inbox({ snapshot, itemId, gaps }: { snapshot: LoadedSnapshot; itemId: string | null; gaps: Gaps }) {
  const { client, refresh } = useLab();
  const [filter, setFilter] = useState<Filter>("All");
  // Bumped when a reply is delivered, so the ask's session is read again then.
  const [replies, setReplies] = useState(0);
  if (!snapshot.inbox.ok) {
    return (
      <div className="p-6">
        <SectionFailure what="Inbox" failure={snapshot.inbox.failure} onRetry={() => void refresh()} />
      </div>
    );
  }
  const items = snapshot.inbox.value;
  const shown = items.filter((item) => matches(filter, item));
  // An older link names a suspension id; it opens the item that holds it.
  const selected = inboxItemAt(snapshot, itemId);
  const now = snapshot.readAt;

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
        </header>
        {items.length === 0 ? (
          <p className="px-[18px] py-7 text-sm leading-normal text-muted-foreground" data-testid="inbox-empty">
            {emptyInboxSentence(snapshot)}
          </p>
        ) : shown.length === 0 ? (
          <p className="px-[18px] py-7 text-sm leading-normal text-muted-foreground" data-testid="inbox-filter-empty">
            No {filter.toLowerCase()} waiting.
          </p>
        ) : (
          <ol className="min-h-0 flex-1 overflow-y-auto">
            {shown.map((item) => {
              const isSelected = item === selected;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => navigate({ level: "inbox", item: item.id })}
                    aria-selected={isSelected}
                    data-testid="inbox-item"
                    data-item-id={item.id}
                    data-source={item.holds[0]!.source.kind}
                    data-suspension-id={item.holds[0]!.source.kind === "suspension" ? item.holds[0]!.source.suspensionId : undefined}
                    data-session-id={item.holds[0]!.source.kind === "suspension" ? item.holds[0]!.source.sessionId : undefined}
                    className={cn(
                      "grid w-full grid-cols-[10px_minmax(0,1fr)_auto] gap-2.5 border-b border-foreground/10 px-[18px] py-[13px] text-left",
                      isSelected ? "bg-card shadow-[inset_2px_0_0_var(--color-info)]" : "hover:bg-foreground/5",
                    )}
                  >
                    {/* The highlighter: every ask waits on the user. */}
                    <StateSquare state="needs" className="mt-1" />
                    <span className="flex min-w-0 flex-col gap-1">
                      <span className="flex">
                        <span className="border border-foreground/50 px-1 font-mono text-[9.5px] font-medium tracking-[0.1em]" data-testid="inbox-item-kind">
                          {isApproval(item) ? "APPROVAL" : "QUESTION"}
                        </span>
                      </span>
                      <span className="line-clamp-2 text-sm leading-[1.3] font-semibold" data-testid="inbox-item-question">
                        {itemHeading(item)}
                      </span>
                      <Meta className="text-muted-foreground" testId="inbox-item-from">
                        {itemFrom(item)}
                      </Meta>
                    </span>
                    <Meta role="count" className="text-muted-foreground" testId="inbox-item-wait">
                      waiting {waited(item.since, now)}
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
        ) : selected.holds[0]!.source.kind === "row" ? (
          <HeldQuestions item={selected} />
        ) : (
          <AskDetail
            ask={askOfItem(selected)}
            snapshot={snapshot}
            gaps={gaps}
            client={client}
            replies={replies}
            onDelivered={() => {
              setReplies((n) => n + 1);
              void refresh();
            }}
          />
        )}
      </section>
    </div>
  );
}

/** A suspension's detail: its card, its session, and the reply box under it. */
function AskDetail({
  ask: selected,
  snapshot,
  gaps,
  client,
  replies,
  onDelivered,
}: {
  ask: Ask;
  snapshot: LoadedSnapshot;
  gaps: Gaps;
  client: ReturnType<typeof useLab>["client"];
  replies: number;
  onDelivered: () => void;
}) {
  return (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto px-[34px] py-6">
              <div className="flex max-w-[660px] flex-col gap-[18px]">
                <Meta className="text-muted-foreground" testId="inbox-detail-head">
                  {workerLabel(selected.workerId ?? "unknown worker")} asked, in session {selected.sessionId}
                </Meta>
                <ScreenTitle scale="detail" testId="inbox-detail-title">
                  {askHeading(selected)}
                </ScreenTitle>
                {selected.item.title && selected.item.message ? <AskBody text={selected.item.message} /> : null}
                <AskCard ask={selected} titled />
                <AskSession key={selected.item.suspensionId} ask={selected} reread={replies} />
              </div>
            </div>
            <div className="px-[34px] pt-3 pb-4">
              <div className="max-w-[660px]">
                <Reply
                  key={selected.item.suspensionId}
                  ask={selected}
                  snapshot={snapshot}
                  gaps={gaps}
                  client={client}
                  onDelivered={onDelivered}
                />
              </div>
            </div>
          </>
  );
}

/**
 * A task holding questions: every open one, oldest first, and the task they
 * hold. One item however many it holds (rule 11). Each is answered here,
 * through the task's board as the user (FIX-2133): a question with words, a
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
            <a href={pathFor(task)} onClick={(e) => (e.preventDefault(), navigate(task))} className="underline" data-testid="inbox-held-task">
              {item.task!.title}
            </a>
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
  const { answerOne } = useLab();
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
  const send = async (answer: Parameters<typeof answerOne>[1]) => {
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
        "[&_code]:bg-foreground/10 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12.5px]",
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

/**
 * *From the session* and the user's replies, read from the ask's session
 * (BR-18). Read when the ask opens and again after each reply is delivered
 * (`reread`), so the reply shows once the session holds it; a Lab refresh for
 * anything else doesn't re-read the session. The component is keyed by the
 * ask, so the ask it reads around never changes under it.
 */
function AskSession({ ask, reread }: { ask: Ask; reread: number }) {
  const { client } = useLab();
  const [read, setRead] = useState<AskSessionRead | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    readSessionItems(client, ask.sessionId).then(
      (got) => live && setRead({ ok: true, value: askSessionOf(got.items, ask.item), truncated: got.truncated }),
      (error: unknown) => live && setRead({ ok: false, failure: error instanceof RunReadError ? error.failure : describeFailure(error) }),
    );
    return () => {
      live = false;
    };
    // `ask` is fixed for this component's life (keyed by the ask), so the session is the dependency.
  }, [client, ask.sessionId, reread, attempt]);
  if (read === null) {
    return (
      <Meta className="text-muted-foreground" testId="inbox-session-loading">
        Reading the session…
      </Meta>
    );
  }
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
      {read.truncated ? (
        <p className="text-xs text-muted-foreground" data-testid="inbox-session-truncated">
          More than shown: this session holds more than one read returns, so a later reply may not be shown here.
        </p>
      ) : null}
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
  const door = doorOf(rosterOf(snapshot).workers, ask.flowId);
  if (door === null) return { blocked: `${workerLabel(ask.workerId ?? ask.flowId)} ${gaps.turn.replyNoDoor}` };
  return { blocked: null, flowId: ask.flowId, door };
}

/** The reply box under an ask (BR-21, BR-22). */
function Reply({
  ask,
  snapshot,
  gaps,
  client,
  onDelivered,
}: {
  ask: Ask;
  snapshot: LoadedSnapshot;
  gaps: Gaps;
  client: ReturnType<typeof useLab>["client"];
  onDelivered: () => void;
}) {
  const route = replyRoute(ask, snapshot, gaps);
  return (
    <div>
      <TurnComposer
        testId="inbox-reply"
        draftKey={`ask:${ask.item.suspensionId}`}
        label={`Reply to ${workerLabel(ask.workerId ?? "this worker")}`}
        placeholder={`Reply to ${workerLabel(ask.workerId ?? "this worker")}…`}
        blocked={route.blocked}
        send={async (message, held) => {
          // The box is disabled while blocked; a send that got here anyway
          // must not read as delivered.
          if (route.blocked !== null) throw new TurnNotDelivered("refused", route.blocked);
          return sendTurn(client, { sessionId: ask.sessionId, flowId: route.flowId, door: route.door }, message, { onHeld: held });
        }}
        onHeld={onDelivered}
        onDelivered={onDelivered}
      />
    </div>
  );
}
