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
 * A refused line (the door's request failed) rejects with the door's own
 * reason. A line that never reached the Lab, or whose request ended any other
 * way, rejects as not sent. Either way the caller keeps the draft.
 */
import type { OutputItem } from "@flow-state-dev/core/items";
import type { LabClients } from "./connection";
import { describeFailure } from "./reads";

/** Where a line goes: the session, the flow that owns it, and that flow's door. */
export type TurnTarget = { sessionId: string; flowId: string; door: string };

/** Why a line was not delivered. */
export class TurnNotDelivered extends Error {
  constructor(
    /** `refused`: the door said no, and why. `not-sent`: it never got that far. */
    readonly kind: "refused" | "not-sent",
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
const ITEM_PAGES = 20;

/** Whether the session holds the person's line from `requestId`. */
async function sessionHoldsLine(clients: LabClients, sessionId: string, requestId: string): Promise<boolean> {
  let offset = 0;
  for (let page = 0; page < ITEM_PAGES; page += 1) {
    const state = await clients.sessions.getSessionState(sessionId, {
      includeItems: true,
      itemTypes: ["message"],
      offset,
      limit: ITEM_PAGE,
    });
    const items = (state.items ?? []) as Array<OutputItem & { role?: string }>;
    if (items.some((item) => item.requestId === requestId && item.role === "user")) return true;
    if (state.pagination?.hasMore !== true) return false;
    offset = state.pagination.nextOffset ?? offset + ITEM_PAGE;
  }
  return false;
}

/** The door's own reason for a failed request, in its words. */
async function refusalOf(clients: LabClients, sessionId: string, requestId: string): Promise<string> {
  const failed = await clients.sessions.listSessionRequests(sessionId, { status: "failed" });
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
    requestId = (await actions.sendAction(target.door, { message }, { sessionId: target.sessionId })).request.id;
  } catch (error) {
    throw new TurnNotDelivered("not-sent", describeFailure(error).message);
  }

  const until = Date.now() + (options.timeoutMs ?? SEND_TIMEOUT_MS);
  try {
    for (;;) {
      const { status } = await actions.getRequestStatus(requestId);
      if (status === "completed") break;
      if (status === "failed") throw new TurnNotDelivered("refused", await refusalOf(clients, target.sessionId, requestId));
      if (status !== "in_progress") throw new TurnNotDelivered("not-sent", `The message's request ended ${status}.`);
      if (Date.now() > until) {
        throw new TurnNotDelivered("not-sent", "The worker did not answer in time; the message may still arrive.");
      }
      await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? SEND_POLL_MS));
    }
    if (!(await sessionHoldsLine(clients, target.sessionId, requestId))) {
      throw new TurnNotDelivered("not-sent", "The worker answered, but its session doesn't hold your message.");
    }
  } catch (error) {
    if (error instanceof TurnNotDelivered) throw error;
    throw new TurnNotDelivered("not-sent", describeFailure(error).message);
  }
  return { requestId };
}
