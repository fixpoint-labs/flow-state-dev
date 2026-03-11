import type { StreamStatus } from "@/hooks/use-request-stream";
import { cn } from "@/lib/utils";

const statusConfig: Record<StreamStatus, { dot: string; label: string; show: boolean }> = {
  idle: { dot: "", label: "", show: false },
  connecting: { dot: "bg-amber-400 animate-pulse", label: "Connecting...", show: true },
  streaming: { dot: "bg-green-400 animate-pulse", label: "Streaming", show: true },
  completed: { dot: "bg-green-400", label: "Completed", show: true },
  failed: { dot: "bg-red-400", label: "Failed", show: true },
  disconnected: { dot: "bg-slate-500", label: "Disconnected", show: true },
};

export function StreamStatusIndicator({ status }: { status: StreamStatus }) {
  const config = statusConfig[status];
  if (!config.show) return null;

  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("inline-block h-2 w-2 rounded-full", config.dot)} />
      <span className="text-[10px] text-slate-400">{config.label}</span>
    </div>
  );
}
