/**
 * Loopback-bind safety rail for self-hosted flow servers.
 *
 * A best-effort guard, not a security boundary: it answers one question —
 * "would this server run on the framework's DEFAULT principal resolver?" — which
 * is the common production accident (a secret env var was forgotten, so a flow's
 * `authentication.resolvePrincipal` stayed undefined and fell through to
 * `defaultBodyUserIdPrincipalResolver`, which trusts a caller-supplied
 * `body.userId`). Loopback binds are exempt because they are reachable only from
 * the same host. Any other host is network-exposed, so the guard refuses to bind
 * it while a served flow is unauthenticated.
 *
 * The real security boundary is `authentication.resolvePrincipal` itself; this
 * rail only catches the forgot-to-configure case. It reads the resolver the
 * routes would pick for each flow (the flow's own, else the host-level
 * `createFlowState({ resolvePrincipal })` fallback). Its known limit: a
 * hand-written resolver that itself delegates to the default is a
 * false-negative (out of scope — closing it would need an explicit auth marker,
 * which is new auth machinery this framework intentionally does not add here).
 *
 * Enforced by `serve()` before it listens, and again on each request so a flow
 * registered later is refused. CLI commands pass the override through.
 */
import { isIP } from "node:net";
import { isFlowState, networkAuthenticationError, type FlowApiRouter } from "@flow-state-dev/engine/host";
import type { FlowState } from "@flow-state-dev/engine";

/**
 * Whether `host` is a loopback interface (127.0.0.0/8, ::1, localhost), reachable
 * only from the same machine and therefore safe to serve without authentication.
 * Any other host is network-exposed.
 */
export function isLoopbackHost(host: string): boolean {
  if (host === "localhost") return true;
  if (isIP(host) === 4) return host === "127.0.0.1" || host.startsWith("127.");
  if (isIP(host) === 6) return host === "::1";
  return false;
}

/** Whether an HTTP Host authority names loopback, with an optional port. */
export function isLoopbackAuthority(authority: string | null): boolean {
  if (authority === null) return false;
  const match = /^(\[[^\]]+\]|[^:]+)(?::[0-9]+)?$/.exec(authority);
  if (match === null) return false;
  const host = match[1]!.toLowerCase();
  return isLoopbackHost(host.startsWith("[") ? host.slice(1, -1) : host);
}

/** Options for {@link assertNetworkBindIsAuthenticated}. */
export interface NetworkBindGuardOptions {
  /** The host the server is about to bind. */
  host: string;
  /** Skip the guard (e.g. the operator authenticates via a path the rail can't see). */
  allowUnauthenticated?: boolean;
}

/**
 * Refuse to bind a network-exposed host when any served flow would run
 * unauthenticated — i.e. its effective principal resolver is the framework
 * default `defaultBodyUserIdPrincipalResolver`. Loopback binds and
 * `allowUnauthenticated` short-circuit before any runtime resolution.
 *
 * Resolves the router (`getRouter()` is memoized, so the `serve()` that follows
 * reuses it rather than re-initializing stores) and inspects the resolver each
 * registered flow would get.
 *
 * Because the caller awaits this before binding, store initialization happens
 * before the port is listening on a non-loopback host — this forgoes `serve()`'s
 * bind-immediately-then-`/healthz`-503 cold start for that window, in exchange for
 * failing fast when the app can't start (a deliberate trade for a production
 * command). The precise, init-free alternative is to surface the unauthenticated
 * flow set on `FlowState.meta` framework-side, so the guard reads a declared set
 * instead of resolving the runtime — not done here because it moves a host-level
 * concern into the framework's public metadata.
 *
 * @throws Error naming the unauthenticated flow kinds when `host` is non-loopback,
 *   `allowUnauthenticated` is not set, and at least one served flow is on the
 *   default resolver.
 */
export async function assertNetworkBindIsAuthenticated(
  app: FlowState | FlowApiRouter,
  opts: NetworkBindGuardOptions,
): Promise<void> {
  if (opts.allowUnauthenticated === true || isLoopbackHost(opts.host)) return;

  const router: FlowApiRouter = isFlowState(app) ? await app.getRouter() : app;
  const message = await networkAuthenticationError(router, `bind ${opts.host}`);
  if (message !== undefined) throw new Error(message);
}
