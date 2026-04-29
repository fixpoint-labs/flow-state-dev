/**
 * Simplified request header.
 * Shows: action name + status pill + duration.
 * Request ID and replay/cursor/reconnect controls behind overflow menu.
 */
import { useState } from "react";
import { MoreHorizontal, Play, SkipForward, RefreshCw } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { useDebug } from "@/context/debug-context";
import { formatTokenCount } from "@/lib/token-utils";

type RequestSeparatorProps = {
  requestId: string;
  action: string;
  status: string;
  duration?: number;
  isActive?: boolean;
  totalTokens?: number;
  /** Inbound transport that produced the request. Undefined for legacy data. */
  source?: string;
  onReplayFull?: () => void;
  onReplayFromCursor?: () => void;
  onReconnect?: () => void;
};

/**
 * Visual treatment per known transport source. Unknown values render as
 * a generic badge so custom transports still surface — the framework does
 * not police namespacing (FIX-438 §3.5).
 */
const SOURCE_LABELS: Record<string, { label: string; className: string }> = {
  mcp: { label: "MCP", className: "border-purple-700 text-purple-300" },
  webhook: { label: "Webhook", className: "border-amber-700 text-amber-300" },
  scheduled: { label: "Scheduled", className: "border-cyan-700 text-cyan-300" },
  notification: { label: "Notification", className: "border-fuchsia-700 text-fuchsia-300" }
};

function formatDuration(ms?: number, isActive?: boolean): string {
  if (ms === undefined || ms === null) return isActive ? "0.0s…" : "";
  const seconds = ms / 1000;
  return isActive ? `${seconds.toFixed(1)}s…` : `${seconds.toFixed(1)}s`;
}

export function RequestSeparator({
  requestId,
  action,
  status,
  duration,
  isActive,
  totalTokens,
  source,
  onReplayFull,
  onReplayFromCursor,
  onReconnect,
}: RequestSeparatorProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { isDebugMode } = useDebug();
  const showReplayControls = status === "completed" || status === "failed";
  const hasOverflow = showReplayControls || isDebugMode;
  const durationText = formatDuration(duration, isActive);

  return (
    <div className="sticky top-0 z-10 flex select-none items-center gap-2 border-b border-slate-800/40 bg-slate-950/95 backdrop-blur-sm px-4 py-1.5">
      <span className="text-xs font-medium text-slate-300">{action}</span>
      <StatusBadge status={status} />
      {source !== undefined && source !== "http" && (
        <span
          className={`rounded border px-1.5 py-0 text-[10px] font-medium ${
            SOURCE_LABELS[source]?.className ?? "border-slate-700 text-slate-400"
          }`}
          title={`Source: ${source}`}
        >
          {SOURCE_LABELS[source]?.label ?? source}
        </span>
      )}
      {durationText && (
        <span className="text-[11px] text-slate-500 font-mono tabular-nums">{durationText}</span>
      )}
      {totalTokens !== undefined && totalTokens > 0 && (
        <span className="text-[10px] text-slate-600 font-mono tabular-nums">
          {formatTokenCount(totalTokens)} tok
        </span>
      )}

      <span className="flex-1" />

      {isDebugMode && (
        <span className="text-[10px] font-mono text-slate-700">{requestId.slice(0, 10)}</span>
      )}

      {hasOverflow && (
        <div className="relative">
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-slate-600 hover:text-slate-400"
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            title="More actions"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>

          {menuOpen && (
            <>
              {/* Click-away backdrop */}
              <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full z-30 mt-1 min-w-[140px] rounded-md border border-slate-800 bg-slate-900 py-1 shadow-lg">
                {isDebugMode && (
                  <div className="px-3 py-1.5 text-[10px] font-mono text-slate-600 select-all border-b border-slate-800/50">
                    {requestId}
                  </div>
                )}
                {onReplayFull && (
                  <OverflowButton icon={<Play className="h-3 w-3" />} label="Replay" onClick={() => { setMenuOpen(false); onReplayFull(); }} />
                )}
                {onReplayFromCursor && (
                  <OverflowButton icon={<SkipForward className="h-3 w-3" />} label="From cursor" onClick={() => { setMenuOpen(false); onReplayFromCursor(); }} />
                )}
                {onReconnect && (
                  <OverflowButton icon={<RefreshCw className="h-3 w-3" />} label="Reconnect" onClick={() => { setMenuOpen(false); onReconnect(); }} />
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function OverflowButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}
