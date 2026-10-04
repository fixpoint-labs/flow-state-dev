/**
 * The one way Shift Manager sends a person's line into a worker's session (S10).
 *
 * Every composer that talks to a worker (a task's, `@worker` in a workstream,
 * Inbox's reply) calls {@link sendTurn}, and nothing else in Shift Manager writes a
 * session item (ER-15). The line goes to the **door** the session's own flow
 * declares: the seat inventory row for the flow the session records as its
 * owner names it. Shift Manager knows no kind and no action name of its own.
 *
 * **Delivered means the session holds it (BR-4).** The door's request is
 * followed until it ends or stops. A line counts as delivered only when that
 * request is `completed` or `suspended` **and** the target session holds the
 * request's user item. The HTTP answer alone never says so: it only says the
 * request started. A `suspended` request stopped short of finishing, with the
 * line in: the send resolves with `suspended` set, and `stopped` saying on
 * what. `ask` is a person's ask Inbox lists, such as a chief of staff's
 * approval to fire a seat; `wait` is any other suspension, which Inbox
 * doesn't list. `suspended`, not `stopped`, is what tells a caller to read
 * the Lab again: `stopped` only picks the words, so a stop it reads wrong,
 * or reads as gone, never keeps an ask out of Inbox.
 *
 * **Held comes first.** The person's line lands in the session as soon as the
 * door's request starts, long before the worker answers. A caller that passes
 * `onHeld` hears the moment the session holds the line, so it can draw the
 * line and say the worker is on it while the reply is in flight. Delivered
 * still waits for the request to end.
 *
 * Three ways a line can fail to be delivered, and the caller keeps the draft
 * for each:
 *
 * - **refused**: the door's request failed. It rejects with the door's own reason.
 * - **not sent**: the line never reached the Lab, or its request ended some
 *   other way (aborted, interrupted). Safe to send again.
 * - **unconfirmed**: the line may have arrived, but Shift Manager can't confirm it.
 *   The worker didn't answer in time, the session read failed, or the session
 *   doesn't show it. Sending again could send it twice, so nothing offers to.
 *
 * Only a failure of a client call counts as one of these. A fault in this
 * module's own reading is thrown as it is.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type { LabClients } from "./connection";
import { deriveSuspensions } from "@flow-state-dev/react";
import { describeFailure, PERSON_REASONS } from "./reads";

/**
 * Why a delivered line's request stopped short of finishing: on a person's ask
 * that Inbox lists (`ask`), on anything else (`wait`), or not at all (`null`).
 */
export type TurnStop = "ask" | "wait" | null;

/** Where a line goes: the session, the flow that owns it, and that flow's door. */
export type TurnTarget = { sessionId: string; flowId: string; door: string };

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

/**
 * How long a send waits for the door to answer. The door waits up to a minute
 * for a starting run to name its session, then up to a minute for it to stop,
 * so this covers both with room for the reads around them.
 */
const SEND_TIMEOUT_MS = 130_000;
const SEND_POLL_MS = 250;
/**
 * How often, while the request runs, the send looks for the line in the
 * session for `onHeld`. Each look is one session read, or a few on a session
 * longer than {@link ITEM_PAGE} items, so it runs slower than the status poll.
 */
const HELD_POLL_MS = 1_000;
/** Message items per session-state page while looking for the line. */
const ITEM_PAGE = 200;
/** Pages read back from the session's end before giving up. A new line is at the end. */
const ITEM_PAGES = 20;

/** A client call that failed: the network, or the Lab's answer. */
class ClientCallFailed extends Error {
  constructor(readonly failure: unknown) {
    super(describeFailure(failure).message);
  }
}

/** Run one client call, marking anything it throws as the call's failure, not this module's. */
async function call<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (error) {
    throw new ClientCallFailed(error);
  }
}

/**
 * Whether the session holds the person's line from `requestId`, read from the
 * newest page back. `undefined` when the page budget ran out first.
 */
async function sessionHoldsLine(clients: LabClients, sessionId: string, requestId: string): Promise<boolean | undefined> {
  const read = (offset: number, limit: number) =>
    call(() => clients.sessions.getSessionState(sessionId, { includeItems: true, itemTypes: ["message"], offset, limit }));
  const holds = (items: unknown) => (items as Array<OutputItem & { role?: string }>).some((item) => item.requestId === requestId && item.role === "user");

  const first = await read(0, ITEM_PAGE);
  const total = first.pagination?.total ?? 0;
  if (total <= ITEM_PAGE) return holds(first.items ?? []);
  let end = total;
  for (let page = 0; page < ITEM_PAGES; page += 1) {
    const offset = Math.max(0, end - ITEM_PAGE);
    if (holds((await read(offset, end - offset)).items ?? [])) return true;
    if (offset === 0) return false;
    end = offset;
  }
  return undefined;
}

/**
 * What a suspended request is still stopped on, read from that request alone:
 * the session's suspended requests with their own item logs, so the read is
 * one call however much history the session holds. Only its still-pending suspensions count
 * (`deriveSuspensions`, as Inbox derives them):
 *
 * - one whose reason is a person's ask: `ask`.
 * - any other pending one, such as a stop on something else after an ask
 *   that was answered: `wait`.
 * - none, or the request no longer listed as suspended (resumed since the
 *   poll): `null`, plain delivered.
 *
 * A listing that fails is a `wait`. Any `ask` or `wait` then goes through one
 * status recheck: not suspended any more is `null`, and a recheck that fails
 * keeps it. The label only picks the composer's words: callers read the Lab
 * again on the send's `suspended`, whatever this says.
 */
