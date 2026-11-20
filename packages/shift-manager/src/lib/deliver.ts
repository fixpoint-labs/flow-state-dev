// BR-4; FIX-2776 D2.
/**
 * The one way Shift Manager sends a user's line into a worker's session, and
 * says whether it was delivered (S10): {@link useDeliverLine}. Every composer
 * that talks to a worker (a conversation's, a task's, Inbox's reply) sends
 * through it, and nothing else in Shift Manager writes a session item
 * (ER-15).
 *
 * The line goes through workforce's `send`, which sets the request id, sends
 * the task id only to a door that takes one, and answers `{ requestId }`.
 *
 * **Delivered means the session holds it.** The HTTP answer only says the
 * request started. A line counts as delivered only when its turn is
 * `completed` or `suspended`, by workforce's session turns view, **and** the
 * session's feed holds the turn's user item. Both are live reads the screen
 * already holds (`useView` and the page's shared session feed), so nothing is
 * polled. The two are separate streams, so a turn's end can land before the
 * feed shows the line, or the stop it raised: then the send reads the
 * session's items for that one request, once, and decides on that read. A
 * `suspended` turn stopped short of finishing, with the line in:
 * delivered with `suspended` set, and `stopped` saying on what. `ask` is a
 * user's ask Inbox lists, such as a Shift Coordinator's approval to fire a
 * worker; `wait` is any other pending suspension. `suspended`, not `stopped`,
 * is what tells a caller to read the Lab again: `stopped` only picks the
 * words.
 *
 * **Held comes first.** The user's line lands in the session as soon as the
 * door's request starts, long before the worker answers. `onHeld` hears the
 * moment the feed holds it, so a composer can draw the line and say the
 * worker is on it while the reply is in flight. Delivered still waits for
 * the turn to end.
 *
 * Three ways a line can fail to be delivered, and the caller keeps the draft
 * for each ({@link TurnNotDelivered}):
 *
 * - **refused**: the door's turn failed. It rejects with the door's own reason.
 * - **not sent**: the line never reached the Lab, or its turn ended some
 *   other way (aborted, interrupted). Safe to send again.
 * - **unconfirmed**: the line may have arrived, but Shift Manager can't
 *   confirm it. The worker didn't answer in time, the session's feed gave
 *   up, or the turn ended and the feed never showed the line. Sending again
 *   could send it twice, so nothing offers to.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FileContent, OutputItem } from "@flow-state-dev/core/items";
import { isUserSuspension } from "@flow-state-dev/core/types";
import { useView } from "@flow-state-dev/react";
import { deriveSuspensions } from "@flow-state-dev/react/internal";
import { sessionTurnsViewRef, type ListedTurn } from "@flow-state-dev/workforce/browser";
import type { Client } from "@flow-state-dev/client";
import { useLab } from "./lab-data";
import { describeFailure } from "./failure";
import { useSharedSessionFeed } from "./session-feeds";
import { useWorkforce } from "./workforce";

/** Why a line was not delivered. */
export class TurnNotDelivered extends Error {
  constructor(
    /**
     * `refused`: the door said no, and why. `not-sent`: it never got that
     * far, so sending again is safe. `unconfirmed`: it may have arrived.
     */
    readonly kind: "refused" | "not-sent" | "unconfirmed",
    message: string,
  ) {
    super(message);
    this.name = "TurnNotDelivered";
  }
}

/** How long a send waits for its turn to end and the session to hold the line. */
export const DELIVER_TIMEOUT_MS = 130_000;
/**
 * How long, after its turn ended, a send waits for the session's feed to show
 * the line. The feed and the turns view are two reads that each hear their
 * own change, so the turn's end can arrive first.
 */
export const HOLD_GRACE_MS = 10_000;

/** What the screen holds for one session now, as a send reads it. */
export type DeliveryWatch = {
  /** The session's feed's items, or `undefined` until its history landed. */
  items: readonly OutputItem[] | undefined;
  /** The feed gave up: what it last said. */
  feedStopped?: Error | null;
  /** The send's turn, by workforce's session turns view, once it lists it. */
  turn: Pick<ListedTurn, "status" | "error"> | undefined;
};

