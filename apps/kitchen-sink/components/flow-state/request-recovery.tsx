"use client";

/**
 * The line a failed turn leaves in a thread: who hit it, why, and a Retry.
 *
 * Plain props, not a session: an app passes the reason it holds (an
 * `ErrorItem`'s `message`, `code` and `details` spread straight in) and, for
 * the request the server will retry, an `onRetry`. The server retries only a
 * session's latest `failed` or `interrupted` request, so pass `onRetry` for
 * that one and leave it off older lines; without it no button is drawn. Wire
 * it to `client.flow(f).request(id).retry()` or `useSession().resumeLatestRequest()`.
 */

import { useState } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ErrorBody, type ErrorBodyProps } from "./error";

export type RequestRecoveryProps = {
  /** Why the turn failed: the error's message. */
  reason: string;
  code?: ErrorBodyProps["code"];
  details?: ErrorBodyProps["details"];
  /** Who was working when it failed, shown before the reason (a worker's name, "Assistant"). */
  who?: string;
  /** Start the request again. Omit it for a request the server won't retry. */
  onRetry?: () => Promise<unknown>;
  className?: string;
};

export function RequestRecovery({ reason, code, details, who, onRetry, className }: RequestRecoveryProps) {
  const [isRetrying, setIsRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const handleRetry = async () => {
    if (!onRetry) return;
    setIsRetrying(true);
    setRetryError(null);
    try {
      await onRetry();
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div
      role="alert"
      data-testid="request-recovery"
      className={cn(
        "flex items-start gap-2 rounded-lg border px-4 py-3 text-sm",
        "border-destructive/40 bg-destructive/10 text-destructive",
        className
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {who && <span className="font-medium">{who} couldn't finish this turn</span>}
        <ErrorBody message={reason} code={code} details={details} />
        {retryError && <span className="text-xs">Retry failed: {retryError}</span>}
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={handleRetry} disabled={isRetrying}>
          <RotateCcw className="h-3.5 w-3.5" />
          {isRetrying ? "Retrying…" : "Retry"}
        </Button>
      )}
    </div>
  );
}
