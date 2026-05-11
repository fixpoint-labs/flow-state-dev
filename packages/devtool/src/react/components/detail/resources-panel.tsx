/**
 * Root of the DevTool's privileged debug Resources panel.
 *
 * Hits `/debug/resources` via `useDebugResources` and dispatches to the tree.
 * Handles the off-by-default 403 case with a dedicated notice — the debug
 * surface is opt-in (`FSDEV_DEBUG_ENDPOINTS=1`), and showing a generic error
 * would mislead developers who simply haven't flipped the gate.
 */
import { RefreshCw } from "lucide-react";
import { Button } from "../ui/button";
import { ErrorAlert } from "../shared/error-alert";
import { useDebugResources } from "../../hooks/use-debug-resources";
import { ResourcesTree } from "./resources-tree";

type ResourcesPanelProps = {
  sessionId: string;
};

export function ResourcesPanel({ sessionId }: ResourcesPanelProps) {
  const { data, isLoading, error, refresh, disabled } = useDebugResources(sessionId);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase text-slate-500">Resources (debug)</span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={refresh}
          title="Refresh debug resources"
          disabled={disabled}
        >
          <RefreshCw className={`h-3 w-3 text-slate-500 ${isLoading ? "animate-spin" : ""}`} />
        </Button>
      </div>
      {disabled ? (
        <DebugDisabledNotice />
      ) : error ? (
        <ErrorAlert message={error} onRetry={refresh} />
      ) : isLoading && !data ? (
        <div className="space-y-2 p-2">
          <div className="h-6 animate-pulse rounded bg-slate-800/50" />
          <div className="h-20 animate-pulse rounded bg-slate-800/50" />
        </div>
      ) : data ? (
        <ResourcesTree sessionId={sessionId} resources={data.resources} />
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
    <div className="rounded-md border border-slate-700/60 bg-slate-900/40 px-3 py-2 text-[11px] text-slate-400">
      <div className="mb-1 font-medium text-slate-300">Debug endpoints disabled</div>
      <p className="text-[11px] leading-relaxed text-slate-500">
        The privileged debug surface is off. To enable it for local development, set{" "}
        <code className="rounded bg-slate-800 px-1 font-mono text-[10px] text-slate-300">
          FSDEV_DEBUG_ENDPOINTS=1
        </code>{" "}
        on the server (or pass{" "}
        <code className="rounded bg-slate-800 px-1 font-mono text-[10px] text-slate-300">
          debugEndpointsEnabled: true
        </code>
        ) and ensure your DevTool origin is allowed. The non-debug Client Data
        section above remains available.
      </p>
    </div>
  );
}
