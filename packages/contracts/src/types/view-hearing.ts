// FIX-2625, FIX-2734.
/**
 * Which change notices a view's answer hears: the one rule, shared by the
 * client that applies it (`watchView`, `client.live`) and the engine and
 * orchestration tests that check an answer against it.
 *
 * - {@link covers}: whether a subscribed topic covers a notice's topic.
 * - {@link mayHold}: whether a notice's resource path may belong under a
 *   screen's storage roots.
 * - {@link hearsNotice}: whether a notice may change what an answer's run
 *   read, by the answer's {@link ViewHearing} list.
 *
 * Not on the package root: the framework's own packages import it from this
 * subpath.
 */
import type { ChangeKind, WireTopic } from "./change-notice";
import type { WireNotice } from "./push-delivery";

/**
 * Which notices under one of a view answer's topics may change what its run
 * read. A watcher reads again on a notice its topic covers whose kind is
 * listed and, for a `resource` notice that names a path, whose path falls at
 * or under one of `paths` ({@link mayHold}). A `resource` notice that names
 * no path always reads. A `resync` is not decided here: the watcher reads on
 * it before this rule runs.
 *
 * - `state`, on a user or org topic: the scope's state was read.
 * - `state`, on a session topic: the session's state was read.
 * - `items`, `request`, `run` and `state`, on a session topic: the session
 *   itself was read (its items, metadata or history).
 * - `resource`, with `paths`: a resource was read, at its storage key or a
 *   collection's root.
 * - `board`, on a session topic narrowed to a board: a task board was read
 *   through its task collection, whose every write publishes its board notice
 *   there. Its ledger's own resource notices are not heard.
 * - `board`, with `partitions`: a partitioned board was read at those
 *   partitions, so a `board` notice that names another partition can't change
 *   it ({@link hearsNotice}).
 */
export type ViewHearing = {
  readonly topic: WireTopic;
  readonly kinds: readonly ChangeKind[];
  readonly paths?: readonly string[];
  // FIX-2750.
  /**
   * The partitions of a partitioned board the run read, as opaque keys
   * (`WireNotice.partition`), its empty ones included. Absent: the board was
   * read whole, or by a server from before partitions, and every `board`
   * notice under the topic is heard.
   */
  readonly partitions?: readonly string[];
};

/** Whether `subscribed` covers a notice under `heard`. */
export function covers(subscribed: WireTopic, heard: WireTopic): boolean {
  if (subscribed.scope !== heard.scope) return false;
  if (subscribed.scope === "session" && heard.scope === "session" && subscribed.id !== heard.id) return false;
  return subscribed.resource === undefined || subscribed.resource === heard.resource;
}

// FIX-1506, FIX-2551.
/** `root` without the trailing slashes a prefix constant may carry (`workforce/workers/`). */
const bare = (root: string): string => root.replace(/\/+$/, "");

/**
 * The path rule: whether a change at storage path `path` may belong under one
 * of `roots`: at a root, below it, or above it (a change at an ancestor may
 * touch anything beneath it: on the user topic a write through a broader
 * collection names that collection's root). `undefined` roots rule nothing
 * out (not known yet), and nor does an empty root (a pattern with no static
 * prefix). A false yes costs one read; a false no leaves a screen stale, so
 * every doubt answers yes.
 */
export function mayHold(path: string, roots: readonly string[] | undefined): boolean {
  if (roots === undefined) return true;
  return roots.some((given) => {
    const root = bare(given);
    return root === "" || path === root || path.startsWith(`${root}/`) || root.startsWith(`${path}/`);
  });
}

/**
 * Whether `notice` may change what an answer's run read: a hearing whose topic
 * covers it lists its kind, a `resource` notice's path falls under the
 * hearing's roots ({@link mayHold}), and a `board` notice's partition is one
 * the hearing lists, when both name one. Every notice, for an answer that
 * names no hearing.
 */
export function hearsNotice(hears: readonly ViewHearing[] | undefined, notice: WireNotice): boolean {
  if (hears === undefined) return true;
  return hears.some(
    (hearing) =>
      covers(hearing.topic, notice.topic) &&
      hearing.kinds.includes(notice.kind) &&
      (notice.kind !== "resource" || notice.topic.resource === undefined || mayHold(notice.topic.resource, hearing.paths)) &&
      (notice.kind !== "board" || notice.partition === undefined || hearing.partitions === undefined || hearing.partitions.includes(notice.partition))
  );
}
