/**
 * One action on a session, and its answer read back: how a view runs an action
 * whose output it reads (a coordinator's delegate actions, a session's task
 * list, a project's workstream writes, a roster write).
 *
 * The action is sent on the session's flow, and its answer is read back by
 * the request's id once it ends (`result()`). A refused request rejects
 * with the Lab's own reason ({@link ActionRefused}); anything else (the Lab out
 * of reach, a 5xx) is thrown as it came, and is something to retry.
 */
import { ClientHttpError } from "@flow-state-dev/client";
import type { Client, RequestResult, SentRequest } from "@flow-state-dev/client";
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

/**
 * Run one action on a session of flow `flow` (or, with no session, on a new
 * one the Lab creates for this user) and return what it answered, with the
 * session it ran in.
 */
export async function runAction(
  client: Client,
  flow: string,
  sessionId: string | undefined,
  action: string,
  input: unknown,
): Promise<{ output: unknown; sessionId: string }> {
  const actions = client.flow(flow);
  // A new session is named here: the Lab's answer to an action started with
  // no session names none, and the caller is told which session it ran in.
  const session = sessionId ?? newSessionId("act");
  let started: SentRequest;
  try {
    started = await actions.send(action, input, { sessionId: session });
  } catch (error) {
    // The Lab said no, with a reason. A 5xx or no answer at all is not a refusal.
    if (error instanceof ClientHttpError && error.status >= 400 && error.status < 500) {
      throw new ActionRefused(describeFailure(error).message);
    }
    throw error;
  }
  let status: RequestResult["status"];
  try {
    status = (await started.wait({ pollMs: POLL_MS, timeoutMs: TIMEOUT_MS })).status;
  } catch (error) {
    if (error instanceof ClientHttpError && error.status === 0) throw new Error(`The Lab did not finish ${action} in time.`);
    throw error;
  }
  // Ended without the Lab's answer (aborted, interrupted, incomplete, suspended): not a refusal, so the view offers Retry.
  if (status !== "completed" && status !== "failed") throw new Error(`The Lab's ${action} ended ${status} before it answered.`);

  // Settled, so `result()` reads the request once, by its id, with its answer.
  let settled: RequestResult;
  try {
    settled = await started.result({ pollMs: POLL_MS, timeoutMs: TIMEOUT_MS });
  } catch (error) {
    // The action is done; only reading its answer failed.
    if (status === "completed") throw new ActionAnswerUnread(action, error);
    throw error;
  }
  if (settled.status === "failed") throw new ActionRefused(settled.error?.message ?? `${action} was refused.`);
  if (settled.outputNotRecorded === true) throw new ActionAnswerUnread(action, new Error("the Lab could not store it"));
  return { output: settled.output, sessionId: session };
}