async function stopOf(
  clients: LabClients,
  actions: ReturnType<LabClients["actions"]>,
  sessionId: string,
  requestId: string,
): Promise<TurnStop> {
  // The candidate, from the listing; a listing that fails is a `wait` candidate.
  let candidate: TurnStop = "wait";
  try {
    const request = (await clients.sessions.listSessionRequests(sessionId, { status: "suspended", includeItems: true })).find(
      (r) => r.id === requestId,
    ) as { items?: unknown } | undefined;
    if (request === undefined) return null;
    const pending = deriveSuspensions((Array.isArray(request.items) ? request.items : []) as OutputItem[]).pending;
    candidate = pending.some((view) => PERSON_REASONS.has(view.item.reason)) ? "ask" : pending.length > 0 ? "wait" : null;
  } catch {
    // Fall through to the recheck with `wait`.
  }
  if (candidate === null) return null;
  // The one exit for a stop. The listing reads the request's row and its items
  // separately, and a resume marks the row running before it writes its resume
  // item, so a stale row and a stale ask can pair up: the stop holds only while
  // the request is still suspended. A recheck that fails keeps the candidate.
  try {
    return (await actions.getRequestStatus(requestId)).status === "suspended" ? candidate : null;
  } catch {
    return candidate;
  }
}

/**
 * {@link stopOf}, inside what is left of the send's deadline: past it, `wait`.
 * The line is already delivered, and the caller reads the Lab again either way.
 */
async function stopWithin(until: number, stop: Promise<TurnStop>): Promise<TurnStop> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<TurnStop>((resolve) => (timer = setTimeout(() => resolve("wait"), Math.max(0, until - Date.now()))));
  try {
    return await Promise.race([stop, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The door's own reason for a failed request, in its words. */
async function refusalOf(clients: LabClients, sessionId: string, requestId: string): Promise<string> {
  const failed = await call(() => clients.sessions.listSessionRequests(sessionId, { status: "failed" }));
  const said = failed.find((request) => request.id === requestId)?.result?.error?.message;
  return said ?? "The worker refused the message and gave no reason.";
}

/**
 * Send `message` through the target's door, and resolve only once it is
 * delivered (BR-4). Rejects with {@link TurnNotDelivered} otherwise.
 *
 * @param options.onHeld called once, while the request is still running, when
 * the session first holds the line. A request that ends before a poll sees it
 * running never calls it: the send's own resolve says the same thing then.
 * @returns the door's request; `suspended`, whether the poll saw it suspended,
 * which is when a caller reads the Lab again; and what it `stopped` on
 * ({@link TurnStop}), for the words only.
 */
export async function sendTurn(
  clients: LabClients,
  target: TurnTarget,
  message: string,
  options: { timeoutMs?: number; pollMs?: number; onHeld?: () => void } = {},
): Promise<{ requestId: string; suspended: boolean; stopped: TurnStop }> {
  const actions = clients.actions(target.flowId);
  let requestId: string;
  try {
    requestId = (await call(() => actions.sendAction(target.door, { message }, { sessionId: target.sessionId }))).request.id;
  } catch (error) {
    if (error instanceof ClientCallFailed) throw new TurnNotDelivered("not-sent", error.message);
    throw error;
  }

  const until = Date.now() + (options.timeoutMs ?? SEND_TIMEOUT_MS);
  let suspended = false;
  let held = false;
  let nextHeldLook = 0;
  const unconfirmed = (why: string) => new TurnNotDelivered("unconfirmed", `${why} Check the worker's session before sending it again.`);
  try {
    for (;;) {
      const { status } = await call(() => actions.getRequestStatus(requestId));
      if (status === "completed" || status === "suspended") {
        suspended = status === "suspended";
        break;
      }
      if (status === "failed") throw new TurnNotDelivered("refused", await refusalOf(clients, target.sessionId, requestId));
      if (status !== "in_progress") throw new TurnNotDelivered("not-sent", `The message's request ended ${status}.`);
      if (Date.now() > until) throw unconfirmed("The worker did not answer in time; the message may still arrive.");
      // Still running: say so once the session holds the line. A read that
      // fails here only means "not yet"; the read after the request ends decides.
      if (!held && options.onHeld !== undefined && Date.now() >= nextHeldLook) {
        nextHeldLook = Date.now() + HELD_POLL_MS;
        if (await sessionHoldsLine(clients, target.sessionId, requestId).catch(() => false)) {
          held = true;
          options.onHeld();
        }
      }
      await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? SEND_POLL_MS));
    }
    const holds = held || (await sessionHoldsLine(clients, target.sessionId, requestId));
    if (holds === false) throw unconfirmed("The worker answered, but its session doesn't hold your message.");
    if (holds === undefined) throw unconfirmed("The worker answered, but its session is too long to find your message in.");
  } catch (error) {
    if (error instanceof ClientCallFailed) throw unconfirmed(`Couldn't read back whether the message arrived: ${error.message}.`);
    throw error;
  }
  return { requestId, suspended, stopped: suspended ? await stopWithin(until, stopOf(clients, actions, target.sessionId, requestId)) : null };
}
