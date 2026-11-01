/**
 * Which conversations a restart cut a turn off in.
 *
 * `client.requests.interrupted()` lists every request of the user that a host
 * lost in a crash or a restart, across every flow. An app wants it by
 * conversation: to badge a session in its list, and to draw a Continue and
 * Discard line at the lost turn. {@link interruptedBySession} is that view.
 *
 * Each `interrupted()` call asks the server to sweep before it reads, so poll
 * it slowly and only while the page is visible. A row is marked interrupted
 * only once its heartbeat is older than the server's stale threshold (a minute
 * by default), so a faster poll shows nothing sooner.
 */
import type { InterruptedRequest } from "./client";

/** Options for {@link interruptedBySession}. */
export interface InterruptedBySessionOptions {
  /**
   * The actions that are the app's turns, e.g. `["respond"]`. A request of any
   * other action (a worker's internal pass, a delivery) is left out, so it
   * badges nothing.
   */
  readonly actions: readonly string[];
}

/**
 * The interrupted requests of the named actions, by the session they ran in,
 * oldest first in each. A request with no session is left out: there is no
 * conversation to show it in.
 *
 * @param requests What `client.requests.interrupted()` returned.
 * @param options The app's turn actions.
 */
export function interruptedBySession(
  requests: readonly InterruptedRequest[],
  options: InterruptedBySessionOptions
): Map<string, InterruptedRequest[]> {
  const actions = new Set(options.actions);
  const bySession = new Map<string, InterruptedRequest[]>();
  for (const request of requests) {
    if (request.sessionId === undefined || !actions.has(request.actionName)) continue;
    const list = bySession.get(request.sessionId) ?? [];
    list.push(request);
    bySession.set(request.sessionId, list);
  }
  for (const list of bySession.values()) list.sort((a, b) => a.interruptedAt - b.interruptedAt);
  return bySession;
}
