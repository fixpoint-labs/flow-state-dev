// S3, BR-5 to BR-10; FIX-2009.
/**
 * A task's Session tab: the items of the run the task's
 * row names, in stored order, live while the tab is open.
 *
 * The run session's feed, the page's one feed for the session
 * (`useSharedSessionFeed`): its newest items, then each item its stream brings,
 * with *Load earlier* while it holds older ones. The run's status is the task's
 * (`TaskProvider`, from the run's own stream). A session shared with
 * other tasks shows only the items stamped with this task's id (a line its
 * composer sent, and the reply, carry the stamp when the door takes the task),
 * and the lines it sent to a door that keeps no task id, with their replies,
 * and says so.
 *
 * The run's lines are React's conversation model over this task's items and
 * its run's status (a stopped run draws its stopped line), drawn as a
 * conversation draws them (Shift Manager's registry, `components/lines.tsx`:
 * a run of tool calls as one tool group, a task's brief folded). A failed
 * run's line offers Retry while its task stands failed on the board: the run
 * is the board's to run again, so Retry is the board's, the task's own Retry.
 * An ask the run raised and that still waits is drawn inline, with the one
 * ask card Inbox uses.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { conversationLines, FlowProvider, ItemsRenderer, useFlowContext, useJumpToLatest } from "@flow-state-dev/react";
import { AskCard } from "../components/AskCard";
import { shiftManagerRenderers } from "../components/lines";
import { ToolGroup } from "../components/flow-state/tool";
import { isTaskBrief } from "../components/flow-state/workforce-lines";
import { SessionItemsProvider } from "../components/flow-state/session-items-context";
import { ConversationScrollButton } from "../components/flow-state/conversation";
import { LineContext, type LineContextValue } from "../components/flow-state/conversation-lines";
import { EmptyState, LoadEarlierButton, SectionFailure } from "../components/ui";
import { askWord, holdsOnYou, taskAsks, useInbox, type InboxAsk } from "../lib/inbox";
import type { InboxHold } from "@flow-state-dev/orchestration/inbox";
import { useLab } from "../lib/lab-data";
import { workerLabel } from "../lib/derive";
import { useReportFeedState } from "../lib/feed-health";
import { collectionOfBoard, describeFailure, type Failure } from "../lib/reads";
import { useRetrySessionFeed, useSharedSessionFeed } from "../lib/session-feeds";
import { readTaskClaims, taskItems } from "../lib/task-items";
import { RouteLink } from "../components/RouteLink";
import { useTask, type OpenRun } from "../lib/task";

export function TaskSession() {
  const task = useTask();
  const { row, run } = task;
  // A task held on a question for you points at the Inbox; its run's stop for
  // you shows inline as an ask instead (BR-17). Both are its Inbox item's (D2).
  const inbox = useInbox().section;
  const items = inbox?.ok === true ? inbox.value.items : [];
  const waiting = holdsOnYou(items, row) && taskAsks(items, row).length === 0;

  const body = (() => {
    switch (run.kind) {
      case "none":
        return (
          <EmptyState title="No run has started for this task" testId="session-no-run">
            {task.waiting ? "Its run hasn't started yet. It shows here as soon as the board links it." : "A run shows here once a worker starts on it."}
          </EmptyState>
        );
      case "resolving":
        return <p className="p-4 text-sm text-muted-foreground">Opening the run…</p>;
      case "failed":
        return (
          <div className="p-4">
            <SectionFailure what="This task's run" failure={run.failure} onRetry={task.retryRun} testId="session-failure" />
            {run.failure.httpStatus === 403 || run.failure.httpStatus === 404 ? (
              <p className="mt-2 text-xs text-muted-foreground" data-testid="session-not-visible">
                The run isn't visible to you. The screen shows no other session in its place.
              </p>
            ) : null}
          </div>
        );
      case "open":
        return (
          <FlowProvider renderers={shiftManagerRenderers}>
            <RunItems key={`${run.run.flowId}/${run.run.sessionId}/${run.run.requestId}`} run={run.run} />
          </FlowProvider>
        );
    }
  })();

  return (
    <div className="flex min-h-0 flex-1 flex-col outline-none" data-testid="task-session" tabIndex={0}>
      {waiting ? (
        <div className="mx-4 mt-3 border px-3 py-2 text-xs" data-testid="session-waiting">
          <p className="font-medium">This task is waiting on you.</p>
          <RouteLink to={{ level: "inbox", item: null }} className="mt-1 inline-block underline">
            Answer it in Inbox
          </RouteLink>
        </div>
      ) : null}
      {body}
    </div>
  );
}


/**
 * The open run's items, through the run session's feed: its newest items once,
 * then each item the session stream brings, a reply to a line sent from the
 * composer included. The feed reconnects on its own, so a dropped stream keeps
 * what is shown. The run's request stream reports only its status.
 */
