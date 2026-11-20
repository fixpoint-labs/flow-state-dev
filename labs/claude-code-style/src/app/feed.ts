/**
 * One session's feed in the screen's words, shared by a session's thread
 * (`sessions.ts`) and a task's work (`tasks.ts`), and where each open thread
 * keeps the feed a send streams its answer into.
 */
import { useMemo } from "react";
import type { Client, SessionConnectionStatus } from "@flow-state-dev/client";
import type { OutputItem } from "@flow-state-dev/core/items";
import { useSessionFeed } from "@flow-state-dev/react";

/** The item types a thread's lines are drawn from: a failed turn's `error` item, and workforce's lines (`data`). */
export const THREAD_ITEMS = ["message", "tool_output", "error", "data"];

/** A session feed's connection: `lapsed` once a retry has failed, `stopped` once it gives up. */
export type ConnectionState = SessionConnectionStatus;

/** Each open thread's feed's `followResponse`, by session. */
export type ThreadFeeds = Map<string, (response: Response) => void>;

/** One session's items of `types` on its feed, in the screen's words: `items` once the history landed, its connection and how many runs are unfinished. */
export function useFeed(client: Client, sessionId: string | null, types: readonly string[]) {
  const feed = useSessionFeed(sessionId, { client, itemTypes: types });
  return useMemo(
    () =>
      feed === undefined
        ? undefined
        : {
            ...(feed.items === undefined ? {} : { items: feed.items as OutputItem[], ...(feed.hasEarlier ? { loadEarlier: feed.loadEarlier } : {}) }),
            connection: feed.state as ConnectionState,
            runs: feed.runs === null ? null : feed.runs.length,
            followResponse: feed.followResponse,
          },
    [feed?.items, feed?.hasEarlier, feed?.state, feed?.runs, feed?.loadEarlier, feed?.followResponse],
  );
}
