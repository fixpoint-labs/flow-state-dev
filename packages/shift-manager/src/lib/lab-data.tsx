// FIX-2409.
/**
 * The one snapshot every surface draws from, and when it is read again.
 *
 * S3's contract: a refresh on boot, on an organization switch, after
 * each line the Shift Coordinator takes (its turn may have created a project or
 * hired a worker), on Retry, and when the user asks (R, or *refresh* on the
 * summary's *as of* line). Never on a route or tab change, so moving around the
 * app costs no reads. The Inbox, its count, Tasks and a task's asks read
 * workforce's inbox view instead (`inbox.ts`): an answer is no reason to read
 * the snapshot again.
 *
 * It also reads again on its own when another session changes what it shows:
 * one live read through the provider's client (`client.live`), on the topics
 * and notices `snapshot-subscribe.ts` names, and every
 * {@link SNAPSHOT_POLL_MS} wherever push can miss a change. Those reads give
 * no sign while they run; only a read the user asked for dims the counts
 * ({@link LabData.asking}).
 *
 * A read that can't reach the Lab after a good one keeps the last snapshot,
 * reports `lapsed`, and the live read tries again on its own, 1 s doubling to
 * 30 s, until one lands. Only a failed first read, or a refusal, swaps the
 * shell for a full-screen page.
 *
 * The connection bar reads one state for the page: the worst of the snapshot
 * read's and those of the session feeds on screen, which report theirs with
 * `useReportFeedState` (`feed-health.ts`).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Client, LiveRead } from "@flow-state-dev/client";
import { isFeedStale, type ConnectionFeedStatus } from "../components/flow-state/connection-banner";
import { connect, type Connection } from "./connection";
import { FeedHealthContext, worstFeedState, type ReportFeed } from "./feed-health";
import { createLabReader, type LabReader, type LabSnapshot } from "./reads";
import { heard, heardSessionIds, SNAPSHOT_POLL_MS, snapshotPaths, snapshotTopics } from "./snapshot-subscribe";

/** What a surface reads from the provider. */
export type LabData = {
  /** Who the Lab is read as, and with what credential. */
  connection: Connection;
  /** The one client every read goes through, built from the connection. */
  client: Client;
  reader: LabReader;
  /** `undefined` until the first refresh lands. */
  snapshot: LabSnapshot | undefined;
  /** A read of any kind is running. */
  refreshing: boolean;
  /**
   * A read the user asked for is running: R, *refresh*, Retry, or the read
   * after their own action. Counts dim while it runs; a read a notice, the
   * boot or the lapsed retry started gives no sign.
   */
  asking: boolean;
  /**
   * The page's connection health: the worst of the snapshot read's state and every
   * session feed on screen, ordered `stopped` › `lapsed` › the rest.
   */
  health: ConnectionFeedStatus;
  /** The page's connection is lapsed or stopped: what is drawn is the last the server said. */
  stale: boolean;
  /** Read everything again, as the user asked: counts dim until it lands. */
  refresh(): Promise<void>;
};

const LabContext = createContext<LabData | null>(null);

/** Hold the snapshot for the Lab `connection` reads. */
export function LabProvider({ connection, children }: { connection: Connection; children: ReactNode }) {
  const client = useMemo(() => connect(connection), [connection]);
  const reader = useMemo(() => createLabReader(client), [client]);
  const [snapshot, setSnapshot] = useState<LabSnapshot | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [asking, setAsking] = useState(false);
  // Refreshes in a row that couldn't reach the Lab after a good read. The snapshot stays; the read is `lapsed`.
  const [lapses, setLapses] = useState(0);
  const [feeds, setFeeds] = useState<ReadonlyMap<string, ConnectionFeedStatus>>(new Map());
  // The snapshot on screen is a good read of this client's Lab: a later unreachable one doesn't replace it.
  const loaded = useRef(false);
  useEffect(() => {
    loaded.current = false;
  }, [client]);
  // Only the latest refresh may land: an older one finishing late would draw
  // a Lab that has moved on.
  const generation = useRef(0);
  // The live read, while there is a good snapshot to keep current.
  const live = useRef<LiveRead | null>(null);

  // `asked`: the user asked for this read, so the counts dim until it lands.
  // `viaLive`: the live read made it, and tries again itself if it lapses.
  // Resolves `false` when it lapsed.
  const readLab = useCallback(async (asked: boolean, viaLive = false): Promise<boolean> => {
    const mine = ++generation.current;
    setRefreshing(true);
    if (asked) setAsking(true);
    try {
      const next = await reader.read();
      if (mine !== generation.current) return true;
      if (next.unreachable !== undefined && loaded.current) {
        // After a good read, keep it: the route, the open task and a draft stay, and the bar says why it is old.
        setLapses((n) => n + 1);
        // The live read's retry is what brings it back.
        if (!viaLive) live.current?.refresh();
        return false;
      }
      loaded.current = next.refused === undefined && next.unreachable === undefined;
      setSnapshot(next);
      setLapses(0);
      return true;
    } finally {
      if (mine === generation.current) {
        setRefreshing(false);
        setAsking(false);
      }
    }
  }, [reader]);
  const refresh = useCallback(async () => {
    await readLab(true);
  }, [readLab]);

  useEffect(() => {
    void readLab(false);
  }, [readLab]);

  // Read again when another session changes what the snapshot shows. The topic
  // list follows the sessions the last read listed, keyed by the topics, so a
  // read that lists the same sessions keeps the live read; a new session's
  // first subscribe reads once, so a change between the read and it is not
  // lost. The live read drops a notice the snapshot doesn't hear before it
  // merges, so two different unheard notices never widen into a whole read.
  const listed = snapshot !== undefined && snapshot.refused === undefined && snapshot.unreachable === undefined ? snapshot.sessions : undefined;
  const topics = useMemo(() => snapshotTopics(listed === undefined ? [] : heardSessionIds(listed)), [listed]);
  const topicsKey = listed === undefined ? null : JSON.stringify(topics);
  const topicsNow = useRef(topics);
  topicsNow.current = topics;
  useEffect(() => {
    if (topicsKey === null) return;
    const watching = client.live(topicsNow.current, {
      read: async () => {
        if (!(await readLab(false, true))) throw new Error("The Lab could not be reached.");
      },
      hear: heard,
      paths: snapshotPaths,
      pollIntervalMs: SNAPSHOT_POLL_MS,
      // The subscription's connect is the first read: the snapshot was just read.
      readNow: false,
    });
    live.current = watching;
    return () => {
      watching.close();
      if (live.current === watching) live.current = null;
    };
  }, [client, readLab, topicsKey]);

  const reportFeed = useCallback<ReportFeed>((key, state) => {
    setFeeds((last) => {
      if ((last.get(key) ?? null) === state) return last;
      const next = new Map(last);
      if (state === null) next.delete(key);
      else next.set(key, state);
      return next;
    });
  }, []);
  const read: ConnectionFeedStatus = lapses > 0 ? "lapsed" : snapshot === undefined ? "connecting" : "live";
  const health = worstFeedState([read, ...feeds.values()]);
  const stale = isFeedStale(health);

  const value = useMemo<LabData>(
    () => ({ connection, client, reader, snapshot, refreshing, asking, health, stale, refresh }),
    [connection, client, reader, snapshot, refreshing, asking, health, stale, refresh],
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
