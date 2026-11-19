/**
 * What the jobs share over one client: the workforce client, one feed per session, each conversation and
 * its flow, the turns a Stop stops, and the roster as last read. One per `createAppCalls`.
 */
import type { Client } from "@flow-state-dev/client";
import type { OutputItem } from "@flow-state-dev/core/items";
import { createWorkforceClient, type WorkforceClient } from "@flow-state-dev/workforce/browser";
import { sessionFeeds, type SessionFeed } from "../lib/session-feed";
import type { Item } from "./items";
import type { Unsubscribe } from "./reads";
/** The state every job's calls share, over one client. */
export interface AppState {
  client: Client;
  workforce: WorkforceClient;
  /** One feed per session, shared by every watch on it. */
  feeds: (sessionId: string) => SessionFeed;
  /** A session's items through `map`, on each change of its feed. */
  watchFeed<T>(sessionId: string, map: (items: Item[]) => T, onChange: (value: T) => void): Unsubscribe;
  /** Each conversation's answering turns its open view last read as running: what Stop stops. */
  runningNow: Map<string, string[]>;
  /** Each conversation's turns this page sent, by request id, in order: a Stop leaves the ones sent after its press. */
  sent: Map<string, string[]>;
  /** Each conversation's stop under way: the turns an `interrupt` aborted, until its request read shows each ended; `wake` redraws its views. */
  stops: Map<string, { ids: Set<string> }>;
  stopWatchers: Map<string, Set<() => void>>;
  wake(sessionId: string): void;
  /** Each worker's conversation, and the flow it runs on, once opened. */
  conversations: Map<string, { sessionId: string; flow: string }>;
  flowOfSession: Map<string, string>;
  /** The workers, by id, so a line under a worker's name reads as a task's ending: the roster as last read (`watchRoster`). */
  workerIds: Set<string>;
  /** The worker's conversation, opened once. */
  conversationOf(worker: string): Promise<{ sessionId: string; flow: string }>;
  /** Stop the roster watch the first conversation started: whoever made the calls ends them. */ close(): void;
}

/** The shared state over `client`, with nothing read yet. */
export function appState(client: Client): AppState {
  const workforce: WorkforceClient = createWorkforceClient(client);
  const feeds = sessionFeeds(client);
  const stopWatchers = new Map<string, Set<() => void>>();
  const conversations = new Map<string, { sessionId: string; flow: string }>();
  const flowOfSession = new Map<string, string>();
  // The roster, watched from the first conversation opened on: what `workerIds` holds before its feed is read.
  // A read that fails before one lands fails that open, as `ensureWorkerSession`'s own roster read would, and the next open watches anew.
  let rosterRead: Promise<void> | undefined;
  let stopRoster = () => {};
  const rosterKnown = () => (rosterRead ??= new Promise<void>((landed, failed) => {
    let read = false;
    stopRoster = workforce.watchRoster((roster) => {
      read = true;
      state.workerIds = new Set(roster.map((w) => w.id));
      landed();
    }, { onError: (error) => void (read || (stopRoster(), (rosterRead = undefined), failed(error))) });
  }));
  const conversationOf = async (worker: string) => {
    const known = conversations.get(worker);
    if (known !== undefined) return known;
    await rosterKnown();
    const session = await workforce.ensureWorkerSession({ worker });
    const opened = { sessionId: session.id, flow: session.flowKind };
    conversations.set(worker, opened);
    flowOfSession.set(session.id, session.flowKind);
    return opened;
  };
  const state: AppState = {
    client,
    workforce,
    feeds,
    watchFeed: <T>(sessionId: string, map: (items: Item[]) => T, onChange: (value: T) => void): Unsubscribe =>
      (feeds(sessionId) as SessionFeed).watch((items: readonly OutputItem[]) => onChange(map(items as unknown as Item[]))),
    runningNow: new Map(),
    sent: new Map(),
    stops: new Map(),
    stopWatchers,
    wake: (sessionId) => stopWatchers.get(sessionId)?.forEach((tell) => tell()),
    conversations,
    flowOfSession,
    workerIds: new Set(),
    conversationOf,
    close: () => stopRoster(),
  };
  return state;
}
