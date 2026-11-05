"use client";

/**
 * Flow State mode's failed turn: the engine's `error` item drawn as the
 * registry's request-recovery line, with Retry on the request the session
 * will retry.
 *
 * An item renderer is handed only its item, so the chat panel decides which
 * request gets a Retry and hands that down through `FailedTurnRetryProvider`.
 * `useFailedTurnRetry` is that decision, and the page's error box reads its
 * `shownError` so a refused retry, already on the line, shows once.
 */

import { createContext, useCallback, useContext, useState } from "react";
import type { ErrorItem } from "@flow-state-dev/core/items";
import type { useSession } from "@flow-state-dev/react";
import { RequestRecovery } from "@/components/flow-state/request-recovery";

/** The retry for a request, or `undefined` when the session won't retry it. */
export type RetryFor = (requestId: string) => (() => Promise<void>) | undefined;

const FailedTurnRetryContext = createContext<RetryFor>(() => undefined);

/** Hands the chat panel's {@link RetryFor} to the `error` renderer below. */
export const FailedTurnRetryProvider = FailedTurnRetryContext.Provider;

/** The `error` item renderer for Flow State mode. */
export function ChatAgentFailedTurn({ item }: { item: ErrorItem }) {
  const retryFor = useContext(FailedTurnRetryContext);
  return (
    <RequestRecovery
      reason={item.message}
      code={item.code}
      details={item.details}
      who="Assistant"
      onRetry={retryFor(item.requestId)}
    />
  );
}

type RetrySession = Pick<
  ReturnType<typeof useSession>,
  "latestRequest" | "isStreaming" | "isFinishing" | "resumeLatestRequest" | "error"
>;

/**
 * Which failed request gets a Retry, and which error the page's own box
 * still shows.
 *
 * A request gets Retry when it is the session's newest, its status is
 * `failed`, and no turn runs: `resumeLatestRequest` retries only that one.
 * A refused retry is reported on the line, so `shownError` leaves it out.
 */
export function useFailedTurnRetry(session: RetrySession): {
  retryFor: RetryFor;
  shownError: Error | null;
} {
  const [refusal, setRefusal] = useState<unknown>(null);
  const { latestRequest, isStreaming, isFinishing, resumeLatestRequest } = session;

  const retry = useCallback(async () => {
    try {
      await resumeLatestRequest();
    } catch (error) {
      setRefusal(error);
      throw error;
    }
  }, [resumeLatestRequest]);

  const retryFor = useCallback<RetryFor>(
    (requestId) =>
      latestRequest?.id === requestId && latestRequest.status === "failed" && !isStreaming && !isFinishing
        ? retry
        : undefined,
    [latestRequest, isStreaming, isFinishing, retry],
  );

  return { retryFor, shownError: session.error !== null && session.error === refusal ? null : session.error };
}
