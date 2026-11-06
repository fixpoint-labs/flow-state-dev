/**
 * A conversation's feed, and the session as the sends that land a line of the
 * user's see it.
 *
 * The user's line rises when it lands, so each way the page sends one tells
 * the feed it is going out (`feed.sent()`): a composer, a voice line
 * (`useVoice` sends through `session.sendAction`), and Retry on a failed turn,
 * which runs the turn again under a new request and echoes the line again.
 * Each arms the feed only for an action that echoes the user's line, so what
 * the feed waits for is the line this send lands.
 */
import { useMemo } from "react";
import { useJumpToLatest, type JumpToLatest, type SessionView } from "@flow-state-dev/react";

type Sending = Pick<SessionView, "sendAction" | "resumeLatestRequest">;

/**
 * The feed for the assistant's conversation, keyed by its session, and
 * `session` with its line-sending calls arming that feed. Pass the returned
 * session only to what sends a line of the user's (`useVoice`, the retry).
 */
export function useChatFeed<S extends Sending>(session: S, resetKey: string | null): { feed: JumpToLatest; session: S } {
  const feed = useJumpToLatest({ resetKey });
  const { sent } = feed;
  const sending = useMemo<S>(
    () => ({
      ...session,
      sendAction: ((action, input, options) => {
        sent();
        return session.sendAction(action, input, options);
      }) as S["sendAction"],
      resumeLatestRequest: () => {
        sent();
        return session.resumeLatestRequest();
      },
    }),
    [session, sent],
  );
  return { feed, session: sending };
}
