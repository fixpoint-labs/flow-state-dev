/**
 * Telling a conversation's feeds that the user sent a line.
 *
 * The user's line rises when it lands, so each way the page sends one says it
 * is going out: a composer, a voice line (`useVoice` sends through
 * `session.sendAction`), and Retry on a failed turn, which runs the turn again
 * under a new request and echoes the line again. Each says so only for an
 * action that echoes the user's line, so what a feed waits for is the line this
 * send lands.
 *
 * The page draws a conversation in both of its responsive trees at once (one
 * hidden by CSS), and each drawing is its own scrolling element with its own
 * feed. So a send is told through a {@link SendSignal} the page owns, which
 * every drawing's feed listens to, and the things that send (one `useVoice`,
 * one Retry, a composer) need not know how many drawings there are.
 */
import { useEffect, useMemo, useState } from "react";
import { useJumpToLatest, type JumpToLatest, type SessionView } from "@flow-state-dev/react";

/** One conversation's "the user sent": `notify` tells every feed that `listen`s. */
export type SendSignal = {
  /** The user's line is going out. */
  notify: () => void;
  /** Hear each `notify`; returns the way to stop. */
  listen: (heard: () => void) => () => void;
};

/** A {@link SendSignal}, the same object for the component's life. */
export function useSendSignal(): SendSignal {
  const [signal] = useState<SendSignal>(() => {
    const listeners = new Set<() => void>();
    return {
      notify: () => {
        for (const heard of listeners) heard();
      },
      listen: (heard) => {
        listeners.add(heard);
        return () => listeners.delete(heard);
      },
    };
  });
  return signal;
}

type Sending = Pick<SessionView, "sendAction" | "resumeLatestRequest">;

/**
 * `session`, with the calls that send a line of the user's notifying `signal`
 * first. Pass it only to what sends such a line (`useVoice`, the failed-turn
 * Retry).
 */
export function useSendingSession<S extends Sending>(session: S, signal: SendSignal): S {
  const { notify } = signal;
  return useMemo<S>(
    () => ({
      ...session,
      sendAction: ((action, input, options) => {
        notify();
        return session.sendAction(action, input, options);
      }) as S["sendAction"],
      resumeLatestRequest: () => {
        notify();
        return session.resumeLatestRequest();
      },
    }),
    [session, notify],
  );
}

/** One drawing's feed, keyed by the conversation it shows, told by `signal` when the user sends. */
export function useSignalledFeed(resetKey: string | null, signal: SendSignal): JumpToLatest {
  const feed = useJumpToLatest({ resetKey });
  const { sent } = feed;
  useEffect(() => signal.listen(sent), [signal, sent]);
  return feed;
}
