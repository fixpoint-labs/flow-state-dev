import { cn } from "../../lib/utils";

type EmptyStateProps = {
  icon?: React.ReactNode;
  message: string;
  className?: string;
};

export function EmptyState({ icon, message, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 p-8 text-center", className)}>
      {icon && <div className="text-fs-ink4">{icon}</div>}
      <p className="text-[13px] text-fs-ink3">{message}</p>
    </div>
  );
}
