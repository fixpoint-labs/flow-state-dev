/**
 * Child sessions view (FIX-1071).
 *
 * The background work hanging off the open session. A ChildSession is a **session
 * of its own** that outlives the request which started it, so this panel is a
 * list of sessions — not a projection of the task board. That ordering is the
 * whole design: a ChildSession may be started with no task behind it at all, and a
 * panel derived from the board would simply not show it.
 *
 * Where a ChildSession *is* doing a board's task, the tasks it covers are named on
 * its row, and the Tasks panel carries the same link in the other direction. See
 * `lib/child-session-links` for how that association is derived and what it cannot
 * see.
 *
 * Opening a row hands the ChildSession's session id back to the panel, which swaps
 * the workspace onto it — every tab then reads that session, because there is
 * nothing special about a ChildSession once you are inside one.
 */
import { useMemo } from "react";
import { ArrowRight, Layers } from "lucide-react";
import type { ChildSessionSummary } from "@flow-state-dev/client";
import {
  groupCollections,
  type TaskStreamItem,
} from "../../lib/task-collection-state";
import {
  decodeChildSessionEntry,
  decodeChildSessionKey,
  linkChildSessionsToTasks,
  type LinkedTask,
} from "../../lib/child-session-links";
import type { Truncation } from "../../hooks/use-child-sessions";
import { shortSessionId } from "../../lib/utils";
import { EmptyState } from "../shared/empty-state";
import { StatusBadge } from "../shared/status-badge";
import { Button } from "../ui/button";

type Props = {
  /** The conversation whose background work this is. */
  sessionId: string | null;
  /**
   * The rows, fetched by the panel rather than here — the Tasks panel needs the
   * same list to draw its per-task links, and two hooks would mean two reads of
   * an endpoint that resolves a request-store lookup per row.
   */
  childSessions: readonly ChildSessionSummary[];
  isLoading: boolean;
  error: string | null;
  /**
   * What is known about rows beyond this page. Shown, because a count beside a
   * silently truncated list reads as complete — and so does one beside a list
   * whose check for more never came back.
   */
  truncation: Truncation;
  onRefresh: () => void;
  /**
   * The open session's items, used only to name the board tasks a ChildSession
   * covers. An empty list costs the panel nothing — every row still renders.
   * The panel memoizes this list, so the folds below hold across renders.
   */
  items: ReadonlyArray<TaskStreamItem>;
  /** Open a ChildSession in the workspace. */
  onOpen: (childSession: ChildSessionSummary) => void;
};

