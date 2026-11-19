/**
 * What every screen on one conversation shares, so a conversation is read
 * once however many screens show it: what its one follower read
 * (`ConversationFollower`, `src/app/conversations.ts`), the feed a send
 * streams its answer into, the flow it runs on, and its Stop under way.
 * Holds no reads; `AppProvider` holds one.
 */
import type { SessionConnectionStatus } from "@flow-state-dev/client";
import type { ConversationView, WindowMark } from "./conversation";

/** What a conversation's follower read last. */
type Followed = {
  /** `undefined` until the history read lands: the connection can already say it gave up. */
  view: ConversationView | undefined;
  /** Whether its feed still hears the server, in the session feed's words. */
  connection: SessionConnectionStatus;
  /** The divider; `undefined` while the whole conversation is inside the window. */
  mark: WindowMark | undefined;
  /** Keep a send's streamed response in its feed, so the answer shows as it is written. */
  follow: (response: Response) => void;
};

/** A Stop under way: the turns it stopped, `null` while it reads which. */
type Stop = { ids: ReadonlySet<string> | null };

/** Each conversation's shared reads and Stop, by session id, with one change signal for `useSyncExternalStore`. */
export function conversationStore() {
  const followed = new Map<string, Followed>();
  const stops = new Map<string, Stop>();
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const tell of [...listeners]) tell();
  };
  return {
    /** The flow each opened conversation runs on: what an approval is answered through. */
    flows: new Map<string, string>(),
    /** What conversation `sessionId`'s follower read last, the same object until it reads anew. */
    read: (sessionId: string): Followed | undefined => followed.get(sessionId),
    /** A follower's latest read; `undefined` once it stops following. */
    publish(sessionId: string, read: Followed | undefined): void {
      if (read === undefined) followed.delete(sessionId);
      else followed.set(sessionId, read);
      changed();
    },
    /** Conversation `sessionId`'s Stop under way, a new object on each change. */
    stopOf: (sessionId: string): Stop | undefined => stops.get(sessionId),
    /** Set the Stop under way, or end it (`undefined`); with `was`, only while `was` is still the one under way, so a later press keeps its own. */
    setStop(sessionId: string, stop: Stop | undefined, was?: Stop): void {
      if (was !== undefined && stops.get(sessionId) !== was) return;
      if (stop === undefined) stops.delete(sessionId);
      else stops.set(sessionId, stop);
      changed();
    },
    /** Called on every change; returns the stop. */
    subscribe(tell: () => void): () => void {
      listeners.add(tell);
      return () => void listeners.delete(tell);
    },
  };
}
