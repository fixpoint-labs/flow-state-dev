/**
 * A task's Session tab (S3, BR-5 to BR-10): the items of the run the task's
 * row names, in stored order, live while the tab is open.
 *
 * One read of the run session's stored items, then one stream: the run's
 * request, through the flow its session names. Mounted only while the tab is
 * open, so a user reading Brief pays for no stream. A session shared with
 * other tasks shows only the items stamped with this task's id, and the lines
 * its composer sent with their replies (FIX-2009), and says so.
 *
 * Each item is drawn by Shift Manager's copy of the registry's item components
 * (`chatAssistantRenderers`: message, reasoning, tool, status, error, task
 * plan), the same copies the design system skins. An ask the run raised and
 * that still waits is drawn inline, with the one ask card Inbox uses.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { buildItemRenderStream, FlowProvider, ItemRenderer, useFlowContext, useJumpToLatest } from "@flow-state-dev/react";
import { AskCard } from "../components/AskCard";
import { shiftManagerRenderers } from "../components/ToolLine";
import { SessionItemsProvider } from "../components/flow-state/session-items-context";
import { EmptyState, JumpToLatestButton, SectionFailure } from "../components/ui";
import { asksOfTask, waitsOnYou } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import { collectionOfBoard, describeFailure, type Ask, type Failure } from "../lib/reads";
import { RouteLink } from "../components/RouteLink";
import { followRequest, mergeItems, readSessionItems, RunReadError, taskItems, type OpenRun } from "../lib/run";
import { useTask } from "../lib/task";

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

/** The open run's items: one stored read, then its request's stream. */
function RunItems({ run }: { run: OpenRun }) {
  const { client, snapshot } = useLab();
  const task = useTask();
  const asks = asksOfTask(snapshot, task.row);
  const [stored, setStored] = useState<{ items: OutputItem[]; truncated: boolean } | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const feed = useJumpToLatest();
  const { reportStatus } = task;

  /** Merge items into what is held; nothing until the first read lands. */
  const mergeIn = useCallback(
    (items: readonly OutputItem[]) => setStored((held) => (held === undefined ? held : { ...held, items: mergeItems(held.items, items) })),
    [],
  );
  const failWith = useCallback((error: unknown) => setFailure(error instanceof RunReadError ? error.failure : describeFailure(error)), []);

  useEffect(() => {
    let closed = false;
    let stream: { close(): void } | undefined;
    setStored(undefined);
    setFailure(undefined);
    readSessionItems(client, run.sessionId)
      .then((read) => {
        if (closed) return;
        setStored(read);
        stream = followRequest(client, run, {
          onItem: (item) => mergeIn([item]),
          onStatus: reportStatus,
          onError: (f) => {
            if (!closed) setFailure(f);
          },
        });
      })
      .catch((error: unknown) => {
        if (!closed) failWith(error);
      });
    return () => {
      closed = true;
      stream?.close();
    };
  }, [client, run, attempt, reportStatus, mergeIn, failWith]);

  // Follow each request in `sent` once the first read has landed, so its replay has
  // something to merge into, and re-read the session once when it leaves in_progress.
  // A settled request is never followed again: a new send reopens only the open ones.
  const { sent } = task;
  // Each line sent from the task's composer takes the session to its end, to show it. An effect, not a
  // call in the send handler as in `Conversation`, because the composer lives in `TaskFrame`. Only growth
  // is a send: `sent` empties when the task changes.
  const showSent = feed.sent;
  const sentSeen = useRef(sent.length);
  useEffect(() => {
    const grew = sent.length > sentSeen.current;
    sentSeen.current = sent.length;
    if (grew) showSent();
  }, [sent.length, showSent]);
  const loaded = stored !== undefined;
  const settled = useRef(new Set<string>());
  useEffect(() => {
    if (!loaded) return;
    let closed = false;
    const streams = sent.filter((requestId) => !settled.current.has(requestId)).map((requestId) => {
      const settle = () => {
        if (closed || settled.current.has(requestId)) return;
        settled.current.add(requestId);
        // Merged even if a newer send has re-run this effect since: the request
        // counts as settled, so no later follower brings its items.
        readSessionItems(client, run.sessionId).then((read) => mergeIn(read.items), failWith);
      };
      return followRequest(client, { flowId: run.flowId, requestId }, {
        onItem: (item) => mergeIn([item]),
        onStatus: (status) => {
          if (status !== "in_progress") settle();
        },
        onError: settle,
      });
    });
    return () => {
      closed = true;
      for (const stream of streams) stream.close();
    };
  }, [client, run, sent, loaded, mergeIn, failWith]);

  // This task's items, then the same render filters `ItemsRenderer` applies:
  // a keyed snapshot shows its latest version only, and a container with its
  // own renderer draws the items it owns.
  const { renderers } = useFlowContext();
  const sentSet = useMemo(() => new Set(sent), [sent]);
  const shown = useMemo(() => {
    if (stored === undefined) return undefined;
    const mine = taskItems(stored.items, collectionOfBoard(task.boardRef), task.taskId, sentSet);
    const items = buildItemRenderStream(mine.items, renderers).flatMap((segment) => (segment.kind === "item" ? [segment.item] : segment.items));
    return { items, shared: mine.shared };
  }, [stored, task.boardRef, task.taskId, sentSet, renderers]);

  if (failure !== undefined) {
    return (
      <div className="p-4">
        <SectionFailure what="This run's session" failure={failure} onRetry={() => setAttempt((n) => n + 1)} testId="session-failure" />
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
      {stored?.truncated === true ? (
        <p className="px-4 pt-3 text-xs text-muted-foreground" data-testid="session-truncated">
          More than shown: this session holds more steps than one read returns.
        </p>
      ) : null}
      {/* The whole session, not only this task's items: the task plan card reads every task change in it. */}
      <SessionItemsProvider value={stored.items}>
        <ol className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 py-4" data-testid="session-items">
          {shown.items.map((item) => (
            <li key={`${item.requestId}/${item.id}`} data-testid="session-item" data-item-id={item.id} data-item-type={item.type}>
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
      <JumpToLatestButton feed={feed} />
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
