import { Play, SkipForward, RefreshCw } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";

type RequestSeparatorProps = {
  requestId: string;
  action: string;
  status: string;
  duration?: number;
  isActive?: boolean;
  onReplayFull?: () => void;
  onReplayFromCursor?: () => void;
  onReconnect?: () => void;
};

function formatDuration(ms?: number, isActive?: boolean): string {
  if (ms === undefined || ms === null) return isActive ? "0.0s..." : "";
  const seconds = ms / 1000;
  return isActive ? `${seconds.toFixed(1)}s...` : `${seconds.toFixed(1)}s`;
}

export function RequestSeparator({
  requestId,
  action,
  status,
  duration,
  isActive,
  onReplayFull,
  onReplayFromCursor,
  onReconnect,
}: RequestSeparatorProps) {
  const shortId = requestId.length > 10 ? requestId.slice(0, 10) : requestId;
  const showReplayControls = status === "completed" || status === "failed";

  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-y border-slate-800/50 bg-slate-950/90 backdrop-blur px-3 py-1.5">
      <span className="text-[10px] font-mono text-slate-600">{shortId}</span>
      <span className="text-[10px] text-slate-700">·</span>
      <span className="text-xs text-slate-300">{action}</span>
      <span className="text-[10px] text-slate-700">·</span>
      <StatusBadge status={status} />
      <span className="text-[10px] text-slate-500 font-mono">
        {formatDuration(duration, isActive)}
      </span>
      <span className="flex-1" />
      {showReplayControls && (
        <div className="flex items-center gap-0.5">
          {onReplayFull && (
            <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] text-slate-500" onClick={onReplayFull} title="Replay from beginning">
              <Play className="h-3 w-3 mr-0.5" /> Replay
            </Button>
          )}
          {onReplayFromCursor && (
            <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] text-slate-500" onClick={onReplayFromCursor} title="Replay from cursor">
              <SkipForward className="h-3 w-3 mr-0.5" /> Cursor
            </Button>
          )}
          {onReconnect && (
            <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] text-slate-500" onClick={onReconnect} title="Simulate reconnect">
              <RefreshCw className="h-3 w-3 mr-0.5" /> Reconnect
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
