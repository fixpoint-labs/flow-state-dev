// FIX-2428.
/**
 * One push socket's session: which topics it hears, and the
 * frames it sends. Transport-neutral: a host takes the upgrade and moves
 * frames (`@flow-state-dev/node`'s `serve()`), and this decides everything
 * else, so a later host reuses the check.
 *
 * - **Topics come only from tickets.** The first message must be a ticket
 *   (`{ type: "subscribe", ticket }`) the mint signed for the user the
 *   socket's path names; each later ticket adds its topics. A ticket that
 *   fails its check is logged and the socket closed (4401). No ticket within
 *   five seconds closes it too (4408).
 * - **No check while open** (D2). An open socket hears its topics until it
 *   closes, at most an hour after it opened (4000); the client mints again to
 *   reconnect, and the mint checks again.
 * - **`subscribed` frames.** Each accepted ticket is acknowledged once its
 *   topics are subscribed on the bus, so the client reads after that point.
 * - **`crossing` frames.** After the first ticket, and on each change, the
 *   socket says whether its process's bus hears other processes. A control
 *   frame about the socket, never a notice kind.
 */
import { type WireTopic } from "@flow-state-dev/core";
import { PUSH_CLOSE_CODES, wireTopicKey, type PushServerFrame } from "@flow-state-dev/core/internal";
import type { BusTopic, ChangeBus, ChangeNotice } from "../bus/types";
import { verifyPushTicket } from "./ticket";
import type { NoticeIdScopes } from "../runtime-config";

/** The socket session's clocks. */
export const PUSH_SOCKET_TIMINGS = {
  /** A socket with no valid ticket this long after it opened is closed. */
  ticketTimeoutMs: 5_000,
  /** A socket is closed this long after it opened; the client reconnects. */
  maxAgeMs: 60 * 60_000
} as const;

/** How a session talks to its socket. The host moves frames; nothing else. */
export type PushSocketIO = {
  send(frame: PushServerFrame): void;
  close(code: number, reason: string): void;
};

/** What a host tells the session about its socket. */
export type PushSocket = {
  /** A text message the client sent. */
  receive(data: string): void;
  /** The socket closed, from either side. Idempotent. */
  closed(): void;
};

export type OpenPushSocketOptions = {
  bus: ChangeBus;
  /** The signing secret, read on each check. */
  secret: () => string;
  /** The user the socket's path names. Every ticket must be minted for them. */
  userId: string;
  io: PushSocketIO;
  /** Where a refused ticket is reported. Default `console`. */
  logger?: { warn(message: string, meta?: Record<string, unknown>): void };
  // FIX-2625 D2.
  /** Which scopes' notices may name what changed (`RuntimeConfig.noticeIds`). Default: every scope's. */
  noticeIds?: NoticeIdScopes;
};

/** A bus topic as the wire names it: no tenant, and no user or org id. */
function toWire(topic: Omit<BusTopic, "resource"> & { resource?: string | undefined }): WireTopic {
  const resource = topic.resource !== undefined ? { resource: topic.resource } : {};
  return topic.scope === "session" ? { scope: "session", id: topic.id, ...resource } : { scope: topic.scope, ...resource };
}

/** The key two equal bus topics share. */
function busKey(topic: BusTopic): string {
  return `${topic.scope}\u0000${topic.tenantId}\u0000${topic.id}\u0000${topic.resource ?? ""}`;
}

