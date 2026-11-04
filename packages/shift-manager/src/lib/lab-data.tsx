/**
 * The one snapshot every surface draws from, and when it is read again.
 *
 * S3's contract: a refresh on boot, on an organization switch, after a
 * successful answer to an ask and again once the run it resumed stops, after
 * each line the Shift Coordinator takes (its turn may have created a project or
 * hired a worker), and on Retry. Never on a route or tab change, so moving
 * around the app costs no reads. Inbox, the Stream's asks, the sidebar counts
 * and the Tasks list all come from the same snapshot.
 *
 * A refresh that can't reach the Lab after a good read keeps the last good
 * snapshot on screen (FIX-2373 D2), reports the read `lapsed`, and reads again
 * on its own at 2, 4, 8… seconds until one lands. Only a first read that fails,
 * or a refusal, swaps the shell for a full-screen page.
 *
 * The connection bar reads one state for the page: the worst of the snapshot
 * read's and those of the session feeds on screen, which report theirs with
 * `useReportFeedState` (`feed-health.ts`).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ResumeAction } from "@flow-state-dev/core/types";
import type { Client } from "@flow-state-dev/client";
import type { InboxAnswer, InboxHold } from "@flow-state-dev/orchestration/inbox";
import { isFeedStale, type ConnectionFeedState } from "../components/flow-state/connection-banner";
import { retryDelayMs } from "../components/flow-state/connection-screen";
import { connect, type Connection } from "./connection";
import { FeedHealthContext, worstFeedState, type ReportFeed } from "./feed-health";
import { createLabReader, type Ask, type LabReader, type LabSnapshot } from "./reads";

/** What a surface reads from the provider. */
export type LabData = {
  /** Who the Lab is read as, and with what credential. */
  connection: Connection;
  /** The one client every read goes through, built from the connection. */
  client: Client;
  reader: LabReader;
  /** `undefined` until the first refresh lands. */
  snapshot: LabSnapshot | undefined;
  refreshing: boolean;
  /**
   * The page's connection health: the worst of the snapshot read's state and every
   * session feed on screen, ordered `stopped` › `lapsed` › the rest.
   */
  health: ConnectionFeedState;
  /** The page's connection is lapsed or stopped: what is drawn is the last the server said. */
  stale: boolean;
  /** Read everything again. */
  refresh(): Promise<void>;
  /** Answer an ask; on success, refresh so it leaves every surface together. */
  answer(ask: Ask, answer: { action: ResumeAction; data?: unknown }): Promise<void>;
  /** Answer one of an Inbox item's holds (a task's question or confirm); on success, refresh. */
  answerOne(hold: InboxHold<unknown>, answer: InboxAnswer): Promise<void>;
  /**
   * The session of the latest ask answered here, with a count that moves once
   * the answer lands and again once the run it resumed stops running.
   * `undefined` before any answer.
   */
  answered: { sessionId: string; count: number } | undefined;
};

/** How often, and how many times, an answered request's status is read while it runs on. */
const SETTLE_POLL_MS = 1_000;
const SETTLE_POLLS = 130;
/** Polls a request may still read `suspended` right after its answer, before that counts as stopped again. */
const RESUME_GRACE_POLLS = 3;
/** Status reads in a row that may fail before the wait gives up. */
const SETTLE_FAILED_READS = 3;

/**
 * Wait until the request an answer resumed stops running, or `live()` turns
 * false (the provider is gone, or reads another Lab), whichever is first. A
 * read that fails is tried again on the next poll; {@link SETTLE_FAILED_READS}
 * in a row end the wait, and the snapshot read after it says what it can.
 * A run still going after {@link SETTLE_POLLS} reads ends the wait too, and
 * its result is drawn on the conversation's next read.
 */
