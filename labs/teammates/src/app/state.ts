/**
 * What the jobs share over one client: the workforce and Inbox clients, one feed per session, each conversation and
 * its flow, the turns a Stop stops, each task's open holds, and the roster as last read. One per `createAppCalls`.
 */
import type { Client } from "@flow-state-dev/client";
import type { OutputItem } from "@flow-state-dev/core/items";
import { createWorkforceClient, type WorkforceClient } from "@flow-state-dev/workforce/browser";
import { createInboxClient, type InboxHold } from "@flow-state-dev/orchestration/inbox";
import { sessionFeeds, type SessionFeed } from "../lib/session-feed";
import type { Item } from "./items";
import type { Unsubscribe } from "./reads";
/** The state every job's calls share, over one client. */
export interface AppState {
  client: Client;
  workforce: WorkforceClient;
  inbox: ReturnType<typeof createInboxClient>;
  /** One feed per session, shared by every watch on it. */
  feeds: (sessionId: string) => SessionFeed;
  /** A session's items through `map`, on each change of its feed. */
  watchFeed<T>(sessionId: string, map: (items: Item[]) => T, onChange: (value: T) => void): Unsubscribe;
  /** The flow each run session belongs to, where a run's stop is answered. Kept, since a session's flow never changes. */
  runFlows: Map<string, string>;
  /** Each conversation's tasks' open holds, from its last read: what `answerOpenHold` answers. */
  openHolds: Map<string, Map<string, InboxHold[]>>;
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
  /** Each coding worker's `harness:`, from the same roster. */
  harnesses: Map<string, string>;
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
  // The roster, watched from the first conversation opened on: what `workerIds` and `harnesses` hold before its feed is read.
  // A read that fails before one lands fails that open, as `ensureWorkerSession`'s own roster read would, and the next open watches anew.
  let rosterRead: Promise<void> | undefined;
  let stopRoster = () => {};
  const rosterKnown = () => (rosterRead ??= new Promise<void>((landed, failed) => {
    let read = false;
    stopRoster = workforce.watchRoster((roster) => {
      read = true;
      state.workerIds = new Set(roster.map((w) => w.id));
      state.harnesses = new Map(roster.flatMap((w) => (typeof w.settings.harness === "string" ? [[w.id, w.settings.harness] as const] : [])));
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
    inbox: createInboxClient(client),
    feeds,
    watchFeed: <T>(sessionId: string, map: (items: Item[]) => T, onChange: (value: T) => void): Unsubscribe =>
      (feeds(sessionId) as SessionFeed).watch((items: readonly OutputItem[]) => onChange(map(items as unknown as Item[]))),
    runFlows: new Map(),
    openHolds: new Map(),
    runningNow: new Map(),
    sent: new Map(),
    stops: new Map(),
    stopWatchers,
    wake: (sessionId) => stopWatchers.get(sessionId)?.forEach((tell) => tell()),
    conversations,
    flowOfSession,
    workerIds: new Set(),
    harnesses: new Map(),
    conversationOf,
    close: () => stopRoster(),
  };
  return state;
}
