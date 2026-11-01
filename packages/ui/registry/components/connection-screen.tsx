"use client";

/**
 * The full-screen page an app shows when its first read fails, before there
 * is anything to keep on screen. After a first read lands, a later failure is
 * the connection banner's (`connection-banner`), not this page's.
 *
 * Two kinds. `refused`: the server answered and will not let the app in, so
 * there is no retry. `unreachable`: Retry, plus a retry on its own at 2, 4,
 * 8… seconds, capped at 30, so a server being started comes back without a
 * click.
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** What the failed read answered: an HTTP status when the server gave one. */
export type ConnectionFailure = { httpStatus?: number; message: string };

/** The delay before automatic retry `attempt` (0-based): 2s, doubling, capped at 30s. */
export function retryDelayMs(attempt: number): number {
  return Math.min(30_000, 2_000 * 2 ** attempt);
}

/**
 * @param kind `refused` draws no retry; `unreachable` retries.
 * @param title The heading, in the app's words.
 * @param children What the person should check, in the app's words.
 * @param failure What the server answered, drawn as `<status> · <message>`.
 * @param onRetry Read again. Required for `unreachable`. Return the read's
 *   promise and the next wait starts once it settles. The screen keeps one
 *   schedule however often the parent re-renders it, and a click on Retry
 *   reads at once and restarts the wait.
 */
export function ConnectionScreen({
  kind,
  title,
  children,
  failure,
  onRetry,
  className
}: {
  kind: "refused" | "unreachable";
  title: string;
  children?: ReactNode;
  failure: ConnectionFailure;
  onRetry?: () => void | Promise<unknown>;
  className?: string;
}) {
  const retrying = kind === "unreachable" && onRetry !== undefined;
  // The latest callback, so a parent's new function each render doesn't
  // restart the schedule.
  const retry = useRef(onRetry);
  retry.current = onRetry;
  const [nextAt, setNextAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // One schedule per screen: read again, wait for that read, then wait longer
  // before the next. A click reads now and restarts the wait from there.
  const readNow = useRef<() => void>(() => {});
  useEffect(() => {
    if (!retrying) return;
    let open = true;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      const delay = retryDelayMs(attempt);
      attempt += 1;
      setNextAt(Date.now() + delay);
      timer = setTimeout(() => void read(), delay);
    };
    const read = async () => {
      clearTimeout(timer);
      setNextAt(null);
      try {
        await retry.current?.();
      } catch {
        // The app draws the failure; the schedule goes on.
      }
      if (open) schedule();
    };
    readNow.current = () => void read();
    schedule();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      open = false;
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [retrying]);

  const seconds = nextAt === null ? null : Math.max(0, Math.ceil((nextAt - now) / 1000));
  return (
    <main
      className={cn("flex h-screen items-center justify-center p-6", className)}
      data-testid={kind === "refused" ? "refusal" : "unreachable"}
    >
      <div className="max-w-md">
        <h1 className="text-lg font-semibold">{title}</h1>
        {children !== undefined ? <div className="mt-2 text-sm text-muted-foreground">{children}</div> : null}
        <p className="mt-3 bg-muted px-3 py-2 font-mono text-xs" data-testid={kind === "refused" ? "refusal-message" : "unreachable-message"}>
          {failure.httpStatus === undefined ? failure.message : `${failure.httpStatus} · ${failure.message}`}
        </p>
        {retrying ? (
          <div className="mt-3 flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => readNow.current()} data-testid="unreachable-retry">
              Retry
            </Button>
            {seconds !== null ? (
              <span className="text-xs text-muted-foreground" data-testid="unreachable-countdown">
                Trying again in {seconds}s
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    </main>
  );
}
