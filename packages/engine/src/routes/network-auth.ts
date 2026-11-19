import type { FlowRegistry } from "../registry/flow-registry";
import type { FlowApiRouter } from "./createFlowApiRouter";
import type { PrincipalResolver } from "../transports/types";
import {
  defaultBodyUserIdPrincipalResolver,
  isDefaultBodyUserIdPrincipalResolver
} from "../transports/auth/defaultBodyUserIdPrincipalResolver";
import { pickPrincipalResolver } from "../transports/auth/pickPrincipalResolver";

// Like the router's other host metadata, this survives separate engine copies.
const AUTH_STATE = Symbol.for("@flow-state-dev/engine/networkAuthState");

/** What an anonymous caller of a misconfigured host receives. The kinds stay in the log. */
const GENERIC_REFUSAL = { error: "Internal server error" };

interface NetworkAuthState {
  registry: FlowRegistry;
  hostResolver: PrincipalResolver;
}

/**
 * Attach the live registry and the router's host-level resolver, so host
 * adapters read the same resolver precedence the routes use.
 */
export function attachNetworkAuthState(
  router: FlowApiRouter,
  registry: FlowRegistry,
  hostResolver: PrincipalResolver | undefined,
): void {
  const state: NetworkAuthState = { registry, hostResolver: hostResolver ?? defaultBodyUserIdPrincipalResolver };
  Object.defineProperty(router, AUTH_STATE, { value: state });
}

/**
 * The shared network safety rail. A flow is unauthenticated when the resolver
 * the routes would pick for it (`pickPrincipalResolver`: the flow's own, else
 * the router's host-level resolver) is the framework default that trusts
 * `body.userId`. It does not judge whether a custom resolver verifies
 * credentials. Hand-written routers have no framework flows to inspect.
 *
 * Callers pass the router the routes will use. Reading the live registry means
 * a flow registered after the router was built is visible on the next call.
 */
export async function networkAuthenticationError(
  router: FlowApiRouter,
  target: string,
): Promise<string | undefined> {
  const state = (router as unknown as Record<symbol, unknown>)[AUTH_STATE] as NetworkAuthState | undefined;
  if (state === undefined) return undefined;
  const kinds = [...new Set(state.registry.list()
    .filter(flow => isDefaultBodyUserIdPrincipalResolver(pickPrincipalResolver(state.registry, flow.id, state.hostResolver)))
    .map(flow => flow.kind))];
  if (kinds.length === 0) return undefined;
  const single = kinds.length === 1;
  return `Refusing to ${target}: ${single ? "flow" : "flows"} ${kinds.map(kind => `"${kind}"`).join(", ")} ${single ? "has" : "have"} ` +
    "no authentication configured, so a network-exposed server would accept a caller-supplied userId. " +
    "Configure authentication.resolvePrincipal on the flow, bind a loopback host (--host 127.0.0.1) " +
    "for local-only use, or set allowUnauthenticated: true (--allow-unauthenticated in fsdev) to override.";
}

/**
 * Request guard for a network-exposed host. Refuses an unauthenticated app on
 * every call, independent of `NODE_ENV`: an unset environment is how Lambda
 * serves, and a development flag must not put the default resolver on the
 * network. Loopback exemption belongs to the host that can see the bind
 * (`serve` skips this guard). `allowUnauthenticated` is the explicit override.
 *
 * The pass/fail result is not cached. `FlowState.register` can add a flow
 * after the first request, and a cached pass would serve it. The diagnostic
 * is logged once per guard; the response body stays generic.
 */
export function createNetworkAuthGuard(
  allowUnauthenticated = false,
): (router: FlowApiRouter) => Promise<Response | undefined> {
  let logged = false;
  return async (router: FlowApiRouter): Promise<Response | undefined> => {
    if (allowUnauthenticated) return undefined;
    const message = await networkAuthenticationError(router, "serve");
    if (message === undefined) return undefined;
    if (!logged) {
      logged = true;
      console.error(message);
    }
    return Response.json(GENERIC_REFUSAL, { status: 500 });
  };
}
