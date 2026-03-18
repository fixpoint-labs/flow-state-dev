import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type RequestStatusLabel = "completed" | "in_progress" | "finishing" | "failed" | "incomplete" | "created";

const statusStyles: Record<RequestStatusLabel, string> = {
  completed: "bg-green-900/40 text-green-400 border-green-800",
  in_progress: "bg-amber-900/40 text-amber-400 border-amber-800",
  finishing: "bg-blue-900/40 text-blue-400 border-blue-800",
  failed: "bg-red-900/40 text-red-400 border-red-800",
  incomplete: "bg-slate-800 text-slate-400 border-slate-700",
  created: "bg-slate-800 text-slate-400 border-slate-700",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", statusStyles[status as RequestStatusLabel] ?? statusStyles.created, className)}>
      {status}
    </Badge>
  );
}
