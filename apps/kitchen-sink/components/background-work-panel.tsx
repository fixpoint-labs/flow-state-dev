"use client";

/**
 * Background work — the conversation's child sessions, shown as their own thing.
 *
 * A child session is a session of its own: work the conversation started that
 * outlives the turn which started it. Its output never lands in the transcript,
 * so this panel sits outside the conversation rather than inside it, and
 * clicking a row opens that child session's own history in a dialog.
 *
 * Three details the hook's contract forces, and they are the reason this is a
 * component rather than a `.map()` at the call site:
 *
 * - **The list does not update on its own.** It is re-read on mount, at the
 *   start of each action, and on `session.refresh()`. On its own that hides the
 *   *first* job until the user does something else, so a sibling component —
 *   {@link BackgroundWorkRefresh}, mounted once at the page level — re-reads
 *   when a turn stops streaming. It is not in this component on purpose; see
 *   its own doc for why a duplicated responsive tree makes that matter.
 * - **`childrenStale` means "this is the last list we could get".** The rows
 *   stay on screen and get marked, rather than disappearing.
 * - **`status` is absent until something has run**, and `"active"` means only
 *   *not finished*. Neither is rendered as "running".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { ItemsRenderer, useSession } from "@flow-state-dev/react";
import type { ChildSessionSummary } from "@flow-state-dev/client";
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

/** Label for a child-session row. `topic` is display-only and may be absent (BP-030). */
function rowLabel(child: ChildSessionSummary): string {
  return child.topic ?? "Background work";
}

/**
 * Human wording for a row's status.
 *
 * `undefined` and `"active"` are different facts and are worded differently:
 * nothing has run yet, versus it has not finished. Unknown values render as
 * themselves — the set is open and switching exhaustively over it would break
 * on the next one.
 */
function statusLabel(status: ChildSessionSummary["status"]): string {
  if (status == null) return "not started";
  if (status === "active") return "not finished";
  return status;
}

function statusTone(status: ChildSessionSummary["status"]): string {
  if (status === "completed") return "text-emerald-600 dark:text-emerald-400";
  if (status === "failed" || status === "aborted") return "text-destructive";
  return "text-muted-foreground";
}

interface BackgroundWorkPanelProps {
  session: ReturnType<typeof useSession>;
  /**
   * The conversation's flow kind — passed straight through to the detail view.
   * Background work runs on its parent flow's worker core, so a child session
   * is stamped with the parent's kind rather than one of its own.
   */
  flowKind: string;
}

/** The strip above the prompt input: one row per body of background work. */
/**
 * The stream-end re-read, as a component so it is mounted EXACTLY ONCE.
 *
 * Deliberately separate from {@link BackgroundWorkPanel}. The page keeps a
 * mobile and a desktop `ChatPanel` tree alive at the same time and hides one
 * with responsive CSS, so anything rendered inside a `ChatPanel` is mounted
 * twice and every effect in it runs twice. With the effect living in the panel
 * that meant two reads per finished turn, not one — a cost that is invisible
 * from the panel's own source and contradicts what the comment below claims.
 * Rendering the panel twice is harmless (both read the same hook state); firing
 * its side effect twice is not. Mount this once, above those trees.
 *
 * Without it the job a turn just filed stays invisible until the user sends
 * another message, because the hook's own re-read happens at the START of an
 * action. Guarded on the actual true → false transition, so a re-render never
 * triggers a second read.
 *
 * **Demo debt — do not copy this into an application.** The children axis has
 * a pinned read budget: ONE `listChildSessions` read per turn, taken by
 * `useSession` at action start. That budget is a contract
 * (`docs/architecture/server-and-client.md`), and it is why the DevTool's own
 * panel reads one page plus a sentinel instead of walking the index.
 *
 * What this actually costs, stated plainly because it was understated twice:
 * `session.refresh()` is a **full session snapshot plus** the children read,
 * and with `items: true` the snapshot paginates the entire item history. It is
 * not one extra list read. The gate below at least confines that to
 * conversations which use background work at all.
 *
 * The intended fix is a framework opt-in rather than an app-level effect,
 * tracked as **FIX-1109**: `useSession` grows an explicit
 * `children: { refreshOnTerminal: true }`, refreshing from the terminal
 * branch it already has (`onRequestStatus`), so the pinned budget stays the
 * default and the second read becomes a named choice. When FIX-1109 lands,
 * delete this component and pass that option instead.
 */