/** What a send has come to so far. */
export type Delivery =
  | { kind: "waiting"; held: boolean }
  /** The turn ended in, but the feed doesn't show the line yet. */
  | { kind: "answered" }
  | { kind: "delivered"; suspended: boolean; stopped: "ask" | "wait" | null }
  | { kind: "failed"; error: TurnNotDelivered };

const unconfirmed = (why: string) => new TurnNotDelivered("unconfirmed", `${why} Check the worker's session before sending it again.`);

/** Whether `items` hold the user's line from `requestId`. */
function holdsLine(items: readonly OutputItem[] | undefined, requestId: string): boolean {
  return (items ?? []).some((item) => item.requestId === requestId && item.type === "message" && (item as { role?: string }).role === "user");
}

/** What a suspended turn still waits on, from its own items: a user's ask, anything else, or nothing. */
function stopOf(items: readonly OutputItem[] | undefined, requestId: string): "ask" | "wait" | null {
  const pending = deriveSuspensions((items ?? []).filter((item) => item.requestId === requestId)).pending;
  return pending.some((view) => isUserSuspension(view.item)) ? "ask" : pending.length > 0 ? "wait" : null;
}

/** Items per page, and the pages read back from the session's end, when a send reads its own request's items. */
const ITEM_PAGE = 200;
const ITEM_PAGES = 20;

/**
 * The session's message and suspension items from `requestId`, read from the
 * newest page back until they hold the user's line, the page before held
 * none of the request's items, or the cap: what a send decides on when its
 * turn ended before the feed showed them. A new line is at the end, but its
 * turn's replies can fill more than a page after it.
 */
async function readRequestItems(client: Pick<Client, "sessions">, sessionId: string, requestId: string): Promise<OutputItem[]> {
  const read = (offset: number, limit: number) => client.sessions.state(sessionId, { includeItems: true, itemTypes: ["message", "suspension", "suspension_resume"], offset, limit });
  const mine = (items: readonly OutputItem[] | undefined) => (items ?? []).filter((item) => item.requestId === requestId);
  const first = await read(0, ITEM_PAGE);
  const total = first.pagination?.total ?? 0;
  if (total <= ITEM_PAGE) return mine(first.items);
  const held: OutputItem[] = [];
  let end = total;
  for (let page = 0; page < ITEM_PAGES; page += 1) {
    const offset = Math.max(0, end - ITEM_PAGE);
    const found = mine((await read(offset, end - offset)).items);
    // A page with none of the request's items, after one with some, is before the request began.
    if (found.length === 0 && held.length > 0) return held;
    held.unshift(...found);
    if (holdsLine(held, requestId) || offset === 0) return held;
    end = offset;
  }
  return held;
}

// FIX-2776 D2.
/** Where the send of `requestId` stands, by what the screen holds of its session now. */
export function deliveryOf(requestId: string, watch: DeliveryWatch): Delivery {
  const held = holdsLine(watch.items, requestId);
  const status = watch.turn?.status;
  if (status === "failed") {
    return { kind: "failed", error: new TurnNotDelivered("refused", watch.turn?.error?.message ?? "The worker refused the message and gave no reason.") };
  }
  if (status === "completed" || status === "suspended") {
    if (!held) return { kind: "answered" };
    if (status === "completed") return { kind: "delivered", suspended: false, stopped: null };
    // A suspended turn stops on a suspension it wrote: until the items show one, they lag the turn.
    const stopped = stopOf(watch.items, requestId);
    return stopped === null && !(watch.items ?? []).some((item) => item.requestId === requestId && item.type === "suspension")
      ? { kind: "answered" }
      : { kind: "delivered", suspended: true, stopped };
  }
  if (status !== undefined && status !== "in_progress") {
    return { kind: "failed", error: new TurnNotDelivered("not-sent", `The message's request ended ${status}.`) };
  }
  if (watch.feedStopped !== undefined) {
    return { kind: "failed", error: unconfirmed(`Couldn't read back whether the message arrived: ${watch.feedStopped?.message ?? "the session's feed stopped"}.`) };
  }
  return { kind: "waiting", held };
}

