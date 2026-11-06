/**
 * The one place React picks the call that answers a stop.
 *
 * A user's stop (`isUserSuspension`: a `ctx.suspendForUser`, or a raw
 * `user_approval` / `user_input`) goes through the client's `answer`, which
 * answers it whatever started the run, a task's or a webhook's included. A
 * developer's own `ctx.suspend` with a custom reason goes through `resume`,
 * the only route that answers one. The answer route reads the same
 * predicate, so the two cannot disagree. A stop whose reason isn't known is
 * answered as a user's; a custom one then fails loudly with the route's 404.
 */
import { isUserSuspension } from "@flow-state-dev/contracts";
import type { ResumeAction } from "@flow-state-dev/core/types";
import type { RequestHandle, StreamOption } from "@flow-state-dev/client";

/** The answer a screen sends: which stop, how it resolves, and its payload. */
export type StopAnswer = { suspensionId: string; action: ResumeAction; data?: unknown };

/** Answer `body` on `request`, through the call `reason` belongs to. */
export function answerStop(request: RequestHandle, reason: string | undefined, body: StopAnswer): Promise<RequestHandle>;
export function answerStop(
  request: RequestHandle,
  reason: string | undefined,
  body: StopAnswer,
  options: StreamOption
): Promise<Response>;
export function answerStop(
  request: RequestHandle,
  reason: string | undefined,
  body: StopAnswer,
  options?: StreamOption
): Promise<RequestHandle | Response> {
  const payload: StopAnswer = {
    suspensionId: body.suspensionId,
    action: body.action,
    ...(body.data !== undefined ? { data: body.data } : {})
  };
  const userStop = reason === undefined || isUserSuspension({ reason });
  if (options !== undefined) return userStop ? request.answer(payload, options) : request.resume(payload, options);
  return userStop ? request.answer(payload) : request.resume(payload);
}
