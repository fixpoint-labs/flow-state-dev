/**
 * The change bus contract (FIX-2426): a notice that something under a topic
 * changed, published once the change can be read, and heard by whoever
 * subscribed to the topic.
 *
 * A notice never carries rows. It says *when* to read; the listener reads
 * *what* through the route it already reads with, which does its own checks.
 * Notices are at most once: no replay, no acks, nothing stored. A listener
 * that may have missed some reads again.
 *
 * The bus is the `bus` slot of a stores profile. The in-memory bus is the
 * default; an adapter that carries notices between processes (the Postgres
 * bus) says so through `crossesProcesses`, and only that turns the session
 * stream's once-a-second read off.
 */
import type { ChangeKind, TopicScope } from "@flow-state-dev/core";

/**
 * A topic as the server names it: a scope, the scope's id (the bare session
 * id, the user id or the org id), the tenant, and optionally one resource
 * under the scope. `tenantId` is required, so no subscriber hears another
 * tenant's notices; a single-tenant app's tenant is `""`. Adapters derive
 * their channel names from it.
 */
export type BusTopic = {
  scope: TopicScope;
  id: string;
  tenantId: string;
  resource?: string;
};

/**
 * One change: the topic it happened under, its kind, and optionally the
 * request that made it. Never the rows that changed.
 */
export type ChangeNotice = {
  topic: BusTopic;
  kind: ChangeKind;
  /** The request that made the change, when a request made it. */
  origin?: { requestId: string };
};

/** Called with each notice a subscription hears. */
export type ChangeListener = (notice: ChangeNotice) => void;

/**
 * The bus an adapter backs.
 *
 * **Who hears a notice.** A subscriber to a scope's topic with no `resource`
 * hears every notice under that scope, narrowed or not, and receives the
 * notice's own topic. A subscriber narrowed to a resource hears only notices
 * narrowed to that resource. Scope, id and tenant always match exactly.
 *
 * **Reconnects.** A bus that lost its connection and got it back sends each
 * subscriber one notice of kind `resync` on its subscribed topic: it may have
 * missed some, so every subscriber reads once.
 */
export interface ChangeBus {
  /**
   * Send a notice. Called only after the change it names can be read. A
   * failure is the bus's to report; it never fails the write that caused it.
   */
  publish(notice: ChangeNotice): Promise<void>;
  /**
   * Hear the notices under `topic` (see "Who hears a notice"). Returns the
   * unsubscribe.
   */
  subscribe(topic: BusTopic, listener: ChangeListener): () => void;
  /**
   * Whether a notice published in another process reaches this process's
   * subscribers right now. May change at runtime; each change is delivered
   * through {@link ChangeBus.onCrossingChange}.
   */
  readonly crossesProcesses: boolean;
  /**
   * Hear each change of {@link ChangeBus.crossesProcesses}. Returns the
   * unsubscribe. A bus whose answer never changes never calls it.
   */
  onCrossingChange(listener: (crosses: boolean) => void): () => void;
}
