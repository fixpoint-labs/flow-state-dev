"use client";

/**
 * The line a turn that didn't finish leaves in a thread: a failed turn's
 * reason with a Retry, or a turn a restart cut off with Continue and Discard.
 *
 * Plain props, not a session: an app passes the reason it holds (an
 * `ErrorItem`'s `message`, `code` and `details` spread straight in) and, for
 * the request the server will retry, an `onRetry`. The server retries only a
 * session's latest `failed` or `interrupted` request, so pass `onRetry` for
 * that one and leave it off older lines; without it no button is drawn. Wire
 * it to `client.flow(f).request(id).retry()` or `useSession().resumeLatestRequest()`.
 *
 * Pass `onContinue` or `onDiscard` for a turn a restart cut off (an
 * `interrupted` request, as `client.requests.interrupted()` lists it) and the
 * line reads as interrupted instead: Continue carries the same request on
 * (`request(id).continue()`), Discard ends it (`request(id).abort()`). Retry is
 * not drawn on that line: it would start a second request beside the lost one.
 */

import { useState, type ReactNode } from "react";
import { AlertCircle, CirclePause, Play, RotateCcw, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ErrorBody, type ErrorBodyProps } from "./error";

/** What the interrupted line says when the app passes no reason of its own. */
export const INTERRUPTED_REASON = "This turn was cut off before it finished.";

type Action = () => Promise<unknown>;

type CommonProps = {
  /** Who was working: a worker's name, "Assistant". Shown before the reason. */
  who?: string;
  className?: string;
};

/** A failed turn: its reason, and a Retry when the server will retry it. */
export type FailedRequestProps = CommonProps & {
  /** Why the turn failed: the error's message. */
  reason: string;
  code?: ErrorBodyProps["code"];
  details?: ErrorBodyProps["details"];
  /** Start the request again. Omit it for a request the server won't retry. */
  onRetry?: Action;
  onContinue?: undefined;
  onDiscard?: undefined;
};

/** A turn a restart cut off: Continue, Discard, or both. Retry is not drawn on it. */
export type InterruptedRequestProps = CommonProps & {
  /** Replaces {@link INTERRUPTED_REASON}. */
  reason?: string;
  code?: undefined;
  details?: undefined;
  onRetry?: Action;
} & (
    | {
        /** Carry an interrupted request on under its own id. */
        onContinue: Action;
        /** End an interrupted request for good. */
        onDiscard?: Action;
      }
    | { onContinue?: undefined; onDiscard: Action }
  );

export type RequestRecoveryProps = FailedRequestProps | InterruptedRequestProps;

export function RequestRecovery({
  reason,
  code,
  details,
  who,
  onRetry,
  onContinue,
  onDiscard,
  className
}: RequestRecoveryProps) {
  const [refused, setRefused] = useState<string | null>(null);
  /** The action running now, by its idle word; every button waits while one runs. */
  const [busy, setBusy] = useState<string | null>(null);
  const interrupted = onContinue !== undefined || onDiscard !== undefined;

  /** One action at a time: each button is disabled while any runs, and a refusal says which. */
  const run = (label: string, action: Action) => async () => {
    setBusy(label);
    setRefused(null);
    try {
      await action();
    } catch (error) {
      setRefused(`${label} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  };

  const buttons: ReactNode[] = [];
  const button = (key: string, idle: string, working: string, icon: ReactNode, action: Action) => {
    buttons.push(
      <Button key={key} variant="outline" size="sm" disabled={busy !== null} onClick={run(idle, action)}>
        {icon}
        {busy === idle ? working : idle}
      </Button>
    );
  };
  if (interrupted) {
    if (onContinue) button("continue", "Continue", "Continuing…", <Play className="h-3.5 w-3.5" />, onContinue);
    if (onDiscard) button("discard", "Discard", "Discarding…", <X className="h-3.5 w-3.5" />, onDiscard);
  } else if (onRetry) {
    button("retry", "Retry", "Retrying…", <RotateCcw className="h-3.5 w-3.5" />, onRetry);
  }

  return (
    <div
      role="alert"
      data-testid="request-recovery"
      data-state={interrupted ? "interrupted" : "failed"}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-4 py-3 text-sm",
        interrupted
          ? "border-attention bg-attention text-attention-foreground"
          : "border-destructive/40 bg-destructive/10 text-destructive",
        className
      )}
    >
      {interrupted ? (
        <CirclePause className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {who && (
          <span className="font-medium">
            {interrupted ? `${who}'s turn was cut off` : `${who} couldn't finish this turn`}
          </span>
        )}
        {interrupted ? (
          <span>{reason ?? INTERRUPTED_REASON}</span>
        ) : (
          <ErrorBody message={reason ?? ""} code={code} details={details} />
        )}
        {refused && <span className="text-xs">{refused}</span>}
      </div>
      {buttons.length > 0 && <div className="flex shrink-0 gap-2">{buttons}</div>}
    </div>
  );
}

