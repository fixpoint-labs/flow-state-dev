"use client";

/**
 * Flow State mode's turns, as the registry's lines read them: the session's
 * newest turn, with the engine's `retryable`, and the line context that runs
 * its Retry.
 *
 * `conversationLines` offers Retry on the newest turn that drew a line, when
 * the engine runs it again, as in the other apps. The newest turn is the one
 * `useSession` reads (`latestRequest`), so the Retry it offers is the one
 * `resumeLatestRequest` runs. A refused retry is reported on the line, so
 * `shownError` leaves it out of the page's box.
 */

import { useMemo, useState } from "react";
import type { LineTurn, useSession } from "@flow-state-dev/react";
import type { LineContextValue } from "@/components/flow-state/conversation-lines";

type TurnSession = Pick<
  ReturnType<typeof useSession>,
  "latestRequest" | "isStreaming" | "isFinishing" | "resumeLatestRequest" | "error"
>;

/** The turns the session's lines read, the context its lines draw in, and the error the page's box still shows. */
export function useTurnLines(
  session: TurnSession,
  who: string,
): { turns: readonly LineTurn[]; lineContext: LineContextValue; shownError: Error | null } {
  const [refusal, setRefusal] = useState<unknown>(null);
  const { latestRequest, isStreaming, isFinishing, resumeLatestRequest } = session;

  const turns = useMemo<readonly LineTurn[]>(
    () =>
      latestRequest === null
        ? []
        : [{ id: latestRequest.id, status: latestRequest.status, retryable: latestRequest.retryable === true }],
    [latestRequest],
  );

  // Retry only while no turn runs: `resumeLatestRequest` runs the newest request again.
  const running = isStreaming || isFinishing;
  const lineContext = useMemo<LineContextValue>(
    () => ({
      who,
      ...(running
        ? {}
        : {
            retry: async () => {
              try {
                await resumeLatestRequest();
              } catch (error) {
                setRefusal(error);
                throw error;
              }
            },
          }),
    }),
    [who, running, resumeLatestRequest],
  );

  return { turns, lineContext, shownError: session.error !== null && session.error === refusal ? null : session.error };
}
