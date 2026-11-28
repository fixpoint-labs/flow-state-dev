/**
 * The Lab connection every surface reads through: who the Lab is read as,
 * the one client built from that, and the page's connection health.
 *
 * The provider reads nothing itself. Each screen reads its own views,
 * collections and session feeds through `client`, and each of those keeps
 * itself current.
 *
 * The connection bar reads one state for the page: the worst of the reads on
 * screen, which report theirs with `useReportFeedState` (`feed-health.ts`).
 * The Inbox view is one of them on every page, so a Lab that can't be reached
 * shows on the bar wherever the user is.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { Client } from "@flow-state-dev/client";
import { isFeedStale, type ConnectionFeedStatus } from "../components/flow-state/connection-banner";
import { connect, type Connection } from "./connection";
import { FeedHealthContext, worstFeedState, type ReportFeed } from "./feed-health";

/** What a surface reads from the provider. */
export type LabData = {
  /** Who the Lab is read as, and with what credential. */
  connection: Connection;
  /** The one client every read goes through, built from the connection. */
  client: Client;
  /**
   * The page's connection health: the worst of every read on screen that
   * reports one, ordered `stopped` › `lapsed` › the rest.
   */
  health: ConnectionFeedStatus;
  /** The page's connection is lapsed or stopped: what is drawn is the last the server said. */
  stale: boolean;
};

const LabContext = createContext<LabData | null>(null);

/** Hold the client for the Lab `connection` reads, and the page's health. */
export function LabProvider({ connection, children }: { connection: Connection; children: ReactNode }) {
  const client = useMemo(() => connect(connection), [connection]);
  const [feeds, setFeeds] = useState<ReadonlyMap<string, ConnectionFeedStatus>>(new Map());

  const reportFeed = useCallback<ReportFeed>((key, state) => {
    setFeeds((last) => {
      if ((last.get(key) ?? null) === state) return last;
      const next = new Map(last);
      if (state === null) next.delete(key);
      else next.set(key, state);
      return next;
    });
  }, []);
  const health = worstFeedState(feeds.values());
  const stale = isFeedStale(health);

  const value = useMemo<LabData>(() => ({ connection, client, health, stale }), [connection, client, health, stale]);
  return (
    <LabContext.Provider value={value}>
      <FeedHealthContext.Provider value={reportFeed}>{children}</FeedHealthContext.Provider>
    </LabContext.Provider>
  );
}

/** The Lab's data. Throws outside a {@link LabProvider}. */
export function useLab(): LabData {
  const value = useContext(LabContext);
  if (value === null) throw new Error("useLab: no LabProvider above this component");
  return value;
}
