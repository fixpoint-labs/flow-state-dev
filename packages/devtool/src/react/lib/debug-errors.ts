/**
 * Reading the debug surface's 403 gate.
 *
 * The server can refuse a debug endpoint for two reasons that look identical on
 * the wire but mean opposite things to an operator: the gate is off (turn it
 * on), or this session is not theirs to read (nothing to turn on). Only the
 * first should produce the "enable it with FSDEV_DEBUG_ENDPOINTS=1" notice, so
 * the distinction is made on the response body's typed reason and not on the
 * status alone.
 *
 * Lived in two hooks verbatim before this, which is one definition too many for
 * a rule both surfaces have to apply identically.
 */
import { ClientHttpError } from "@flow-state-dev/client";

/** The documented reasons that mean "the debug gate is closed", not "denied". */
const DISABLED_REASONS = new Set([
  "debug_endpoints_disabled",
  "debug_endpoints_origin_rejected"
]);

/**
 * True only when the response body's `error` field names a documented
 * debug-disabled reason.
 *
 * Other 403s — session ownership, IP gateways, a misconfigured proxy — surface
 * as ordinary errors, so the panel does not tell someone to enable an endpoint
 * that is already enabled.
 */
export function isDebugDisabledError(err: unknown): boolean {
  const reason = errorBodyReason(err, 403);
  return reason !== undefined && DISABLED_REASONS.has(reason);
}

/**
 * The `error` string from a `ClientHttpError`'s JSON body, when the status
 * matches and the body carries one. `undefined` for anything else — a
 * different status, a non-object body, a transport failure.
 *
 * Shared because every typed-refusal check has the same four guards to walk,
 * and writing them out per call site is how one of them ends up missing.
 */
export function errorBodyReason(err: unknown, status: number): string | undefined {
  if (!(err instanceof ClientHttpError)) return undefined;
  if (err.status !== status) return undefined;
  const body = err.body;
  if (body === null || typeof body !== "object" || !("error" in body)) return undefined;
  const reason = (body as { error?: unknown }).error;
  return typeof reason === "string" ? reason : undefined;
}
