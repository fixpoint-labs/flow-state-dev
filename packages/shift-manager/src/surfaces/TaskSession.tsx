// S3, BR-5 to BR-10; FIX-2009.
/**
 * A task's Session tab: the items of the run the task's
 * row names, in stored order, live while the tab is open.
 *
 * The run session's feed: its newest items, then each item its stream brings,
 * with *Load earlier* while it holds older ones. The run's request, through the
 * flow its session names, reports the run's status. Mounted only while the tab
 * is open, so a user reading Brief pays for no stream. A session shared with
 * other tasks shows only the items stamped with this task's id (a line its
 * composer sent, and the reply, carry the stamp when the door takes the task),
 * and the lines it sent to a door that keeps no task id, with their replies,
 * and says so.
 *
 * Each item is drawn by Shift Manager's copy of the registry's item components
 * (`chatAssistantRenderers`: message, reasoning, tool, status, error, task
 * plan), the same copies the design system skins. An ask the run raised and
 * that still waits is drawn inline, with the one ask card Inbox uses.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { SessionConnectionState } from "@flow-state-dev/client";
import { buildItemRenderStream, FlowProvider, ItemRenderer, useFlowContext, useJumpToLatest } from "@flow-state-dev/react";
import { AskCard } from "../components/AskCard";
import { shiftManagerRenderers } from "../components/ToolLine";
import { SessionItemsProvider } from "../components/flow-state/session-items-context";
import { ConversationScrollButton } from "../components/flow-state/conversation";
import { EmptyState, LoadEarlierButton, SectionFailure } from "../components/ui";
import { asksOfTask, waitsOnYou } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import { useReportFeedState } from "../lib/feed-health";
import { collectionOfBoard, describeFailure, type Ask, type Failure } from "../lib/reads";
import { RouteLink } from "../components/RouteLink";
import { followRequest, followSessionItems, readRunRecord, readTaskClaims, taskItems, type OpenRun, type SessionItems } from "../lib/run";
import { useTask } from "../lib/task";

/** How long after a dropped status stream a run still going is followed again. */
const STATUS_FOLLOW_AGAIN_MS = 3_000;

