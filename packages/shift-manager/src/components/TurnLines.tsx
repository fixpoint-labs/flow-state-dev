"use client";

/**
 * A turn that didn't finish, as its line in a conversation: a failed turn's
 * reason, with Retry when the line says the engine retries it, and a turn
 * the user stopped. React's conversation model decides each line from the
 * session's turns (`conversationLines`); these draw it with the registry's
 * `request-recovery`.
 *
 * What a line can do comes from {@link TurnLineContext}, which the
 * conversation that draws the lines provides: outside one, a failed line
 * offers no Retry.
 */
import { createContext, useContext } from "react";
import type { ErrorItem } from "@flow-state-dev/core/items";
import type { ItemLine } from "@flow-state-dev/react";
import { RequestRecovery } from "./flow-state/request-recovery";

/** What the conversation drawing the lines lets them do. */
export interface TurnLineActions {
  /** Who was working, before a failed turn's reason. */
  who?: string;
  /** Retry the failed turn `requestId` in this conversation's session. */
  retry?: (requestId: string) => Promise<unknown>;
  /** The session's background work still running, said under its last stopped line. */
  stillRunning?: (lineId: string) => number | undefined;
}

/** The actions of the conversation the lines are drawn in. */
export const TurnLineContext = createContext<TurnLineActions>({});

/** A turn that failed: why, and Retry when the model offers it and the conversation can run it. */
export function FailedTurn({ item, line }: { item: ErrorItem; line?: ItemLine }) {
  const { who, retry } = useContext(TurnLineContext);
  const offered = line?.kind === "failed" && line.retryable && retry !== undefined;
  return (
    <RequestRecovery
      {...(who === undefined ? {} : { who })}
      reason={item.message}
      code={item.code}
      details={item.details}
      {...(offered ? { onRetry: () => retry(item.requestId) } : {})}
    />
  );
}

/** A turn the user stopped, after its last line. */
export function StoppedTurn({ line }: { line: ItemLine }) {
  const { stillRunning } = useContext(TurnLineContext);
  const running = stillRunning?.(line.id);
  return <RequestRecovery stopped {...(running === undefined ? {} : { stillRunning: running })} />;
}
