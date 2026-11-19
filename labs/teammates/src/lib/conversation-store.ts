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
  view: ConversationView;
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
export class Conversations {
  private readonly followed = new Map<string, Followed>();
  private readonly stops = new Map<string, Stop>();
  /** The flow each opened conversation runs on: what an approval is answered through. */
  readonly flows = new Map<string, string>();
  private readonly listeners = new Set<() => void>();

  /** What conversation `sessionId`'s follower read last, the same object until it reads anew. */
  read(sessionId: string): Followed | undefined {
    return this.followed.get(sessionId);
  }

  /** A follower's latest read; `undefined` once it stops following. */
  publish(sessionId: string, followed: Followed | undefined): void {
    if (followed === undefined) this.followed.delete(sessionId);
    else this.followed.set(sessionId, followed);
    this.changed();
  }

  /** Conversation `sessionId`'s Stop under way, a new object on each change. */
  stopOf(sessionId: string): Stop | undefined {
    return this.stops.get(sessionId);
  }

  /** Set the Stop under way, or end it (`undefined`); ending one only ends `was`, when given, so a later press keeps its own. */
  setStop(sessionId: string, stop: Stop | undefined, was?: Stop): void {
    if (was !== undefined && this.stops.get(sessionId) !== was) return;
    if (stop === undefined) this.stops.delete(sessionId);
    else this.stops.set(sessionId, stop);
    this.changed();
  }

  /** Called on every change; returns the stop. */
  subscribe = (tell: () => void): (() => void) => {
    this.listeners.add(tell);
    return () => this.listeners.delete(tell);
  };

  private changed(): void {
    for (const tell of [...this.listeners]) tell();
  }
}