export function ChildSessionsView({
  sessionId,
  childSessions,
  isLoading,
  error,
  truncation,
  onRefresh,
  items,
  onOpen,
}: Props) {
  const collections = useMemo(() => groupCollections(items), [items]);
  const { byChildSession } = useMemo(
    () => linkChildSessionsToTasks(childSessions, collections),
    [childSessions, collections]
  );

  // No rows AND an error means the read never landed, so the list is UNKNOWN
  // rather than empty. Derived from what is already here rather than tracking a
  // "has completed a read" flag: an error with rows behind it is a failed
  // RE-read, where the rows on screen are still the best answer we have.
  //
  // This is the same defect as the first-page truncation, wearing a third face
  // — the panel stating less than it knows. A confident "no background work" is
  // the most expensive thing this surface can say wrongly, because it ends the
  // search.
  const unknown = error !== null && childSessions.length === 0;

  if (sessionId === null) {
    return <EmptyState message="Select a session to see the work running behind it." />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2">
        <span className="text-[10px] uppercase tracking-wide text-slate-500">
          {unknown ? (
            "children unknown"
          ) : (
            <>
              {childSessions.length} child session{childSessions.length === 1 ? "" : "s"}
              {truncation !== "complete" && " (first)"}
            </>
          )}
        </span>
        <Button
          variant="outline"
          size="xs"
          onClick={onRefresh}
          disabled={isLoading}
        >
          {isLoading ? "Loading…" : "Refresh"}
        </Button>
      </div>

      {error !== null && (
        <p className="px-3 py-2 text-xs text-red-400">{error}</p>
      )}

      {truncation === "more" && (
        <p className="px-3 py-2 text-[11px] text-amber-400">
          Showing the first {childSessions.length} childSessions. This session has
          more background work than the panel reads in one go.
        </p>
      )}

      {truncation === "unknown" && (
        <p className="px-3 py-2 text-[11px] text-amber-400">
          Showing {childSessions.length} childSessions. Checking whether there are
          more didn't come back, so there may be others not listed here.
        </p>
      )}

      {childSessions.length === 0 ? (
        <EmptyState
          icon={<Layers className="h-8 w-8" aria-hidden />}
          message={
            isLoading
              ? "Loading childSessions…"
              : unknown
                ? "This session's background work could not be read, so the list is unknown rather than empty. Refresh to try again."
                : "No background work in this session. A task board seat that dispatches its rows to a `task` entry runs them in a child session, and it shows up here once the board hands a row off."
          }
        />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-left text-[10px] uppercase tracking-wide text-slate-500">
                <th className="px-3 py-1.5 font-medium">Key</th>
                <th className="py-1.5 font-medium">Entry</th>
                <th className="py-1.5 font-medium">Tasks</th>
                <th className="py-1.5 font-medium">Status</th>
                <th className="py-1.5 font-medium">Updated</th>
                <th className="px-3 py-1.5 font-medium text-right">Session</th>
              </tr>
            </thead>
            <tbody>
              {childSessions.map((childSession) => (
                <ChildSessionRow
                  key={childSession.id}
                  childSession={childSession}
                  tasks={byChildSession.get(childSession.id) ?? []}
                  onOpen={() => onOpen(childSession)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ChildSessionRow({
  childSession,
  tasks,
  onOpen,
}: {
  childSession: ChildSessionSummary;
  tasks: readonly LinkedTask[];
  onOpen: () => void;
}) {
  const key = decodeChildSessionKey(childSession.topic);
  const entry = decodeChildSessionEntry(childSession.coordinate);

  return (
    <tr
      className="cursor-pointer border-b border-slate-800/50 align-top hover:bg-slate-900/40"
      onClick={onOpen}
    >
      <td className="px-3 py-1.5 text-slate-200">
        {/* A record written before the labels existed, or one started by
            something that stamped none, has no name to show — the id below is
            still the whole address, so this is a missing label and not a
            missing row. A key that is not a board's preset (a flow-computed
            `{ key }`, another dispatcher's) is shown as written: it is the
            flow's own name for the work. */}
        {childSession.topic == null ? (
          <span className="italic text-slate-500">unlabelled</span>
        ) : key === null ? (
          childSession.topic
        ) : (
          <span className="font-mono text-[10px]">
            <span className="text-slate-500">{key.policy === "per-task" ? "task " : "seat "}</span>
            <span>{key.policy === "per-task" ? key.taskId : key.seat}</span>
            <span className="text-slate-500"> on </span>
            <span>{key.boardId}</span>
          </span>
        )}
      </td>
      <td className="py-1.5 pr-2 text-slate-400">
        {entry === null ? (
          // Either no coordinate at all (a record from before the label
          // existed) or one some other writer put there — show it raw rather
          // than nothing.
          <span className="font-mono text-[10px] text-slate-600">
            {childSession.coordinate ?? "—"}
          </span>
        ) : (
          <span className="font-mono text-[10px]" title={`${entry.type} entry`}>
            {entry.target}
          </span>
        )}
      </td>
      <td className="py-1.5 pr-2 text-slate-400">
        {tasks.length === 0 ? (
          // The ordinary case for a ChildSession nobody's board addressed, and
          // also for one whose board ran in an earlier request this session's
          // item stream no longer carries.
          <span className="text-slate-600">—</span>
        ) : (
          <span className="font-mono text-[10px] text-slate-300">
            {tasks.map((linked) => linked.task.id).join(", ")}
          </span>
        )}
      </td>
      <td className="py-1.5 pr-2">
        {childSession.status == null ? (
          // Absence is not a status. The work exists and has run nothing.
          // `== null` for the same reason `topic` and `coordinate` use it: a
          // store that nulls absent keys hands back `null` where an older
          // record has `undefined`, and both mean "no run yet" (BP-030). A
          // strict `undefined` check renders `null` as an empty badge.
          <span className="text-[10px] italic text-slate-500">not started</span>
        ) : (
          <StatusBadge status={childSession.status} />
        )}
      </td>
      <td className="py-1.5 pr-2 text-[11px] text-slate-500">
        {new Date(childSession.updatedAt).toLocaleString()}
      </td>
      <td className="px-3 py-1.5 text-right">
        {/* The real control. The row's own onClick is a pointer convenience on
            top of this — a clickable `<tr>` is not focusable, takes no Enter,
            and announces nothing, so the tab's primary action has to live in a
            native button to be reachable at all without a mouse. */}
        <button
          type="button"
          onClick={(event) => {
            // The row handler would otherwise fire this a second time.
            event.stopPropagation();
            onOpen();
          }}
          title={`Open child session ${childSession.id}`}
          // The visible label is a SHORTENED id, which on its own names nothing
          // a screen reader user can act on. The full id is the whole address.
          aria-label={`Open child session ${childSession.id}`}
          className="inline-flex items-center gap-1 rounded font-mono text-[10px] text-slate-400 hover:text-slate-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-sky-400"
        >
          {shortSessionId(childSession.id)}
          <ArrowRight className="h-3 w-3" aria-hidden />
        </button>
      </td>
    </tr>
  );
}
