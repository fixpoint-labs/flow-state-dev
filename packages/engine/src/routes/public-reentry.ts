/**
 * Which transport sources may be re-entered through a public route (FIX-999).
 *
 * `retry`, `continue` and `resume` are public re-dispatch surfaces: they take a
 * request id and run its handler again, and retry additionally accepts a
 * caller-supplied `inputOverride`. Whether a given request may be re-entered
 * that way is a property of the transport it arrived on.
 *
 * **This is an allow-list, and that is the whole point.** The three routes
 * previously each named `webhook` and refused it — a deny-list, which admits
 * every source nobody thought to name. A new internal source therefore inherits
 * public re-entry for free, silently, at the moment it is introduced. That is
 * how the detached-dispatch source would have become retryable with an attacker-
 * chosen `inputOverride` without anyone editing a route.
 *
 * Adding a source here is a deliberate act. Forgetting to add one costs a
 * refusal, which is visible; forgetting to add one to a deny-list costs a
 * bypass, which is not.
 *
 * FIX-1021 generalizes this predicate; it does not replace it.
 */

/**
 * Sources that arrived on a caller-facing transport and may be re-entered.
 *
 * - `http` — the public action endpoint.
 * - `mcp` — the MCP transport, caller-addressed like HTTP.
 * - `chat` — a chat subscription; its handler is caller-reachable.
 * - `scheduled` — a scheduled dispatch; retry/continue on these is existing,
 *   relied-upon behaviour.
 *
 * Deliberately absent:
 * - `webhook` — reachable only through a verified webhook. Re-running one from a
 *   public surface would bypass signature verification, which is why all three
 *   routes already refused it.
 * - `workstream` — a detached dispatch started by the injection seam. It has no
 *   caller-facing entry at all, so it must have no caller-facing re-entry.
 */
const PUBLIC_REENTRY_SOURCES: ReadonlySet<string> = new Set([
  "http",
  "mcp",
  "chat",
  "scheduled"
]);

/**
 * Whether a request that arrived on `source` may be re-entered through the
 * public retry / continue / resume routes.
 *
 * Fail-closed: an unrecognized source — a third-party transport, a future
 * internal one, an empty string on a malformed record — is refused. Callers turn
 * `false` into the same not-found shape a missing record produces, so a refused
 * request is indistinguishable from one that does not exist.
 */
export function isPublicReentryAllowed(source: string | undefined): boolean {
  if (source == null) return false;
  return PUBLIC_REENTRY_SOURCES.has(source);
}
