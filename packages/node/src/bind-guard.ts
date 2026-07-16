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
 * rail only catches the forgot-to-configure case. It is deliberately narrow —
 * see the known limits in `docs/specs/FIX-893.md` §3: an app authenticating via
 * the host-level `createFlowState({ resolvePrincipal })` fallback reads as a
 * false-positive (escape with `allowUnauthenticated`), and a hand-written
 * resolver that itself delegates to the default is a false-negative (out of
 * scope — closing it would need an explicit auth marker, which is new auth
 * machinery this framework intentionally does not add here).
 *
 * Extracted from the per-app entrypoint in `examples/knowledge-base` so both the
 * `fsdev serve` command and any hand-written entry can share one rail instead of
 * each hard-coding its own secret env var name.
 */
import { isIP } from "node:net";
import { isDefaultBodyUserIdPrincipalResolver } from "@flow-state-dev/engine";
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
 * Resolves the runtime (`getRuntime()` is memoized, so a later `serve()` on the
 * same `app` reuses it rather than re-initializing stores) and inspects each
 * registered flow's `authentication.resolvePrincipal`.
 *
 * Because the caller awaits this before binding, store initialization happens
 * before the port is listening on a non-loopback host — this forgoes `serve()`'s
 * bind-immediately-then-`/healthz`-503 cold start for that window, in exchange for
 * failing fast when the app can't start (a deliberate trade for a production
 * command). The precise, init-free alternative is to surface the unauthenticated
 * flow set on `FlowState.meta` framework-side; see `docs/specs/FIX-893.md` §8.
 *
 * @throws Error naming the unauthenticated flow kinds when `host` is non-loopback,
 *   `allowUnauthenticated` is not set, and at least one served flow is on the
 *   default resolver.
 */
export async function assertNetworkBindIsAuthenticated(
  app: FlowState,
  opts: NetworkBindGuardOptions,
): Promise<void> {
  if (opts.allowUnauthenticated === true || isLoopbackHost(opts.host)) return;

  // Development auth (`FSDEV_DEV_AUTH=1` / `fsdev dev --dev-auth`) makes every
  // HTTP action resolve from the caller-supplied body `userId`, overriding each
  // flow's `authentication.resolvePrincipal` at request time. The static per-flow
  // check below can't see that, so a bearer-configured flow would read as
  // authenticated while actually running open. Refuse the network bind outright —
  // dev-auth is loopback-only by construction.
  if (process.env.FSDEV_DEV_AUTH === "1") {
    throw new Error(
      `Refusing to bind ${opts.host}: development auth (FSDEV_DEV_AUTH=1) trusts the ` +
        `caller-supplied body userId for every HTTP action, so a network-exposed server ` +
        `would accept any identity with no authentication. Bind a loopback host ` +
        `(--host 127.0.0.1) for local-only use, unset FSDEV_DEV_AUTH, or pass ` +
        `--allow-unauthenticated to override.`,
    );
  }

  const runtime = await app.getRuntime();
  // registry.list() yields one entry per (kind, id); de-dupe kinds for the message.
  // A flow is unauthenticated when it configures no resolver (falls through to the
  // framework default) or explicitly sets the default. The brand check tolerates a
  // resolver that came from a different @flow-state-dev/engine instance.
  const unauthenticated = [
    ...new Set(
      runtime.registry
        .list()
        .filter((flow) => {
          const resolver = flow.authentication?.resolvePrincipal;
          return resolver === undefined || isDefaultBodyUserIdPrincipalResolver(resolver);
        })
        .map((flow) => flow.kind),
    ),
  ];
  if (unauthenticated.length === 0) return;

  const isSingle = unauthenticated.length === 1;
  const kinds = unauthenticated.map((kind) => `"${kind}"`).join(", ");
  throw new Error(
    `Refusing to bind ${opts.host}: ${isSingle ? "flow" : "flows"} ${kinds} ${isSingle ? "has" : "have"} ` +
      `no authentication configured, so a network-exposed server would accept a caller-supplied userId. ` +
      `Configure authentication.resolvePrincipal on the flow, bind a loopback host (--host 127.0.0.1) ` +
      `for local-only use, or pass --allow-unauthenticated to override.`,
  );
}