async function settled(client: Client, flowId: string, requestId: string, live: () => boolean): Promise<void> {
  let failed = 0;
  for (let poll = 0; poll < SETTLE_POLLS && live(); poll += 1) {
    let status: string | undefined;
    try {
      status = (await client.flow(flowId).request(requestId).status()).status;
      failed = 0;
    } catch {
      failed += 1;
      if (failed >= SETTLE_FAILED_READS) return;
    }
    if (status !== undefined && status !== "in_progress" && (status !== "suspended" || poll >= RESUME_GRACE_POLLS)) return;
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  }
}

const LabContext = createContext<LabData | null>(null);

/** Hold the snapshot for the Lab `connection` reads. */
export function LabProvider({ connection, children }: { connection: Connection; children: ReactNode }) {
  const client = useMemo(() => connect(connection), [connection]);
  const reader = useMemo(() => createLabReader(client), [client]);
  const [snapshot, setSnapshot] = useState<LabSnapshot | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  // Refreshes in a row that couldn't reach the Lab after a good read. The snapshot stays; the read is `lapsed`.
  const [lapses, setLapses] = useState(0);
  const [feeds, setFeeds] = useState<ReadonlyMap<string, ConnectionFeedState>>(new Map());
  const [answered, setAnswered] = useState<LabData["answered"]>(undefined);
  // The snapshot on screen is a good read of this client's Lab: a later unreachable one doesn't replace it.
  const loaded = useRef(false);
  // The client a following answer was given: once they change or the provider unmounts, it stops.
  const current = useRef<Client | null>(client);
  useEffect(() => {
    current.current = client;
    loaded.current = false;
    return () => {
      current.current = null;
    };
  }, [client]);
  const bump = useCallback((sessionId: string) => setAnswered((last) => ({ sessionId, count: (last?.count ?? 0) + 1 })), []);
  // Only the latest refresh may land: an older one finishing late would draw
  // a Lab that has moved on.
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    setRefreshing(true);
    try {
      const next = await reader.read();
      if (mine !== generation.current) return;
      if (next.unreachable !== undefined && loaded.current) {
        // After a good read, keep it: the route, the open task and a draft stay, and the bar says why it is old.
        setLapses((n) => n + 1);
        return;
      }
      loaded.current = next.refused === undefined && next.unreachable === undefined;
      setSnapshot(next);
      setLapses(0);
    } finally {
      if (mine === generation.current) setRefreshing(false);
    }
  }, [reader]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // While the read is lapsed, read again on its own, further apart after each failure.
  useEffect(() => {
    if (lapses === 0) return;
    const timer = setTimeout(() => void refresh(), retryDelayMs(lapses - 1));
    return () => clearTimeout(timer);
  }, [lapses, refresh]);

  const reportFeed = useCallback<ReportFeed>((key, state) => {
    setFeeds((last) => {
      if ((last.get(key) ?? null) === state) return last;
      const next = new Map(last);
      if (state === null) next.delete(key);
      else next.set(key, state);
      return next;
    });
  }, []);
  const read: ConnectionFeedState = lapses > 0 ? "lapsed" : snapshot === undefined ? "connecting" : "live";
  const health = worstFeedState([read, ...feeds.values()]);
  const stale = isFeedStale(health);

  const answer = useCallback<LabData["answer"]>(
    async (ask, value) => {
      await reader.resume(ask, value);
      bump(ask.sessionId);
      await refresh();
      // The run goes on without this page: follow it, so what it did with the answer is drawn too.
      if (ask.flowId !== null) {
        const live = () => current.current === client;
        void settled(client, ask.flowId, ask.item.requestId, live).then(() => {
          if (!live()) return;
          bump(ask.sessionId);
          void refresh();
        });
      }
    },
    [client, reader, refresh, bump],
  );

  const answerOne = useCallback<LabData["answerOne"]>(
    async (hold, value) => {
      await reader.answerOne(hold, value);
      await refresh();
    },
    [reader, refresh],
  );

  const value = useMemo<LabData>(
    () => ({ connection, client, reader, snapshot, refreshing, health, stale, refresh, answer, answerOne, answered }),
    [connection, client, reader, snapshot, refreshing, health, stale, refresh, answer, answerOne, answered],
  );
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
