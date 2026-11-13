// FIX-2428.
/**
 * The push-delivery wire: what a client and a server say to each
 * other to carry change notices to a browser.
 *
 * A client asks the server which push it has (`GET /capabilities` →
 * {@link PushCapability}), then mints: it posts the topics it wants to
 * `POST /users/:userId/stream`, and the server checks each one and answers a
 * {@link PushMintAnswer} that carries only the topics it granted. On the
 * WebSocket arm, the client opens the socket the answer names and sends the
 * ticket as its first message ({@link PushClientFrame}); the server sends
 * notices and control frames back ({@link PushServerFrame}).
 *
 * Notices carry no rows. A notice says *that* something under a topic
 * changed, and may name the ids of what changed; the client reads *what*
 * through the route it already reads with.
 */
import type { ChangeKind, WireTopic } from "./change-notice";

/**
 * The push a server has, as `GET /capabilities` reports it in `push`, or
 * `null` when it has none (a serverless host, `createServerApp` alone). It
 * only advertises: once a client mints, the answer's `transport` decides.
 */
export type PushCapability = { transport: "websocket" } | { transport: "ably" };

/**
 * The most topics one mint takes. A longer list is refused whole, so a client
 * with more topics mints them in chunks of this size.
 */
export const PUSH_MINT_MAX_TOPICS = 100;

/** The body of `POST /users/:userId/stream`: the topics to hear, at most {@link PUSH_MINT_MAX_TOPICS}. */
export type PushMintRequest = { topics: WireTopic[] };

/**
 * The answer to a mint, keyed by transport. Both arms carry only the granted
 * topics: a topic the caller may not hear is absent, exactly as a topic for a
 * session that doesn't exist is.
 *
 * - `websocket`: a short-lived signed `ticket` to send as the socket's first
 *   message, and the socket's `path`, relative to the flow API's mount.
 * - `ably`: an Ably token request and the channels it covers. Defined here so
 *   an Ably transport shares this answer; no host serves it yet. An open
 *   Ably connection counts as crossing processes, so no `crossing` frame is
 *   sent or awaited on that arm.
 */
export type PushMintAnswer =
  | { transport: "websocket"; ticket: string; path: string; topics: WireTopic[] }
  | { transport: "ably"; tokenRequest: Record<string, unknown>; channels: string[]; topics: WireTopic[] };

// FIX-2625.
/**
 * The most ids one notice carries. A fold or a merge that would carry more
 * carries none, which means read everything.
 */
export const NOTICE_MAX_IDS = 100;

/**
 * The ids two notices of one topic and kind carry together: their union, in
 * the order first named, or `undefined` (read everything) when either carries
 * none or the union passes {@link NOTICE_MAX_IDS}. No ids beats ids. The one
 * rule for it: the engine's fold and the client's merge both call this.
 */
export function unionNoticeIds(a: readonly string[] | undefined, b: readonly string[] | undefined): string[] | undefined {
  if (a === undefined || b === undefined) return undefined;
  const union = [...new Set([...a, ...b])];
  return union.length > NOTICE_MAX_IDS ? undefined : union;
}

/**
 * A change notice as the socket delivers it: the topic it happened under (the
 * resource included when the change was narrowed to one), its kind, the
 * request that made it, when a request did, and the ids of what changed, when
 * the publisher knew them. Never the rows that changed.
 */
export type WireNotice = {
  topic: WireTopic;
  kind: ChangeKind;
  origin?: { requestId: string };
  /**
   * Which rows changed: opaque ids the publisher already holds (a task on a
   * `board` notice, an entry's storage key on a collection entry's `resource`
   * notice, a session on a `run` notice, a request on a `request` notice), at
   * most {@link NOTICE_MAX_IDS}. Absent: read everything. A hint, never data:
   * a reader that can't use them reads everything.
   */
  ids?: string[];
};

/**
 * What a server sends on the socket.
 *
 * - `notice`: a change under a topic the socket subscribed.
 * - `subscribed`: a delivery control frame acknowledging one accepted ticket,
 *   in the order the tickets arrived. Sent once the ticket's topics are heard,
 *   so a read the client makes after it misses no change under them.
 * - `crossing`: a delivery control frame saying whether this process's bus
 *   hears changes made in other processes. Sent after the first ticket's
 *   `subscribed`, and on each change of the answer.
 *
 * Control frames are never a notice kind, and never carry rows.
 */
export type PushServerFrame =
  | ({ type: "notice" } & WireNotice)
  | { type: "subscribed" }
  | { type: "crossing"; crosses: boolean };

/**
 * What a client sends on the socket.
 *
 * - `subscribe`: a ticket from the mint. The first message must be one; later
 *   ones add the topics they grant. A topic is accepted only from a ticket.
 * - `unsubscribe`: stop hearing topics. Needs no ticket.
 */
export type PushClientFrame = { type: "subscribe"; ticket: string } | { type: "unsubscribe"; topics: WireTopic[] };

/**
 * The close codes a server ends a socket with. A client mints again and
 * reconnects after any of them.
 */
export const PUSH_CLOSE_CODES = {
  /** The socket reached its age limit (an hour). Reconnect at once. */
  maxAge: 4000,
  /** A ticket failed its check: a bad signature, expired, or for another user. */
  ticketRefused: 4401,
  /** No valid ticket arrived in time after the socket opened. */
  ticketTimeout: 4408,
  /** A frame that isn't one of {@link PushClientFrame}. */
  badFrame: 4400
} as const;

/** The key two equal wire topics share: scope, session id and resource. */
export function wireTopicKey(topic: WireTopic): string {
  const id = topic.scope === "session" ? topic.id : "";
  return `${topic.scope}\u0000${id}\u0000${topic.resource ?? ""}`;
}
