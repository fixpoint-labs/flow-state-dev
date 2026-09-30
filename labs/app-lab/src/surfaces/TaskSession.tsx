/**
 * A task's Session tab (S3, BR-5 to BR-10): the items of the run the task's
 * row names, in stored order, live while the tab is open.
 *
 * One read of the run session's stored items, then one stream: the run's
 * request, through the flow its session names. Mounted only while the tab is
 * open, so a person reading Brief pays for no stream. A session shared with
 * other tasks shows only the items stamped with this task's id, and says so.
 */
import { useEffect, useMemo, useState } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { ItemRenderer } from "@flow-state-dev/react";
import { EmptyState, SectionFailure } from "../components/ui";
import { readStatus } from "../lib/columns";
import { useLab } from "../lib/lab-data";
import { describeFailure, type Failure } from "../lib/reads";
import { navigate } from "../lib/routes";
import { followRequest, mergeItems, readSessionItems, RunReadError, taskItems, type OpenRun } from "../lib/run";
import { useTask } from "../lib/task";

export function TaskSession() {
  const task = useTask();
  const { row, run } = task;
  const parked = row !== undefined && readStatus(row.status) === "parked";

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
        return <RunItems key={`${run.run.flowId}/${run.run.sessionId}/${run.run.requestId}`} run={run.run} />;
    }
  })();

  return (
    <div
      className="flex min-h-0 flex-1 flex-col outline-none"
      data-testid="task-session"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Escape" && task.status === "in_progress") {
          event.preventDefault();
          void task.requestInterrupt();
        }
      }}
    >
      {parked ? (
        <div className="mx-4 mt-3 rounded-md border px-3 py-2 text-xs" data-testid="session-parked">
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
  const { clients } = useLab();
  const task = useTask();
  const [stored, setStored] = useState<{ items: OutputItem[]; truncated: boolean } | undefined>(undefined);
  const [failure, setFailure] = useState<Failure | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
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

  const shown = useMemo(
    () => (stored === undefined ? undefined : taskItems(stored.items, task.boardRef, task.taskId)),
    [stored, task.boardRef, task.taskId],
  );

  if (failure !== undefined) {
    return (
      <div className="p-4">
        <SectionFailure what="This run's session" failure={failure} onRetry={() => setAttempt((n) => n + 1)} testId="session-failure" />
      </div>
    );
  }
  if (shown === undefined) return <p className="p-4 text-sm text-muted-foreground">Reading the run…</p>;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="session" data-session-id={run.sessionId} data-request-id={run.requestId}>
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
      <ol className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 py-4" data-testid="session-items">
        {shown.items.map((item) => (
          <li key={`${item.requestId}/${item.id}`} data-testid="session-item" data-item-id={item.id} data-item-type={item.type}>
            {item.type === "suspension" ? (
              <button type="button" className="text-sm underline" onClick={() => navigate({ level: "inbox", suspensionId: null })}>
                Waiting on you: answer it in Inbox
              </button>
            ) : (
              <ItemRenderer item={item} />
            )}
          </li>
        ))}
      </ol>
      {shown.items.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground" data-testid="session-empty">
          The run hasn't recorded a step yet.
        </p>
      ) : null}
    </div>
  );
}