export function BackgroundWorkRefresh({ session }: { session: BackgroundWorkPanelProps["session"] }) {
  const { refresh, isStreaming, items, children } = session;

  // Only conversations that actually use background work pay for this. The
  // gate matters because `session.refresh()` is NOT the cheap read this was
  // originally documented as: it is `Promise.all([refreshSnapshot(),
  // refreshChildSessions()])`, and with `items: true` the snapshot paginates the
  // session's entire item history. Ungated, every finished turn in every
  // conversation — the overwhelming majority of which never file a job — paid
  // a full history refetch to update a panel with nothing in it.
  //
  // `useSession` exposes no children-only refresh (`refreshChildSessions` is
  // internal), which is exactly the gap FIX-1109 closes. Until it lands this
  // gate is the whole of the mitigation available to an app.
  //
  // Detected from `task-board-meta`, the same signal `lib/item-inference.ts`
  // uses, and NOT from `task-change` — this board declares those invisible to
  // the client on purpose (see `backgroundWorkLedger`).
  const usesBackgroundWork =
    children.length > 0 ||
    items.some(
      (item) =>
        item.type === "component" &&
        (item as { component?: string }).component === "task-board-meta" &&
        (item as { data?: { collectionId?: string } }).data?.collectionId ===
          "background-work",
    );

  const wasStreaming = useRef(isStreaming);
  useEffect(() => {
    const finished = wasStreaming.current && !isStreaming;
    wasStreaming.current = isStreaming;
    if (finished && usesBackgroundWork) void refresh();
  }, [isStreaming, refresh, usesBackgroundWork]);
  return null;
}

export function BackgroundWorkPanel({ session, flowKind }: BackgroundWorkPanelProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { children, childrenStale, refresh } = session;

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await refresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [refresh]);

  if (children.length === 0 && !childrenStale) return null;

  const openRow = children.find((child) => child.id === openId) ?? null;

  return (
    <div className="mx-auto max-w-3xl px-3 pt-2 sm:px-4" data-testid="background-work-panel">
      <div className="rounded-md border border-indigo-500/40 bg-indigo-500/5">
        <div className="flex items-center gap-2 px-3 py-2">
          <Hourglass className="size-3.5 text-indigo-500 dark:text-indigo-400" />
          <span className="text-xs font-medium">Background work</span>
          <span className="text-xs text-muted-foreground">{children.length}</span>
          {childrenStale && (
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
          {children.map((child) => (
            <li key={child.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-indigo-500/10"
                onClick={() => setOpenId(child.id)}
                data-testid="background-work-row"
              >
                <span className="min-w-0 flex-1 truncate">{rowLabel(child)}</span>
                {child.coordinate !== undefined && (
                  <span className="hidden truncate text-muted-foreground sm:inline">
                    {child.coordinate}
                  </span>
                )}
                <span className={statusTone(child.status)}>{statusLabel(child.status)}</span>
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
            A child session of its own — nothing here is part of the conversation.
          </DialogDescription>
          {openRow !== null && (
            <BackgroundWorkDetail childSessionId={openRow.id} flowKind={flowKind} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * One child session's history.
 *
 * A child session IS a session, so the same hook reads it — with the **parent
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
 * child session the task-attributed items ARE the content and there is no task
 * plan beside them, so hiding them would leave the panel empty.
 */
function BackgroundWorkDetail({
  childSessionId,
  flowKind,
}: {
  childSessionId: string;
  flowKind: string;
}) {
  const childSession = useSession(childSessionId, { flowKind, items: true, autoResume: true });

  return (
    <ScrollArea className="min-h-0 flex-1 pr-3">
      {childSession.items.length === 0 ? (
        <p className="py-6 text-center text-xs text-muted-foreground">
          {childSession.isLoading ? "Loading…" : "Nothing has been recorded yet."}
        </p>
      ) : (
        <ItemsRenderer items={childSession.items} />
      )}
    </ScrollArea>
  );
}
