/**
 * Root of the DevTool's privileged debug Resources panel.
 *
 * Hits `/debug/resources` via `useDebugResources` and dispatches to the tree.
 * Handles the off-by-default 403 case with a dedicated notice — the debug
 * surface is opt-in (`FSDEV_DEBUG_ENDPOINTS=1`), and showing a generic error
 * would mislead developers who simply haven't flipped the gate.
 *
 * Auto-refresh: the parent bumps `refreshKey` when state-shaped items arrive
 * over the request stream (state_change / resource_change). We re-fetch the
 * tree and bump an internal counter that propagates down to any expanded
 * collections so their item lists reload in step.
 */
import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { ErrorAlert } from "../shared/error-alert";
import { useDebugResources } from "../../hooks/use-debug-resources";
import { ResourcesTree } from "./resources-tree";

type ResourcesPanelProps = {
  sessionId: string;
  /** Bump to trigger an external refresh (e.g., when streaming activity changes server state). */
  refreshKey?: number;
};

export function ResourcesPanel({ sessionId, refreshKey }: ResourcesPanelProps) {
  const { data, isLoading, error, refresh, disabled } = useDebugResources(sessionId);

  // Internal counter that ticks every time we re-fetch — manual refresh OR
  // parent-driven. Expanded collection bodies key off this so their items
  // refetch alongside the parent tree.
  const [reloadTick, setReloadTick] = useState(0);

  const reload = useCallback(async () => {
    await refresh();
    setReloadTick((n) => n + 1);
  }, [refresh]);

  // Re-fetch when the parent signals a state mutation.
  useEffect(() => {
    if (refreshKey && refreshKey > 0) void reload();
  }, [refreshKey, reload]);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-fs-mono text-[10px] font-medium uppercase tracking-[.14em] text-fs-ink3">
          Resources
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={reload}
          title="Refresh debug resources"
          disabled={disabled}
        >
          <RefreshCw className={`h-3 w-3 text-fs-ink3 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {disabled ? (
        <DebugDisabledNotice />
      ) : error ? (
        <ErrorAlert message={error} onRetry={reload} />
      ) : isLoading && !data ? (
        <div className="space-y-2 p-2">
          <div className="h-6 animate-pulse bg-fs-ink/8" />
          <div className="h-20 animate-pulse bg-fs-ink/8" />
        </div>
      ) : data ? (
        <ResourcesTree sessionId={sessionId} resources={data.resources} reloadTick={reloadTick} />
      ) : null}
    </div>
  );
}

/**
 * Co-located notice for the 403 / "debug surface disabled" case. Kept next
 * to the panel because it has no other consumer and keeps the file count
 * down. Move to its own file if a second consumer appears.
 */
function DebugDisabledNotice() {
  return (
    <div className="border border-dashed border-fs-ink/45 bg-fs-card px-3 py-2 text-[11px] text-fs-ink3">
      <div className="mb-1 font-medium text-fs-ink">Debug endpoints disabled</div>
      <p className="text-[11px] leading-relaxed text-fs-ink3">
        The privileged debug surface is off. To enable it for local development, set{" "}
        <code className="border border-fs-ink/20 bg-fs-paper px-1 font-fs-mono text-[10px] text-fs-ink2">
          FSDEV_DEBUG_ENDPOINTS=1
        </code>{" "}
        on the server (or pass{" "}
        <code className="border border-fs-ink/20 bg-fs-paper px-1 font-fs-mono text-[10px] text-fs-ink2">
          debugEndpointsEnabled: true
        </code>
        ) and ensure your DevTool origin is allowed. The non-debug Client Data
        section above remains available.
      </p>
    </div>
  );
}