/** How often a send whose composer closed reads its turn's record. */
const DETACHED_POLL_MS = 1_000;

/**
 * Follow one send whose composer closed, by its session's records, to the
 * same verdict the live check reaches: its turn's status from the session's
 * requests, then, once it ended, the request's own items.
 */
async function settleDetached(client: Pick<Client, "sessions">, send: Pending): Promise<void> {
  try {
    while (Date.now() < send.until) {
      const listed = await client.sessions.requests(send.sessionId, { limit: 50 }).catch((): Awaited<ReturnType<Client["sessions"]["requests"]>> => []);
      const turn = listed.find((request) => request.id === send.requestId);
      if (turn !== undefined && turn.status !== "in_progress") {
        const items = await readRequestItems(client, send.sessionId, send.requestId);
        const settled = deliveryOf(send.requestId, { items, turn: { status: turn.status, error: null } });
        if (settled.kind === "delivered") send.resolve({ requestId: send.requestId, suspended: settled.suspended, stopped: settled.stopped });
        else if (settled.kind === "failed") send.reject(settled.error);
        else send.reject(unconfirmed("The worker answered, but its session doesn't hold your message."));
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, DETACHED_POLL_MS));
    }
    send.reject(unconfirmed("The worker did not answer in time; the message may still arrive."));
  } catch (error) {
    send.reject(unconfirmed(`Couldn't read back whether the message arrived: ${describeFailure(error).message}.`));
  }
}

/** What a delivered line came to. */
export type Delivered = { requestId: string; suspended: boolean; stopped: "ask" | "wait" | null };

/** One send in flight: where it settles, and what it heard so far. */
type Pending = {
  requestId: string;
  /** The session the line went to: what it is judged against. */
  sessionId: string;
  onHeld?: () => void;
  heldTold: boolean;
  answeredAt?: number;
  /** The one read of the request's own items, once its turn ended ahead of the feed. */
  readBack?: Promise<void>;
  until: number;
  resolve(value: Delivered): void;
  reject(error: unknown): void;
};

/**
 * The delivery check one composer sends through. Returns `deliver`: send
 * `message` to session `to.sessionId`, from task `to.taskId` when there is
 * one, and resolve once it is delivered. Rejects with
 * {@link TurnNotDelivered} otherwise.
 *
 * `options.onHeld` is called once, while the turn still runs, when the
 * session's feed first holds the line. `options.onStarted` hears the request
 * id once the server took the send.
 */
