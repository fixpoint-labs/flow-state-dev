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
    <div className={cn("flex items-center gap-2 border border-fs-red/60 bg-fs-red/5 px-3 py-2 text-xs text-fs-red", className)}>
      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      <span className="flex-1 truncate">{message}</span>
      {onRetry && (
        <Button variant="outline" size="sm" className="h-6 px-2 font-fs-mono text-[10px]" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