export function TaskSession() {
  const task = useTask();
  const { row, run } = task;
  const { snapshot } = useLab();
  // A task held on a question for you points at the Inbox; its run's stop for
  // you shows inline as an ask instead (BR-17).
  const waiting = waitsOnYou(snapshot, row) && asksOfTask(snapshot, row).length === 0;

  const body = (() => {
    switch (run.kind) {
      case "none":
        return (
          <EmptyState title="No run has started for this task" testId="session-no-run">
            {task.waiting
              ? "Its run hasn't started yet. The screen checks again every 2 seconds for up to a minute."
              : task.gaveUp
                ? "Its run still hasn't started. The screen stopped checking."
                : "A run shows here once a worker starts on it."}
            {task.gaveUp ? (
              <button type="button" className="ml-1 font-medium underline" onClick={task.retryRow} data-testid="session-retry">
                Retry
              </button>
            ) : null}
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
  const { client, snapshot } = useLab();
  const task = useTask();
  const asks = asksOfTask(snapshot, task.row);
  const [stored, setStored] = useState<SessionItems | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const feed = useJumpToLatest();
  const { reportStatus } = task;
  // The feed's connection, for the page's bar and stale styling.
  const [feedState, setFeedState] = useState<SessionConnectionState | undefined>(undefined);
  useReportFeedState(feedState);

  useEffect(() => {
    let closed = false;
    setStored(undefined);
    setFailure(undefined);
    setFeedState(undefined);
    const stop = followSessionItems(client, run.sessionId, {
      onRead: (read) => {
        if (closed) return;
        setStored(read);
        setFailure(undefined);
      },
      onFailure: (why) => {
        if (!closed) setFailure(why);
      },
      onState: (state) => {
        if (!closed) setFeedState(state);
      },
    });
    return () => {
      closed = true;
      stop();
    };
  }, [client, run.sessionId, attempt]);

  // The run's status, from its request stream. That stream doesn't reconnect: when it drops, the
  // run's record is read, and a run still going is followed again after a pause. The items stay.
  const [statusFollows, setStatusFollows] = useState(0);
  useEffect(() => {
    let closed = false;
    let again: ReturnType<typeof setTimeout> | undefined;
    const followAgain = () => {
      if (!closed) again = setTimeout(() => setStatusFollows((n) => n + 1), STATUS_FOLLOW_AGAIN_MS);
    };
    const stream = followRequest(client, run, {
      // The items come from the session feed.
      onItem: () => {},
      onStatus: reportStatus,
      onError: () => {
        readRunRecord(client, run).then((record) => {
          if (closed) return;
          reportStatus(record.status, record.endedAtMs);
          if (record.status === "in_progress") followAgain();
        }, followAgain);
      },
    });
    return () => {
      closed = true;
      clearTimeout(again);
      stream.close();
    };
  }, [client, run, reportStatus, statusFollows]);

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

  // This task's items, then the same render filters `ItemsRenderer` applies:
  // a keyed snapshot shows its latest version only, and a container with its
  // own renderer draws the items it owns.
  const { renderers } = useFlowContext();
  const { unstamped } = task;
  const sentSet = useMemo(() => new Set(unstamped), [unstamped]);
  const shown = useMemo(() => {
    if (stored === undefined) return undefined;
    // The claims only teach the attribution which tasks are this board's; they are never drawn.
    const keys = new Set(stored.items.map((item) => `${item.requestId}/${item.id}`));
    const held = [...claims.filter((item) => !keys.has(`${item.requestId}/${item.id}`)), ...stored.items];
    const mine = taskItems(held, collection, task.taskId, sentSet);
    const items = buildItemRenderStream(mine.items.filter((item) => keys.has(`${item.requestId}/${item.id}`)), renderers).flatMap((segment) => (segment.kind === "item" ? [segment.item] : segment.items));
    return { items, shared: mine.shared };
  }, [stored, claims, collection, task.taskId, sentSet, renderers]);

  const shownFailure = failure ?? claimsFailure;
  if (shownFailure !== undefined) {
    return (
      <div className="p-4">
        <SectionFailure what="This run's session" failure={shownFailure} onRetry={() => setAttempt((n) => n + 1)} testId="session-failure" />
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
      <SessionItemsProvider value={stored.items}>
        <ol className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 py-4" data-testid="session-items">
          {shown.items.map((item) => (
            <li
              key={`${item.requestId}/${item.id}`}
              data-testid="session-item"
              data-item-id={item.id}
              data-item-type={item.type}
              {...(item.type === "message" && item.role === "user" ? feed.mine(item.id) : {})}
            >
              {item.type === "suspension" ? (
                <PendingAsk ask={asks.find((ask) => ask.item.suspensionId === item.suspensionId)} />
              ) : (
                <ItemRenderer item={item} />
              )}
            </li>
          ))}
          {/* An ask the framework raised without this task's stamp is not among the task's items; it waits at the run's end. */}
          {asks
            .filter((ask) => !shown.items.some((item) => item.type === "suspension" && item.suspensionId === ask.item.suspensionId))
            .map((ask) => (
              <li key={ask.item.suspensionId} data-testid="session-pending-ask">
                <PendingAsk ask={ask} />
              </li>
            ))}
        </ol>
      </SessionItemsProvider>
      {shown.items.length === 0 ? (
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
function PendingAsk({ ask }: { ask: Ask | undefined }) {
  if (ask === undefined) {
    return (
      <RouteLink to={{ level: "inbox", item: null }} className="text-sm underline">
        Waiting on you: answer it in Inbox
      </RouteLink>
    );
  }
  return (
    <div data-testid="session-ask" data-suspension-id={ask.item.suspensionId}>
      <span className="bg-attention px-[5px] py-px font-mono text-[9.5px] font-semibold tracking-[0.12em] text-attention-foreground" data-look="ask-kind">
        {ask.kind.toUpperCase()}
      </span>
      <div className="mt-1.5">
        <AskCard ask={ask} />
      </div>
    </div>
  );
}
