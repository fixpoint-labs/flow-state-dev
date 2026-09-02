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
 * how a framework-stamped dispatch source would have become retryable with an
 * attacker-chosen `inputOverride` without anyone editing a route.
 *
 * Adding a source here is a deliberate act. Forgetting to add one costs a
 * refusal, which is visible; forgetting to add one to a deny-list costs a
 * bypass, which is not.
 *
 * A deployment extends the list with its OWN transports through the
 * `publicReentrySources` host option — see {@link isPublicReentryAllowed}.
 * `InboundTransportAdapter.source` is an open string, so an out-of-tree
 * transport necessarily lands on a source the framework cannot enumerate, and
 * an allow-list nobody can extend would take retry, continue and resume away
 * from it permanently.
 *
 * FIX-1021 generalizes this predicate; it does not replace it.
 */
import {
  INTERNAL_SOURCE,
  TASK_SOURCE,
  WEBHOOK_SOURCE
} from "../execution/transport-sources";

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
 * - `task` and `internal` — dispatched by the seam from inside a running
 *   request. Neither has a caller-facing entry at all, so neither may have a
 *   caller-facing re-entry. A spawned session IS reachable from outside — by
 *   dispatching a `user` message to it, which is an ordinary caller-addressed
 *   request — so nothing is lost by refusing here.
 */
const PUBLIC_REENTRY_SOURCES: ReadonlySet<string> = new Set([
  "http",
  "mcp",
  "chat",
  "scheduled"
]);

/**
 * Sources a host may never declare, whatever it passes.
 *
 * All three are stamped by the framework itself, not by a deployment's
 * transport, so none is a deployment's to re-open — and the reason each is
 * excluded is a property of the framework rather than of the deployment.
 * `webhook`'s handler is reachable only behind signature verification; `task`
 * and `internal` have no caller-facing entry at all by construction. Re-admitting
 * any of them hands an HTTP caller `inputOverride` on a handler that was never
 * caller-addressed, which is precisely the bypass the allow-list exists to close.
 *
 * Three tiers, not two: the allow-list above, this never-set, and the host's own
 * `publicReentrySources`. A source that is merely *absent* from the allow-list
 * can be re-opened by one line of deployment config; a source in this set
 * cannot. A new framework-stamped type belongs here, not merely off the
 * allow-list.
 *
 * A host that names one is refused at construction by
 * {@link assertPublicReentrySources} rather than having it silently dropped.
 */
const NEVER_PUBLIC_REENTRY_SOURCES: ReadonlySet<string> = new Set([
  WEBHOOK_SOURCE,
  TASK_SOURCE,
  INTERNAL_SOURCE
]);

/**
 * Whether a request that arrived on `source` may be re-entered through the
 * public retry / continue / resume routes.
 *
 * Fail-closed: an unrecognized source — a third-party transport, a future
 * internal one, an empty string on a malformed record — is refused. Callers turn
 * `false` into the same not-found shape a missing record produces, so a refused
 * request is indistinguishable from one that does not exist.
 *
 * `additionalSources` is the host's `publicReentrySources` option, carried on
 * the runtime config. Absent or empty leaves the built-in list exactly as it
 * was, so a deployment that configures nothing is unaffected. The
 * never-re-enterable check is repeated here rather than left to the
 * construction-time assert because this predicate is the actual authorization
 * boundary and is exported on its own: it must be correct for whatever list it
 * is handed, not only for one that a boundary validated.
 */
export function isPublicReentryAllowed(
  source: string | undefined,
  additionalSources?: readonly string[]
): boolean {
  if (source == null) return false;
  if (PUBLIC_REENTRY_SOURCES.has(source)) return true;
  if (additionalSources === undefined || NEVER_PUBLIC_REENTRY_SOURCES.has(source)) return false;
  return additionalSources.includes(source);
}

/**
 * Validate a host's `publicReentrySources` at construction, throwing on a
 * source the framework never re-enters.
 *
 * Loud rather than silently ignored (BP-030): a deployment that reads "add your
 * transport to the allow-list" and tries `webhook` has made an assumption about
 * its own security posture, and discovering the option did nothing from a
 * production 404 is the wrong moment to learn otherwise.
 */
export function assertPublicReentrySources(sources: readonly string[] | undefined): void {
  if (sources === undefined) return;
  const refused = sources.filter((source) => NEVER_PUBLIC_REENTRY_SOURCES.has(source));
  if (refused.length === 0) return;
  throw new Error(
    `publicReentrySources cannot include ${refused.map((s) => `"${s}"`).join(", ")}: ` +
      "these sources are stamped by the framework and have no caller-facing entry " +
      "(a webhook handler is reachable only behind signature verification, and a " +
      "task or internal message is dispatched from inside a running request), so " +
      "re-entering one from a public route would run it with caller-supplied input."
  );
}
