"use client";

/**
 * Background work — the conversation's workstreams, shown as their own thing.
 *
 * A workstream is a child session: work the conversation started that outlives
 * the turn which started it. Its output never lands in the transcript, so this
 * panel sits outside the conversation rather than inside it, and clicking a row
 * opens that workstream's own history in a dialog.
 *
 * Three details the hook's contract forces, and they are the reason this is a
 * component rather than a `.map()` at the call site:
 *
 * - **The list does not update on its own.** It is re-read on mount, at the
 *   start of each action, and on `session.refresh()`. On its own that hides the
 *   *first* job until the user does something else, so this re-reads once when
 *   a turn stops streaming — one read per turn, not a poll.
 * - **`workstreamsStale` means "this is the last list we could get".** The rows
 *   stay on screen and get marked, rather than disappearing.
 * - **`status` is absent until something has run**, and `"active"` means only
 *   *not finished*. Neither is rendered as "running".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ItemsRenderer, useSession } from "@flow-state-dev/react";
import type { WorkstreamSummary } from "@flow-state-dev/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ChevronRight, Hourglass, RotateCw } from "lucide-react";

/** Label for a workstream row. `topic` is display-only and may be absent (BP-030). */
function rowLabel(work: WorkstreamSummary): string {
  return work.topic ?? "Background work";
}

/**
 * Human wording for a row's status.
 *
 * `undefined` and `"active"` are different facts and are worded differently:
 * nothing has run yet, versus it has not finished. Unknown values render as
 * themselves — the set is open and switching exhaustively over it would break
 * on the next one.
 */
function statusLabel(status: WorkstreamSummary["status"]): string {
  if (status == null) return "not started";
  if (status === "active") return "not finished";
  return status;
}

function statusTone(status: WorkstreamSummary["status"]): string {
  if (status === "completed") return "text-emerald-600 dark:text-emerald-400";
  if (status === "failed" || status === "aborted") return "text-destructive";
  return "text-muted-foreground";
}

interface BackgroundWorkPanelProps {
  session: ReturnType<typeof useSession>;
  /**
   * The conversation's flow kind — passed straight through to the detail view.
   * Background work runs on its parent flow's worker core, so a workstream is
   * stamped with the parent's kind rather than one of its own.
   */
  flowKind: string;
}

/** The strip above the prompt input: one row per body of background work. */
export function BackgroundWorkPanel({ session, flowKind }: BackgroundWorkPanelProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { workstreams, workstreamsStale, refresh, isStreaming } = session;

  // One re-read per finished turn. Without it the job a turn just filed stays
  // invisible until the user sends another message, because the hook's own
  // re-read happens at the START of an action. Guarded on the actual
  // true → false transition, so a re-render never triggers a second read.
  //
  // **Demo debt — do not copy this into an application.** The Workstream axis
  // has a pinned read budget: ONE `listWorkstreams` read per turn, taken by
  // `useSession` at action start. That budget is a contract
  // (`docs/architecture/server-and-client.md`), and it is why the DevTool's own
  // panel reads one page plus a sentinel instead of walking the index. This
  // effect adds a second read at stream end, which doubles the axis read for
  // every turn on this page — the price paid here for the first filed job
  // being visible without further user action.
  //
  // The intended fix is a framework opt-in rather than an app-level effect:
  // `useSession` grows an explicit `workstreams: { refreshOnTerminal: true }`,
  // refreshing from the terminal branch it already has, so the pinned budget
  // stays the default and the second read becomes a named choice. Until that
  // lands, this is a reference demo teaching a pattern it should not — hence
  // the comment rather than the silence.
  const wasStreaming = useRef(isStreaming);
  useEffect(() => {
    const finished = wasStreaming.current && !isStreaming;
    wasStreaming.current = isStreaming;
    if (finished) void refresh();
  }, [isStreaming, refresh]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [refresh]);

  if (workstreams.length === 0 && !workstreamsStale) return null;

  const openRow = workstreams.find((work) => work.id === openId) ?? null;

  return (
    <div className="mx-auto max-w-3xl px-3 pt-2 sm:px-4" data-testid="background-work-panel">
      <div className="rounded-md border border-indigo-500/40 bg-indigo-500/5">
        <div className="flex items-center gap-2 px-3 py-2">
          <Hourglass className="size-3.5 text-indigo-500 dark:text-indigo-400" />
          <span className="text-xs font-medium">Background work</span>
          <span className="text-xs text-muted-foreground">{workstreams.length}</span>
          {workstreamsStale && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              may be out of date
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto h-6 gap-1 px-2 text-xs"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
          >
            <RotateCw className={cn("size-3", isRefreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>

        <ul className="border-t border-indigo-500/20">
          {workstreams.map((work) => (
            <li key={work.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-indigo-500/10"
                onClick={() => setOpenId(work.id)}
                data-testid="background-work-row"
              >
                <span className="min-w-0 flex-1 truncate">{rowLabel(work)}</span>
                {work.coordinate !== undefined && (
                  <span className="hidden truncate text-muted-foreground sm:inline">
                    {work.coordinate}
                  </span>
                )}
                <span className={statusTone(work.status)}>{statusLabel(work.status)}</span>
                <ChevronRight className="size-3 shrink-0 opacity-50" />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <Dialog open={openRow !== null} onOpenChange={(open) => !open && setOpenId(null)}>
        <DialogContent className="flex h-[80vh] max-w-3xl flex-col">
          <DialogTitle className="text-sm">
            {openRow === null ? "Background work" : rowLabel(openRow)}
          </DialogTitle>
          <DialogDescription className="text-xs">
            A workstream of its own — nothing here is part of the conversation.
          </DialogDescription>
          {openRow !== null && (
            <BackgroundWorkDetail workstreamId={openRow.id} flowKind={flowKind} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * One workstream's history.
 *
 * A workstream IS a session, so the same hook reads it — with the **parent
 * conversation's** flow kind, because that is what the child is stamped with.
 * `autoResume` matters: without it this loads one snapshot and never fills in
 * while the work keeps going.
 *
 * Completed steps appear as the work finishes them. A detached generator does
 * not stream in-flight text, so nothing here types itself out.
 *
 * Rendered with `ItemsRenderer` rather than the conversation's
 * `RequestGroupRenderer`: that one hides task-attributed items, on the
 * assumption they will reappear under a task plan in the same view. In a
 * Workstream the task-attributed items ARE the content and there is no task
 * plan beside them, so hiding them would leave the panel empty.
 */
function BackgroundWorkDetail({
  workstreamId,
  flowKind,
}: {
  workstreamId: string;
  flowKind: string;
}) {
  const work = useSession(workstreamId, { flowKind, items: true, autoResume: true });

  return (
    <ScrollArea className="min-h-0 flex-1 pr-3">
      {work.items.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          {work.isLoading ? "Loading…" : "Nothing has been recorded yet."}
        </p>
      ) : (
        <ItemsRenderer items={work.items} />
      )}
    </ScrollArea>
  );
}
