import type { SessionSummary } from "@flow-state-dev/client";
import { cn } from "@/lib/utils";

type SessionRowProps = {
  session: SessionSummary;
  isActive: boolean;
  onSelect: () => void;
};

export function SessionRow({ session, isActive, onSelect }: SessionRowProps) {
  const truncatedId = session.id.length > 12 ? session.id.slice(0, 12) + "..." : session.id;
  const created = new Date(session.createdAt).toLocaleTimeString();

  return (
    <button
      className={cn(
        "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-xs",
        isActive ? "bg-slate-800 text-slate-200" : "text-slate-400 hover:bg-slate-800/40",
      )}
      onClick={onSelect}
    >
      <span className="font-mono truncate flex-1">{truncatedId}</span>
      <span className="text-[10px] text-slate-600 shrink-0">{created}</span>
    </button>
  );
}
