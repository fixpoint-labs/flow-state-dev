/**
 * The one way App Lab sends a person's line into a worker's session (S10).
 *
 * Every composer that talks to a worker (a task's, `@worker` in a workstream,
 * Inbox's reply) calls {@link sendTurn}, and nothing else in App Lab writes a
 * session item (ER-15). The line goes to the **door** the session's own flow
 * declares: the seat inventory row for the flow the session records as its
 * owner names it. App Lab knows no kind and no action name of its own.
 *
 * **Delivered means the session holds it (BR-4).** The door's request is
 * followed until it ends. A line counts as delivered only when that request is
 * `completed` **and** the target session holds the request's user item. The
 * HTTP answer alone never says so: it only says the request started.
 *
 * Three ways a line can fail to be delivered, and the caller keeps the draft
 * for each:
 *
 * - **refused**: the door's request failed. It rejects with the door's own reason.
 * - **not sent**: the line never reached the Lab, or its request ended some
 *   other way. Safe to send again.
 * - **unconfirmed**: the line may have arrived, but App Lab can't confirm it.
 *   The worker didn't answer in time, the session read failed, or the session
 *   doesn't show it. Sending again could send it twice, so nothing offers to.
 *
 * Only a failure of a client call counts as one of these. A fault in this
 * module's own reading is thrown as it is.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type { LabClients } from "./connection";
import { describeFailure } from "./reads";

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

/** How long a send waits for the door to answer. The door waits up to a minute for a run to stop. */
const SEND_TIMEOUT_MS = 90_000;
const SEND_POLL_MS = 250;
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

/** The door's own reason for a failed request, in its words. */
async function refusalOf(clients: LabClients, sessionId: string, requestId: string): Promise<string> {
  const failed = await call(() => clients.sessions.listSessionRequests(sessionId, { status: "failed" }));
  const said = failed.find((request) => request.id === requestId)?.result?.error?.message;
  return said ?? "The worker refused the message and gave no reason.";
}

/**
 * Send `message` through the target's door, and resolve only once it is
 * delivered (BR-4). Rejects with {@link TurnNotDelivered} otherwise.
 */
export async function sendTurn(
  clients: LabClients,
  target: TurnTarget,
  message: string,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<{ requestId: string }> {
  const actions = clients.actions(target.flowId);
  let requestId: string;
  try {
    requestId = (await call(() => actions.sendAction(target.door, { message }, { sessionId: target.sessionId }))).request.id;
  } catch (error) {
    if (error instanceof ClientCallFailed) throw new TurnNotDelivered("not-sent", error.message);
    throw error;
  }

  const until = Date.now() + (options.timeoutMs ?? SEND_TIMEOUT_MS);
  const unconfirmed = (why: string) => new TurnNotDelivered("unconfirmed", `${why} Check the worker's session before sending it again.`);
  try {
    for (;;) {
      const { status } = await call(() => actions.getRequestStatus(requestId));
      if (status === "completed") break;
      if (status === "failed") throw new TurnNotDelivered("refused", await refusalOf(clients, target.sessionId, requestId));
      if (status !== "in_progress") throw new TurnNotDelivered("not-sent", `The message's request ended ${status}.`);
      if (Date.now() > until) throw unconfirmed("The worker did not answer in time; the message may still arrive.");
      await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? SEND_POLL_MS));
    }
    const held = await sessionHoldsLine(clients, target.sessionId, requestId);
    if (held === false) throw unconfirmed("The worker answered, but its session doesn't hold your message.");
    if (held === undefined) throw unconfirmed("The worker answered, but its session is too long to find your message in.");
  } catch (error) {
    if (error instanceof ClientCallFailed) throw unconfirmed(`Couldn't read back whether the message arrived: ${error.message}.`);
    throw error;
  }
  return { requestId };
}