/** Start the session for a socket that just opened. */
export function openPushSocket(options: OpenPushSocketOptions): PushSocket {
  const { bus, io, userId } = options;
  const logger = options.logger ?? console;
  /** Bus key → the topic as the wire names it, and its unsubscribe. */
  const subscriptions = new Map<string, { wireKey: string; off: () => void }>();
  let crossingOff: (() => void) | undefined;
  let accepted = false;
  let ended = false;

  const end = (): void => {
    if (ended) return;
    ended = true;
    clearTimeout(ticketTimer);
    clearTimeout(ageTimer);
    crossingOff?.();
    for (const { off } of subscriptions.values()) off();
    subscriptions.clear();
  };
  const close = (code: number, reason: string): void => {
    if (ended) return;
    end();
    io.close(code, reason);
  };

  const ticketTimer = setTimeout(
    () => close(PUSH_CLOSE_CODES.ticketTimeout, "no ticket"),
    PUSH_SOCKET_TIMINGS.ticketTimeoutMs
  );
  const ageTimer = setTimeout(() => close(PUSH_CLOSE_CODES.maxAge, "max age"), PUSH_SOCKET_TIMINGS.maxAgeMs);
  // Neither clock keeps a process alive on its own.
  (ticketTimer as { unref?: () => void }).unref?.();
  (ageTimer as { unref?: () => void }).unref?.();

  const send = (frame: PushServerFrame): void => {
    if (!ended) io.send(frame);
  };
  // FIX-2625 D2: the one place a notice's ids reach a browser, so the
  // per-scope switch lives here. With ids off for the notice's scope it goes
  // out with none, and a collection entry's notice (one that names its entry)
  // goes to a scope-wide subscription on the bare scope topic, as an
  // owner-private row's already does: the entry's path is an id too. A
  // subscription narrowed to that entry keeps the path its client named.
  const idsOff = (scope: BusTopic["scope"]): boolean => options.noticeIds?.[scope] === false;
  const hear = (notice: ChangeNotice, subscribed: BusTopic): void => {
    const off = idsOff(notice.topic.scope);
    const entry = notice.kind === "resource" && notice.ids !== undefined;
    const topic = off && entry && subscribed.resource === undefined ? { ...notice.topic, resource: undefined } : notice.topic;
    send({
      type: "notice",
      topic: toWire(topic),
      kind: notice.kind,
      ...(notice.origin !== undefined ? { origin: notice.origin } : {}),
      ...(!off && notice.ids !== undefined ? { ids: notice.ids } : {})
    });
  };

  const subscribe = (ticket: unknown): void => {
    const checked = verifyPushTicket(ticket, options.secret(), userId);
    if (!checked.ok) {
      logger.warn(`[flow-state] push socket refused a ticket (${checked.reason}); closing it`, {
        reason: checked.reason,
        userId
      });
      close(PUSH_CLOSE_CODES.ticketRefused, "ticket refused");
      return;
    }
    for (const granted of checked.claims.topics) {
      const key = busKey(granted.bus);
      if (subscriptions.has(key)) continue;
      subscriptions.set(key, {
        wireKey: wireTopicKey(toWire(granted.bus)),
        off: bus.subscribe(granted.bus, (notice) => hear(notice, granted.bus))
      });
    }
    // Its topics are heard from here on: a read the client makes once it
    // hears this misses nothing under them.
    send({ type: "subscribed" });
    if (accepted) return;
    accepted = true;
    clearTimeout(ticketTimer);
    send({ type: "crossing", crosses: bus.crossesProcesses });
    crossingOff = bus.onCrossingChange((crosses) => send({ type: "crossing", crosses }));
  };

  const unsubscribe = (topics: unknown): void => {
    if (!Array.isArray(topics) || !topics.every(isWireTopic)) {
      close(PUSH_CLOSE_CODES.badFrame, "bad frame");
      return;
    }
    // A socket only holds topics a ticket granted, all for this socket's
    // tenant and caller, so the wire form names exactly one of them.
    const keys = new Set(topics.map(wireTopicKey));
    for (const [key, held] of [...subscriptions]) {
      if (!keys.has(held.wireKey)) continue;
      held.off();
      subscriptions.delete(key);
    }
  };

  return {
    receive(data) {
      if (ended) return;
      let frame: unknown;
      try {
        frame = JSON.parse(data);
      } catch {
        close(PUSH_CLOSE_CODES.badFrame, "bad frame");
        return;
      }
      const type = (frame as { type?: unknown } | null)?.type;
      if (type === "subscribe") {
        subscribe((frame as { ticket?: unknown }).ticket);
        return;
      }
      if (type === "unsubscribe" && accepted) {
        unsubscribe((frame as { topics?: unknown }).topics);
        return;
      }
      close(PUSH_CLOSE_CODES.badFrame, "bad frame");
    },
    closed: end
  };
}

/** Whether `value` is a wire topic: a scope, a session's id, an optional resource. */
export function isWireTopic(value: unknown): value is WireTopic {
  if (typeof value !== "object" || value === null) return false;
  const topic = value as Record<string, unknown>;
  const keys = Object.keys(topic);
  if (topic.resource !== undefined && typeof topic.resource !== "string") return false;
  if (topic.scope === "session") {
    return typeof topic.id === "string" && topic.id.length > 0 && keys.every((key) => ["scope", "id", "resource"].includes(key));
  }
  if (topic.scope === "user" || topic.scope === "org") {
    return keys.every((key) => ["scope", "resource"].includes(key));
  }
  return false;
}
