import { cn } from "../../lib/utils";

type EmptyStateProps = {
  icon?: React.ReactNode;
  message: string;
  className?: string;
};

export function EmptyState({ icon, message, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 p-8 text-center", className)}>
      {icon && <div className="text-slate-600">{icon}</div>}
      <p className="text-sm text-slate-500">{message}</p>
    </div>
  );
}
