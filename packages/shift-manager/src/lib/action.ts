/**
 * One action on a session, and its answer read back: how a view runs an action
 * whose output it reads (a coordinator's delegate actions, a session's task
 * list, a project's workstream writes, a roster write).
 *
 * The action is sent on the session's flow, and its answer is read back from
 * the session's request list once the request ends. A refused request rejects
 * with the Lab's own reason ({@link ActionRefused}); anything else (the Lab out
 * of reach, a 5xx) is thrown as it came, and is something to retry.
 */
import { ClientHttpError } from "@flow-state-dev/client";
import type { LabClients } from "./connection";
import { newSessionId } from "./ids";
import { describeFailure } from "./reads";

/**
 * An action the Lab answered with a refusal and its reason: a request that
 * ended failed, or a 4xx naming why. Anything else (the Lab out of reach, a
 * 5xx) is thrown as it came, and is something to retry.
 */
export class ActionRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionRefused";
  }
}

/**
 * An action the Lab completed whose answer couldn't be read back. What it did
 * stands.
 */
export class ActionAnswerUnread extends Error {
  constructor(action: string, cause: unknown) {
    super(`The Lab finished ${action}, but its answer could not be read: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    this.name = "ActionAnswerUnread";
  }
}

const POLL_MS = 150;
const TIMEOUT_MS = 30_000;
/** Requests listed per page while looking for the one that just ended. */
const REQUEST_PAGE = 100;
const REQUEST_PAGES = 20;

/**
 * Run one action on a session of flow `kind` (or, with no session, on a new
 * one the Lab creates for this person) and return what it answered, with the
 * session it ran in.
 */
export async function runAction(
  clients: LabClients,
  kind: string,
  sessionId: string | undefined,
  action: string,
  input: unknown,
): Promise<{ output: unknown; sessionId: string }> {
  const actions = clients.actions(kind);
  // A new session is named here: the Lab's answer to an action started with
  // no session names none, and its requests are read back by session.
  const session = sessionId ?? newSessionId("act");
  let started: Awaited<ReturnType<typeof actions.sendAction>>;
  try {
    started = await actions.sendAction(action, input, { sessionId: session });
  } catch (error) {
    // The Lab said no, with a reason. A 5xx or no answer at all is not a refusal.
    if (error instanceof ClientHttpError && error.status >= 400 && error.status < 500) {
      throw new ActionRefused(describeFailure(error).message);
    }
    throw error;
  }
  const requestId = started.request.id;

  const until = Date.now() + TIMEOUT_MS;
  let status: Awaited<ReturnType<typeof actions.getRequestStatus>>["status"];
  for (;;) {
    status = (await actions.getRequestStatus(requestId)).status;
    if (status !== "in_progress") break;
    if (Date.now() > until) throw new Error(`The Lab did not finish ${action} in time.`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  // Ended without the Lab's answer (aborted, interrupted, incomplete): not a refusal, so the view offers Retry.
  if (status !== "completed" && status !== "failed") throw new Error(`The Lab's ${action} ended ${status} before it answered.`);

  const findAnswer = async () => {
    for (let page = 0; page < REQUEST_PAGES; page += 1) {
      const listed = await clients.sessions.listSessionRequests(session, {
        status,
        includeResultOutput: true,
        limit: REQUEST_PAGE,
        offset: page * REQUEST_PAGE,
      });
      const found = listed.find((request) => request.id === requestId);
      if (found !== undefined || listed.length < REQUEST_PAGE) return found;
    }
    return undefined;
  };
  let found: Awaited<ReturnType<typeof findAnswer>>;
  try {
    found = await findAnswer();
  } catch (error) {
    // The action is done; only reading its answer failed.
    if (status === "completed") throw new ActionAnswerUnread(action, error);
    throw error;
  }
  if (status === "failed") throw new ActionRefused(found?.result?.error?.message ?? `${action} was refused.`);
  if (found === undefined) throw new ActionAnswerUnread(action, new Error("its answer is not in the session's requests"));
  return { output: found.result?.output, sessionId: session };
}
