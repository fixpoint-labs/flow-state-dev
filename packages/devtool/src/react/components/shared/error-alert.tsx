import { AlertCircle } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

type ErrorAlertProps = {
  message: string;
  onRetry?: () => void;
  className?: string;
};

export function ErrorAlert({ message, onRetry, className }: ErrorAlertProps) {
  return (
    <div className={cn("flex items-center gap-2 rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-xs text-red-400", className)}>
      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{message}</span>
      {onRetry && (
        <Button variant="outline" size="sm" className="h-6 px-2 text-[10px]" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
