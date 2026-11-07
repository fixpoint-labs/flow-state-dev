// FIX-2409.
/**
 * The one snapshot every surface draws from, and when it is read again.
 *
 * S3's contract: a refresh on boot, on an organization switch, after a
 * successful answer to an ask and again once the run it resumed stops, after
 * each line the Shift Coordinator takes (its turn may have created a project or
 * hired a worker), on Retry, and when the user asks (R, or *refresh* on the
 * summary's *as of* line). Never on a route or tab change, so moving around the
 * app costs no reads. Inbox, the Stream's asks, the sidebar counts and the
 * Tasks list all come from the same snapshot.
 *
 * It also reads again on its own when another session changes what it shows:
 * one subscription through the provider's client, on the topics
 * and notices `snapshot-subscribe.ts` names, and every
 * {@link SNAPSHOT_POLL_MS} wherever push can miss a change. Those reads give
 * no sign while they run; only a read the user asked for dims the counts
 * ({@link LabData.asking}).
 *
 * A read that can't reach the Lab after a good one keeps the last snapshot,
 * reports `lapsed`, and retries on its own at 2, 4, 8… seconds until one
 * lands. Only a failed first read, or a refusal, swaps the shell for a
 * full-screen page.
 *
 * The connection bar reads one state for the page: the worst of the snapshot
 * read's and those of the session feeds on screen, which report theirs with
 * `useReportFeedState` (`feed-health.ts`).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useSubscription } from "@flow-state-dev/react";
import type { ResumeAction } from "@flow-state-dev/core/types";
import type { Client } from "@flow-state-dev/client";
import type { InboxAnswer, InboxHold } from "@flow-state-dev/orchestration/inbox";
import { isFeedStale, type ConnectionFeedState } from "../components/flow-state/connection-banner";
import { retryDelayMs } from "../components/flow-state/connection-screen";
import { connect, type Connection } from "./connection";
import { FeedHealthContext, worstFeedState, type ReportFeed } from "./feed-health";
import { createLabReader, type Ask, type LabReader, type LabSnapshot } from "./reads";
import { heard, heardSessionIds, SNAPSHOT_POLL_MS, snapshotTopics } from "./snapshot-subscribe";

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
  health: ConnectionFeedState;
  /** The page's connection is lapsed or stopped: what is drawn is the last the server said. */
  stale: boolean;
  /** Read everything again, as the user asked: counts dim until it lands. */
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

/** How often an answered request's status is read while it runs on, and for how long. */
const SETTLE_POLL_MS = 1_000;
const SETTLE_TIMEOUT_MS = 130_000;

/**
 * Wait until the request an answer resumed stops running (`wait()`: a resumed
 * run counts as running while the server holds it, even before its record
 * leaves `suspended`), or `stop` aborts (the provider is gone, or reads
 * another Lab), whichever is first. A read that fails, or a run still going
 * after {@link SETTLE_TIMEOUT_MS}, ends the wait too, and the snapshot read
 * after it says what it can.
 */
async function settled(client: Client, flowId: string, requestId: string, stop: AbortSignal): Promise<void> {
  await client
    .flow(flowId)
    .request(requestId)
    .wait({ pollMs: SETTLE_POLL_MS, timeoutMs: SETTLE_TIMEOUT_MS, signal: stop })
    .catch(() => undefined);
}

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
  const [feeds, setFeeds] = useState<ReadonlyMap<string, ConnectionFeedState>>(new Map());
  const [answered, setAnswered] = useState<LabData["answered"]>(undefined);
  // The snapshot on screen is a good read of this client's Lab: a later unreachable one doesn't replace it.
  const loaded = useRef(false);
  // This client's answers: once the client changes or the provider unmounts, this aborts, and an
  // answer given on it reads and follows nothing more. The controller an answer took is the one
  // aborted; only the next client's effect, finding it aborted, makes a new one.
  const following = useRef<AbortController | null>(null);
  useEffect(() => {
    loaded.current = false;
    if (following.current?.signal.aborted === true) following.current = null;
    const controller = (following.current ??= new AbortController());
    return () => controller.abort();
  }, [client]);
  const bump = useCallback((sessionId: string) => setAnswered((last) => ({ sessionId, count: (last?.count ?? 0) + 1 })), []);
  // Only the latest refresh may land: an older one finishing late would draw
  // a Lab that has moved on.
  const generation = useRef(0);

  // `asked`: the user asked for this read, so the counts dim until it lands.
  const readLab = useCallback(async (asked: boolean) => {
    const mine = ++generation.current;
    setRefreshing(true);
    if (asked) setAsking(true);
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
      if (mine === generation.current) {
        setRefreshing(false);
        setAsking(false);
      }
    }
  }, [reader]);
  const refresh = useCallback(() => readLab(true), [readLab]);

  useEffect(() => {
    void readLab(false);
  }, [readLab]);

  // While the read is lapsed, read again on its own, further apart after each failure.
  useEffect(() => {
    if (lapses === 0) return;
    const timer = setTimeout(() => void readLab(false), retryDelayMs(lapses - 1));
    return () => clearTimeout(timer);
  }, [lapses, readLab]);

  // Read again when another session changes what the snapshot shows. The topic
  // list follows the sessions the last read listed. `useSubscription` keys it
  // by its topics, so a read that lists the same sessions keeps the
  // subscription; a new session's first subscribe reads once, so a change
  // between the read and it is not lost.
  const listed = snapshot !== undefined && snapshot.refused === undefined && snapshot.unreachable === undefined ? snapshot.sessions : undefined;
  const topics = useMemo(() => snapshotTopics(listed === undefined ? [] : heardSessionIds(listed, client.userId)), [listed, client.userId]);
  // Notices the snapshot doesn't hear are dropped before `useSubscription`
  // coalesces them: two different unheard notices waiting together would
  // otherwise merge into `null` and read the whole Lab.
  const heardOnly = useMemo<Pick<Client, "subscribe">>(
    () => ({
      subscribe: (wanted, options) =>
        client.subscribe(wanted, {
          ...options,
          onChange: (notice) => {
            if (notice === null || heard(notice)) options.onChange(notice);
          },
        }),
    }),
    [client],
  );
  const onNotice = useCallback(async () => {
    await readLab(false);
  }, [readLab]);
  useSubscription(topics, onNotice, { client: heardOnly, pollIntervalMs: SNAPSHOT_POLL_MS, enabled: listed !== undefined });

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
      // Taken before any wait: a switch to another Lab meanwhile aborts it, and this answer stops there.
      const stop = (following.current ??= new AbortController()).signal;
      await reader.resume(ask, value);
      if (stop.aborted) return;
      bump(ask.sessionId);
      await refresh();
      // The run goes on without this page: follow it, so what it did with the answer is drawn too.
      if (ask.flowId !== null && !stop.aborted) {
        void settled(client, ask.flowId, ask.item.requestId, stop).then(() => {
          if (stop.aborted) return;
          bump(ask.sessionId);
          void readLab(false);
        });
      }
    },
    [client, reader, refresh, readLab, bump],
  );

  const answerOne = useCallback<LabData["answerOne"]>(
    async (hold, value) => {
      await reader.answerOne(hold, value);
      await refresh();
    },
    [reader, refresh],
  );

  const value = useMemo<LabData>(
    () => ({ connection, client, reader, snapshot, refreshing, asking, health, stale, refresh, answer, answerOne, answered }),
    [connection, client, reader, snapshot, refreshing, asking, health, stale, refresh, answer, answerOne, answered],
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