function RunItems({ run }: { run: OpenRun }) {
  const { client, refresh } = useLab();
  const task = useTask();
  const inbox = useInbox().section;
  const asks = taskAsks(inbox?.ok === true ? inbox.value.items : [], task.row);
  const feed = useJumpToLatest();
  const [attempt, setAttempt] = useState(0);
  // The page's one feed for the run session; its connection goes to the page's bar.
  const session = useSharedSessionFeed(run.sessionId);
  const retryFeed = useRetrySessionFeed(run.sessionId);
  useReportFeedState(session?.state);
  const sessionItems = session?.items;
  const stored = useMemo(
    () => (sessionItems === undefined ? undefined : { items: [...sessionItems], truncated: session!.hasEarlier, loadEarlier: session!.hasEarlier ? session!.loadEarlier : undefined }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionItems, session?.hasEarlier, session?.loadEarlier],
  );
  // Only a first read that failed shows: the feed reads again on its own, and a lapse keeps what it read.
  const failure: Failure | undefined = stored === undefined && session?.error != null ? describeFailure(session.error) : undefined;

  // A window that starts after the task was claimed holds no `task-change` naming it, and the
  // attribution would drop every step: read the board's claims in this session on their own.
  const collection = collectionOfBoard(task.boardRef);
  const windowed = stored?.truncated === true;
  const [claims, setClaims] = useState<readonly OutputItem[]>([]);
  // Its own failure: a feed update must not clear it while the steps it hides are still hidden.
  const [claimsFailure, setClaimsFailure] = useState<Failure | undefined>(undefined);
  useEffect(() => {
    setClaims([]);
    setClaimsFailure(undefined);
    if (!windowed) return;
    let closed = false;
    readTaskClaims(client, run.sessionId, collection).then(
      (read) => {
        if (!closed) setClaims(read);
      },
      (error: unknown) => {
        if (!closed) setClaimsFailure(describeFailure(error));
      },
    );
    return () => {
      closed = true;
    };
  }, [client, run.sessionId, collection, windowed, attempt]);

  // Each line sent from the task's composer takes the session to its end, to show it. An effect, not a
  // call in the send handler as in `Conversation`, because the composer lives in `TaskFrame`. Only growth
  // is a send: `sent` empties when the task changes.
  const { sent } = task;
  const showSent = feed.sent;
  const sentSeen = useRef(sent.length);
  useEffect(() => {
    const grew = sent.length > sentSeen.current;
    sentSeen.current = sent.length;
    if (grew) showSent();
  }, [sent.length, showSent]);

  // This task's lines, through the same filters `ItemsRenderer` applies: a keyed snapshot shows its
  // latest version only, and a container with its own renderer draws the items it owns.
  const { renderers } = useFlowContext();
  // Every line this composer sent shows by its request: a stamping door's turns carry the stamp too.
  const sentSet = useMemo(() => new Set(task.sent), [task.sent]);
  // The run's one turn, as its request stream last said: a stopped run draws its stopped line. A
  // failed run is retryable while its task stands failed: the board runs it again, on Retry.
  const status = task.status;
  const { board, retryRow, taskId } = task;
  const retryable = board !== undefined && task.row?.status === "errored";
  const turns = useMemo(() => (status === undefined ? [] : [{ id: run.requestId, status, retryable }]), [run.requestId, status, retryable]);
  // What a run's lines can do here: name the workers, as the conversation does, and Retry the task.
  const lineActions = useMemo<LineContextValue>(
    () => ({
      nameOf: workerLabel,
      ...(board === undefined
        ? {}
        : {
            retry: async () => {
              // Read the board and the Lab again either way, as the task's own Retry does.
              try {
                await board.retry(taskId);
              } finally {
                retryRow();
                void refresh();
              }
            },
          }),
    }),
    [board, retryRow, refresh, taskId],
  );
  const shown = useMemo(() => {
    if (stored === undefined) return undefined;
    // The claims only teach the attribution which tasks are this board's; they are never drawn.
    const keys = new Set(stored.items.map((item) => `${item.requestId}/${item.id}`));
    const held = [...claims.filter((item) => !keys.has(`${item.requestId}/${item.id}`)), ...stored.items];
    const mine = taskItems(held, collection, task.taskId, sentSet);
    const lines = conversationLines(mine.items.filter((item) => keys.has(`${item.requestId}/${item.id}`)), turns, { renderers });
    return { lines, shared: mine.shared };
  }, [stored, claims, collection, task.taskId, sentSet, renderers, turns]);

  const shownFailure = failure ?? claimsFailure;
  if (shownFailure !== undefined) {
    return (
      <div className="p-4">
        <SectionFailure what="This run's session" failure={shownFailure} onRetry={() => {
            // The feed, if its first read gave up, and the claims, if their read failed.
            if (failure !== undefined) retryFeed();
            setAttempt((n) => n + 1);
          }}
          testId="session-failure" />
      </div>
    );
  }
  if (stored === undefined || shown === undefined) return <p className="p-4 text-sm text-muted-foreground">Reading the run…</p>;

  return (
    <div ref={feed.ref} className="min-h-0 flex-1 overflow-y-auto" data-testid="session" data-session-id={run.sessionId} data-request-id={run.requestId}>
      {shown.shared ? (
        <p className="px-4 pt-3 text-xs text-muted-foreground" data-testid="session-shared">
          This worker keeps one session for several tasks. Only this task's steps, and the messages you send from here, are shown.
        </p>
      ) : null}
      <LoadEarlierButton load={stored.loadEarlier} testId="session-load-earlier" />
      {/* The whole session, not only this task's items: the task plan card reads every task change in it. */}
      {/* Names, and the board's Retry: a task's run offers no answers on its lines. */}
      <LineContext.Provider value={lineActions}>
        <SessionItemsProvider value={stored.items}>
          <ol className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 py-4" data-testid="session-items">
            {shown.lines.map((line) => {
              // A steps line is named by its first call or thought, and typed as the run of steps it is.
              const item = line.kind === "steps" ? line.items[0] : line.kind === "stopped" ? undefined : line.item;
              const type = line.kind === "steps" ? "steps" : (item?.type ?? line.kind);
              return (
                <li
                  key={`${line.requestId}/${line.id}`}
                  data-testid="session-item"
                  data-item-id={item?.id ?? line.id}
                  data-item-type={type}
                  {...(line.kind === "user" && !isTaskBrief(line.item) ? feed.mine(line.id) : {})}
                >
                  {line.kind === "suspension" ? (
                    <PendingAsk ask={asks.find((ask) => ask.id === line.item.suspensionId)} />
                  ) : (
                    <ItemsRenderer lines={[line]} toolGroupRenderer={ToolGroup} />
                  )}
                </li>
              );
            })}
            {/* An ask the framework raised without this task's stamp is not among the task's items; it waits at the run's end. */}
            {asks
              .filter((ask) => !shown.lines.some((line) => line.kind === "suspension" && line.item.suspensionId === ask.id))
              .map((ask) => (
                <li key={ask.id} data-testid="session-pending-ask">
                  <PendingAsk ask={ask} />
                </li>
              ))}
          </ol>
        </SessionItemsProvider>
      </LineContext.Provider>
      {shown.lines.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground" data-testid="session-empty">
          The run hasn't recorded a step yet.
        </p>
      ) : null}
      <ConversationScrollButton feed={feed} className="size-8 rounded-none" />
    </div>
  );
}

/**
 * A suspension in the run. Pending, it is the ask itself, inline (v2:404-423):
 * its ask kind on the highlighter, because it waits on the user, and the one
 * ask card Inbox draws, answered the same way. Otherwise, a way to Inbox.
 */
function PendingAsk({ ask }: { ask: InboxHold<InboxAsk> | undefined }) {
  if (ask === undefined) {
    return (
      <RouteLink to={{ level: "inbox", item: null }} className="text-sm underline">
        Waiting on you: answer it in Inbox
      </RouteLink>
    );
  }
  return (
    <div data-testid="session-ask" data-suspension-id={ask.id}>
      <span className="bg-attention px-[5px] py-px font-mono text-xs font-semibold tracking-[0.12em] text-attention-foreground" data-look="ask-kind">
        {askWord(ask).toUpperCase()}
      </span>
      <div className="mt-1.5">
        <AskCard hold={ask} />
      </div>
    </div>
  );
}