export function useDeliverLine() {
  const { client } = useLab();
  const workforce = useWorkforce();
  // The session the last send went to: its feed and turns are what the check reads.
  const [target, setTarget] = useState<string | null>(null);
  const feed = useSharedSessionFeed(target);
  const turnsView = useMemo(() => sessionTurnsViewRef(), []);
  const { value: turns } = useView(turnsView, { sessionId: target ?? "-" }, { client, enabled: target !== null });
  const pending = useRef(new Set<Pending>());
  const inFlight = useRef(false);
  // Set once the composer closed: a send the server answers after that has no screen to settle it.
  const closed = useRef(false);
  const [tick, setTick] = useState(0);

  const latest = useRef<{ target: string | null; items: readonly OutputItem[] | undefined; feedStopped?: Error | null; turns: readonly ListedTurn[] | undefined }>({ target: null, items: undefined, turns: undefined });
  latest.current = {
    target,
    items: feed?.items,
    ...(feed?.state === "stopped" ? { feedStopped: feed.error } : {}),
    turns,
  };

  // Every change to what the screen holds settles what it can.
  useEffect(() => {
    const now = Date.now();
    for (const send of [...pending.current]) {
      const watch = latest.current;
      const delivery = deliveryOf(send.requestId, {
        items: watch.items,
        ...(watch.feedStopped === undefined ? {} : { feedStopped: watch.feedStopped }),
        turn: watch.turns?.find((turn) => turn.id === send.requestId),
      });
      const settle = (outcome: () => void) => {
        pending.current.delete(send);
        outcome();
      };
      if (delivery.kind === "delivered") settle(() => send.resolve({ requestId: send.requestId, suspended: delivery.suspended, stopped: delivery.stopped }));
      else if (delivery.kind === "failed") settle(() => send.reject(delivery.error));
      else if (delivery.kind === "answered") {
        send.answeredAt ??= now;
        const turn = watch.turns?.find((t) => t.id === send.requestId);
        // The feed lags the turn: read the request's own items, once, and decide on them.
        send.readBack ??= readRequestItems(client, send.sessionId, send.requestId).then(
          (items) => {
            if (!pending.current.has(send)) return;
            const read = deliveryOf(send.requestId, { items, turn });
            if (read.kind === "delivered") settle(() => send.resolve({ requestId: send.requestId, suspended: read.suspended, stopped: read.stopped }));
            else if (turn?.status === "suspended" && holdsLine(items, send.requestId)) {
              // In, and stopped on something this read can't name: the caller reads the Lab again either way.
              settle(() => send.resolve({ requestId: send.requestId, suspended: true, stopped: "wait" }));
            }
          },
          (error: unknown) => {
            if (pending.current.has(send)) settle(() => send.reject(unconfirmed(`Couldn't read back whether the message arrived: ${describeFailure(error).message}.`)));
          },
        );
        if (now - send.answeredAt >= HOLD_GRACE_MS) settle(() => send.reject(unconfirmed("The worker answered, but its session doesn't hold your message.")));
      } else {
        if (delivery.held && !send.heldTold) {
          send.heldTold = true;
          send.onHeld?.();
        }
        if (now >= send.until) settle(() => send.reject(unconfirmed("The worker did not answer in time; the message may still arrive.")));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed?.items, feed?.state, turns, tick, client]);

  // A composer that closes mid-send still hears how its line ended (it clears or keeps the stored
  // draft by it): each send still pending is followed on its own, by its session's records, from here.
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
      for (const send of [...pending.current]) void settleDetached(client, send);
      pending.current.clear();
    };
  }, [client]);

  // A clock only for the deadlines: what a send waits on is pushed.
  useEffect(() => {
    const timer = setInterval(() => {
      if (pending.current.size > 0) setTick((n) => n + 1);
    }, 1_000);
    return () => clearInterval(timer);
  }, []);

  return useCallback(
    async (
      to: { sessionId: string; taskId?: string },
      message: string,
      options: { attachments?: readonly FileContent[]; onHeld?: () => void; onStarted?: (requestId: string) => void } = {},
    ): Promise<Delivered> => {
      // The check follows one session at a time: a second line waits for the first to land.
      if (inFlight.current) throw new TurnNotDelivered("not-sent", "A line to this worker is still on its way. Send this one once it lands.");
      inFlight.current = true;
      setTarget(to.sessionId);
      let requestId: string;
      try {
        ({ requestId } = await workforce.send(to.sessionId, message, {
          ...(options.attachments !== undefined && options.attachments.length > 0 ? { attachments: options.attachments } : {}),
          ...(to.taskId === undefined ? {} : { taskId: to.taskId }),
        }));
      } catch (error) {
        inFlight.current = false;
        throw new TurnNotDelivered("not-sent", describeFailure(error).message);
      }
      options.onStarted?.(requestId);
      const settled = new Promise<Delivered>((resolve, reject) => {
        const send: Pending = {
          requestId,
          sessionId: to.sessionId,
          ...(options.onHeld === undefined ? {} : { onHeld: options.onHeld }),
          heldTold: false,
          until: Date.now() + DELIVER_TIMEOUT_MS,
          resolve,
          reject,
        };
        // The composer closed while the send was out: follow it on its own, as one pending at close is.
        if (closed.current) {
          void settleDetached(client, send);
          return;
        }
        pending.current.add(send);
        setTick((n) => n + 1);
      });
      return settled.finally(() => {
        inFlight.current = false;
      });
    },
    [client, workforce],
  );
}
