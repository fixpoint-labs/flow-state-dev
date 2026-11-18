import { isFlowState } from "../flowstate/createFlowState";
import type { FlowState } from "../flowstate/types";
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
 */
export async function networkAuthenticationError(
  app: FlowState | FlowApiRouter,
  target: string,
): Promise<string | undefined> {
  const router = isFlowState(app) ? await app.getRouter() : app;
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

/** Production request guard, with one diagnostic per adapter instance. */
export function createProductionAuthGuard(
  allowUnauthenticated = false,
): (app: FlowState | FlowApiRouter) => Promise<Response | undefined> {
  let logged = false;
  return async (app: FlowState | FlowApiRouter): Promise<Response | undefined> => {
    if (process.env.NODE_ENV !== "production" || allowUnauthenticated) return undefined;
    const message = await networkAuthenticationError(app, "serve in production");
    if (message === undefined) return undefined;
    if (!logged) {
      logged = true;
      console.error(message);
    }
    return Response.json({ error: message }, { status: 500 });
  };
}
