/**
 * A task's Session tab (S3, BR-5 to BR-10): the items of the run the task's
 * row names, in stored order, live while the tab is open.
 *
 * One read of the run session's stored items, then one stream: the run's
 * request, through the flow its session names. Mounted only while the tab is
 * open, so a person reading Brief pays for no stream. A session shared with
 * other tasks shows only the items stamped with this task's id, and says so.
 *
 * Each item is drawn by Shift Manager's copy of the registry's item components
 * (`chatAssistantRenderers`: message, reasoning, tool, status, error, task
 * plan), the same copies the design system skins. An ask the run raised and
 * that still waits is drawn inline, with the one ask card Inbox uses.
 */
import { useEffect, useMemo, useState } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { buildItemRenderStream, FlowProvider, ItemRenderer, useFlowContext } from "@flow-state-dev/react";
import { AskCard } from "../components/AskCard";
import { shiftManagerRenderers } from "../components/ToolLine";
import { SessionItemsProvider } from "../components/flow-state/session-items-context";
import { EmptyState, SectionFailure } from "../components/ui";
import { readStatus } from "../lib/columns";
import { asksOfTask } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import { describeFailure, type Ask, type Failure } from "../lib/reads";
import { navigate } from "../lib/routes";
import { useFollowLatest } from "../lib/follow";
import { followRequest, mergeItems, readSessionItems, RunReadError, taskItems, type OpenRun } from "../lib/run";
import { useTask } from "../lib/task";

export function TaskSession() {
  const task = useTask();
  const { row, run } = task;
  const { snapshot } = useLab();
  // A parked row whose run holds a pending ask shows that ask inline instead (BR-17).
  const parked = row !== undefined && readStatus(row.status) === "parked" && asksOfTask(snapshot, row).length === 0;

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
      {parked ? (
        <div className="mx-4 mt-3 border px-3 py-2 text-xs" data-testid="session-parked">
          <p className="font-medium">This task is waiting on you.</p>
          {row?.error == null ? null : <p className="mt-0.5 text-muted-foreground">{row.error}</p>}
          <button type="button" className="mt-1 underline" onClick={() => navigate({ level: "inbox", suspensionId: null })}>
            Answer it in Inbox
          </button>
        </div>
      ) : null}
      {body}
    </div>
  );
}

/** The open run's items: one stored read, then its request's stream. */
function RunItems({ run }: { run: OpenRun }) {
  const { clients, snapshot } = useLab();
  const task = useTask();
  const asks = asksOfTask(snapshot, task.row);
  const [stored, setStored] = useState<{ items: OutputItem[]; truncated: boolean } | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  const feed = useFollowLatest();
  const { reportStatus } = task;

  useEffect(() => {
    let closed = false;
    let stream: { close(): void } | undefined;
    setStored(undefined);
    setFailure(undefined);
    readSessionItems(clients, run.sessionId)
      .then((read) => {
        if (closed) return;
        setStored(read);
        stream = followRequest(clients, run, {
          onItem: (item) => setStored((held) => (held === undefined ? held : { ...held, items: mergeItems(held.items, [item]) })),
          onStatus: reportStatus,
          onError: (f) => {
            if (!closed) setFailure(f);
          },
        });
      })
      .catch((error: unknown) => {
        if (!closed) setFailure(error instanceof RunReadError ? error.failure : describeFailure(error));
      });
    return () => {
      closed = true;
      stream?.close();
    };
  }, [clients, run, attempt, reportStatus]);

  // This task's items, then the same render filters `ItemsRenderer` applies:
  // a keyed snapshot shows its latest version only, and a container with its
  // own renderer draws the items it owns.
  const { renderers } = useFlowContext();
  const shown = useMemo(() => {
    if (stored === undefined) return undefined;
    const mine = taskItems(stored.items, task.boardRef, task.taskId);
    const items = buildItemRenderStream(mine.items, renderers).flatMap((segment) => (segment.kind === "item" ? [segment.item] : segment.items));
    return { items, shared: mine.shared };
  }, [stored, task.boardRef, task.taskId, renderers]);

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
          This worker keeps one session for several tasks. Only this task's steps are shown.
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
    </div>
  );
}

/**
 * A suspension in the run. Pending, it is the ask itself, inline (v2:404-423):
 * its kind on the highlighter, because it waits on the person, and the one
 * ask card Inbox draws, answered the same way. Otherwise, a way to Inbox.
 */
function PendingAsk({ ask }: { ask: Ask | undefined }) {
  if (ask === undefined) {
    return (
      <button type="button" className="text-sm underline" onClick={() => navigate({ level: "inbox", suspensionId: null })}>
        Waiting on you: answer it in Inbox
      </button>
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
