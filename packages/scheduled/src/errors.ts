/**
 * Errors raised by the scheduled transport adapter.
 *
 * Adapter-internal logic prefers returning HTTP responses directly
 * (`jsonResponse(404, ...)`); these classes exist for callers that build
 * their own dispatch flows on top of the adapter helpers and want
 * structured errors to catch.
 */

/**
 * Thrown when a schedule id was not found in either the static map or
 * the dynamic resolver. The adapter normally maps this to a 404 response;
 * direct callers can catch the error to render a different surface.
 */
export class ScheduleNotFoundError extends Error {
  readonly flowKind: string;
  readonly scheduleId: string;

  constructor(flowKind: string, scheduleId: string) {
    super(`Schedule "${scheduleId}" not found on flow "${flowKind}".`);
    this.name = "ScheduleNotFoundError";
    this.flowKind = flowKind;
    this.scheduleId = scheduleId;
  }
}

/**
 * Thrown when the adapter could not dispatch a resolved schedule (flow
 * unregistered between resolution and dispatch, runtime invariant
 * violation). Maps to a 503 response.
 */
export class ScheduleDispatchError extends Error {
  readonly flowKind: string;
  readonly scheduleId: string;
  readonly cause?: unknown;

  constructor(flowKind: string, scheduleId: string, cause?: unknown) {
    super(
      `Failed to dispatch schedule "${scheduleId}" on flow "${flowKind}": ${
        cause instanceof Error ? cause.message : String(cause)
      }`
    );
    this.name = "ScheduleDispatchError";
    this.flowKind = flowKind;
    this.scheduleId = scheduleId;
    this.cause = cause;
  }
}
