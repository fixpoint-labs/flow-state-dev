/**
 * The shared half of a change notice: what kind of change it names, and the
 * wire topic a client watches.
 *
 * A notice says *that* something under a topic changed, never *what*: it
 * carries no rows. Whoever hears one reads again through the route it already
 * reads with. The server's bus topic (in `@flow-state-dev/engine`) adds the
 * ids a client never names; the wire topic here names no user, org or tenant
 * id, so a client cannot ask for someone else's scope by naming it. The server
 * fills those from the caller it verified.
 */

/**
 * What changed under a topic.
 *
 * - `items` — an item was kept under one of the session's requests.
 * - `request` — one of the session's requests was written: created, its
 *   status moved, or deleted.
 * - `run` — a session record was written: the topic's own session, or a run
 *   (a child session) under it.
 * - `state` — the scope's state was written: a session, user or org patch.
 * - `resource` — a resource under the scope was written, created or deleted.
 *   The topic names it in `resource`.
 * - `board` — a row on a task board changed, on the topic of the
 *   session that filed it, narrowed to the board's id. The session stream
 *   ignores it: a board is read through its own read.
 * - `resync` — the bus may have missed notices (it reconnected). Every
 *   subscriber reads once, whatever kinds it otherwise listens for.
 */
export type ChangeKind = "items" | "request" | "run" | "state" | "resource" | "board" | "resync";

/** The scopes a topic can name. No other topic exists. */
export type TopicScope = "session" | "user" | "org";

/**
 * A topic as a client names it: a scope, the session's id for a session, and
 * optionally one resource under the scope. No user, org or tenant id.
 */
export type WireTopic =
  | { scope: "session"; id: string; resource?: string }
  | { scope: "user" | "org"; resource?: string };

/** Narrow a topic to one resource under its scope. */
export type TopicOptions = { resource?: string };

function narrowed(options: TopicOptions | undefined): { resource?: string } {
  return options?.resource !== undefined ? { resource: options.resource } : {};
}

/**
 * The wire topic constructors. `topic.session(id)` watches one session,
 * `topic.user()` the caller's own user scope and `topic.org()` the caller's
 * organization. Each takes an optional `{ resource }` to watch one resource
 * under the scope.
 */
export const topic = {
  session(id: string, options?: TopicOptions): WireTopic {
    return { scope: "session", id, ...narrowed(options) };
  },
  user(options?: TopicOptions): WireTopic {
    return { scope: "user", ...narrowed(options) };
  },
  org(options?: TopicOptions): WireTopic {
    return { scope: "org", ...narrowed(options) };
  }
} as const;
