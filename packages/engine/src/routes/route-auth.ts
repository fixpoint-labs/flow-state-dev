/**
 * Route-level authentication and ownership authorization for the management
 * surface of `/api/flows` — session CRUD, session state, resource content,
 * request control, and the debug endpoints.
 *
 * Action execution authenticates inside `handleExecuteAction`, which is why it
 * was for a long time the only route that did. Every other route is addressed
 * by a `sessionId`, a `requestId`, or nothing at all, and used to reach the
 * stores with no caller identity involved: a flow could configure a JWT
 * resolver and still serve `GET /api/flows/sessions` — every session, every
 * user — to anyone who could reach the port.
 *
 * This guard closes that. It runs once per request, before the route
 * dispatcher, and answers two questions:
 *
 *   1. **Who is calling?** Resolved through the same `host.resolvePrincipal`
 *      the action path uses, so one flow has one authentication contract.
 *   2. **Do they own what they addressed?** The caller's `userId` must match
 *      the `userId` on the session or request record they named.
 *
 * ## When it enforces
 *
 * Only when the app has actually configured authentication — the effective
 * resolver for the governing flow is not `defaultBodyUserIdPrincipalResolver`.
 * An app still on the framework default is unchanged: it trusts a
 * caller-supplied `body.userId` on the action path already, so demanding a
 * principal on the management path would reject every GET (no body to read
 * a userId from) without protecting anything that wasn't already open. Those
 * apps are covered by the loopback-bind rail in `@flow-state-dev/node`, which
 * refuses to expose them on a network interface in the first place.
 *
 * The pairing is the point: the bind rail says "configure a resolver before you
 * expose this", and this guard makes configuring one protect the whole surface
 * rather than one route of it.
 *
 * ## Resolver selection is never caller-controlled
 *
 * The governing flow comes from the *stored record* (`session.flowKind`,
 * `record.flowKind`), never from the `:flowKind` path segment, which a caller
 * writes. Otherwise naming a flow with a permissive resolver would authenticate
 * a request against a record belonging to a strict one (BP-031).
 *
 * ## No body is parsed here
 *
 * Principal resolution at this layer sees the `Request` (headers, cookies, URL)
 * but no parsed body. Two reasons: a body is a single-use stream that the route
 * handler still needs to read, and deriving auth from caller-supplied body
 * fields is the thing BP-031 exists to prevent. Resolvers that authenticate
 * from a header or cookie — which is every real one — work unchanged.
 */
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import type {
  InboundTransportHost,
  PrincipalResolver,
  ResolvedPrincipal
} from "../transports/types";
import { PrincipalResolutionError } from "../transports/errors";
import { isDefaultBodyUserIdPrincipalResolver } from "../transports/auth/defaultBodyUserIdPrincipalResolver";
import { jsonResponse, loadTenantSession } from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";

/** Wiring the guard needs; all of it is already built by `createFlowRouteHandlers`. */
export type RouteAuthContext = {
  registry: FlowRegistry;
  stores: StoreRegistry;
  host: InboundTransportHost;
  /**
   * The host-level fallback resolver, already defaulted by the caller. Used
   * for routes with no governing flow, and to decide whether enforcement is
   * active for a flow that configures no resolver of its own.
   */
  hostResolver: PrincipalResolver;
  /** Tenant id for this request (FIX-682); namespaces the session lookup. */
  tenantId?: string;
};

/**
 * Outcome of the guard. `denied` short-circuits the route dispatcher;
 * `principal` is the authenticated caller, present only when enforcement is
 * active, and is threaded into the handlers that need to scope by owner.
 */
export type RouteAuthResult = {
  denied?: Response;
  principal?: ResolvedPrincipal;
};

const ALLOWED: RouteAuthResult = {};

/**
 * What a route addresses, and therefore who owns it.
 *
 * - `exempt` — no owner to check: public flow metadata, or `execute_action`,
 *   which resolves its own principal in `handleExecuteAction`.
 * - `session` / `request` — owner is the stored record's `userId`.
 * - `flow` — creating a session under a flow. No record exists yet, so the
 *   caller becomes the owner rather than being checked against one.
 * - `user` — addressed by `userId` in the path; that id is the owner.
 * - `host` — spans every flow and user (listings). No single owner, so the
 *   handler scopes its results to the caller instead.
 */
type RouteSubject =
  | { kind: "exempt" }
  | { kind: "session"; sessionId: string }
  | { kind: "request"; requestId: string }
  | { kind: "flow"; flowKind: string }
  | { kind: "user"; userId: string }
  | { kind: "host" };

/**
 * Map a parsed route to the thing it addresses. The switch is exhaustive over
 * `ParsedFlowRoute["kind"]` — the `never` assignment at the end makes a newly
 * added route a compile error here, so no route can be introduced without
 * deciding how it is authorized.
 */
function routeSubject(route: ParsedFlowRoute): RouteSubject {
  switch (route.kind) {
    case "not_found":
    case "list_flows":
    case "capabilities":
    case "execute_action":
      return { kind: "exempt" };

    // Session-addressed. `retry_request` / `continue_request` also carry a
    // `flowKind`, but the session record is the stronger subject: it names the
    // owner and the trusted flow.
    case "get_session":
    case "delete_session":
    case "patch_session_metadata":
    case "list_session_requests":
    case "get_session_state":
    case "retry_request":
    case "continue_request":
    case "get_resource_content":
    case "get_collection_item_content":
    case "create_collection_item":
    case "update_resource_content":
    case "delete_collection_item":
    case "list_collection_state":
    case "get_collection_item_state":
    case "get_resource_manifest":
    case "debug_list_resources":
    case "debug_list_suspensions":
    case "debug_list_collection_items":
    case "debug_get_resource_content":
    case "debug_get_collection_item_content":
      return { kind: "session", sessionId: route.sessionId };

    case "request_stream":
    case "abort_request":
    case "resume_suspension":
    case "request_status":
      return { kind: "request", requestId: route.requestId };

    case "create_session":
      return { kind: "flow", flowKind: route.flowKind };

    case "user_stream":
    case "check_interrupted_requests":
      return { kind: "user", userId: route.userId };

    case "list_sessions":
    case "active_requests":
    case "transcribe":
      return { kind: "host" };

    default: {
      const exhaustive: never = route;
      return exhaustive;
    }
  }
}

/**
 * The resolver that governs `flowKind`: the flow's own if it configures one,
 * otherwise the host-level fallback. Mirrors the precedence
 * `createInboundTransportHost` applies, so the guard's enforce/skip decision
 * can never disagree with the resolver the host actually calls.
 */
function governingResolver(
  ctx: RouteAuthContext,
  flowKind: string | undefined
): PrincipalResolver {
  const flow = flowKind === undefined ? undefined : ctx.registry.get(flowKind);
  return flow?.authentication?.resolvePrincipal ?? ctx.hostResolver;
}

/** Whether any registered flow configures a resolver that is not the framework default. */
function anyFlowAuthenticates(ctx: RouteAuthContext): boolean {
  return ctx.registry.list().some((flow) => {
    const resolver = flow.authentication?.resolvePrincipal;
    return resolver !== undefined && !isDefaultBodyUserIdPrincipalResolver(resolver);
  });
}

/**
 * Authenticate and authorize a management route.
 *
 * Returns `{}` to let the route run as-is (no enforcement configured, or the
 * caller checked out), `{ principal }` when a caller was authenticated, or
 * `{ denied }` with the response to send instead of dispatching.
 *
 * An addressed record that does not exist returns `{}` so the route handler
 * emits its own 404 — the guard does not turn a missing session into an auth
 * error, and reveals nothing either way.
 */
export async function authorizeManagementRoute(
  request: Request,
  route: ParsedFlowRoute,
  ctx: RouteAuthContext
): Promise<RouteAuthResult> {
  const subject = routeSubject(route);
  if (subject.kind === "exempt") return ALLOWED;

  // Nothing in this app authenticates, so there is nothing to enforce and no
  // reason to touch a store. Checked before any load: deciding per-route would
  // mean reading the session record on every management request just to reach
  // the same answer, adding a query to a hot path (the DevTool polls these) for
  // every app that will never enforce.
  if (
    isDefaultBodyUserIdPrincipalResolver(ctx.hostResolver) &&
    !anyFlowAuthenticates(ctx)
  ) {
    return ALLOWED;
  }

  // Governing flow and record owner, both read from stored records so neither
  // is caller-controlled (BP-031).
  let flowKind: string | undefined;
  let owner: string | undefined;
  let sessionId: string | undefined;

  switch (subject.kind) {
    case "session": {
      const session = await loadTenantSession(
        ctx.stores.session,
        subject.sessionId,
        ctx.tenantId
      );
      if (session === undefined) return ALLOWED;
      flowKind = session.flowKind;
      owner = session.userId;
      sessionId = subject.sessionId;
      break;
    }
    case "request": {
      const record = await ctx.stores.request.get(subject.requestId);
      if (record !== undefined) {
        flowKind = record.flowKind;
        owner = record.userId;
        sessionId = record.sessionId;
        break;
      }
      // The record may not be persisted yet: on serverless the POST and the
      // GET can land on different instances, and `handleRequestStream` waits
      // for it to appear rather than 404ing. Resolving the owner from the
      // in-flight registry — which `runAction` writes earlier, and which
      // carries the same `userId` — keeps that window authorized instead of
      // letting it through unchecked.
      const active = await ctx.stores.activeRequests.get(subject.requestId);
      if (active === undefined) return ALLOWED;
      flowKind = active.flowKind;
      owner = active.userId;
      sessionId = active.sessionId;
      break;
    }
    case "flow":
      // No record yet — the authenticated caller becomes the owner.
      flowKind = subject.flowKind;
      break;
    case "user":
      owner = subject.userId;
      break;
    case "host":
      break;
  }

  const resolver = governingResolver(ctx, flowKind);
  if (isDefaultBodyUserIdPrincipalResolver(resolver)) {
    // No authentication configured for this route's flow. A flow-scoped route
    // is genuinely open in this app, so leave it alone. A route that spans
    // every flow is different: when some other flow *is* authenticated, serving
    // it anonymously would hand out that flow's sessions through the back door.
    // Fail closed and name the fix.
    if (flowKind === undefined && anyFlowAuthenticates(ctx)) {
      return {
        denied: jsonResponse(401, {
          error:
            `This endpoint spans every flow, and at least one registered flow configures ` +
            `authentication.resolvePrincipal, so it cannot be served anonymously. Configure a ` +
            `host-level resolvePrincipal (createFlowState / createFlowApiRouter) so the caller ` +
            `can be identified and results scoped to them.`
        })
      };
    }
    return ALLOWED;
  }

  let principal: ResolvedPrincipal;
  try {
    principal = await ctx.host.resolvePrincipal({
      source: "http",
      request,
      envelope: {
        // Empty for host- and user-addressed routes: `registry.get("")` misses,
        // so the host falls through to its own resolver with `requireUser`
        // enforced — exactly the intended behavior for a route with no flow.
        flowKind: flowKind ?? "",
        action: route.kind,
        sessionId,
        // Deliberately no `body` — see the file header.
        metadata: {},
        input: undefined
      }
    });
  } catch (error) {
    if (error instanceof PrincipalResolutionError) {
      return { denied: jsonResponse(error.status, { error: error.message }) };
    }
    throw error;
  }

  if (owner !== undefined && principal.userId !== owner) {
    // Deliberately not a 404: the caller authenticated, and the record's
    // existence is already implied by the id they hold. 403 says "not yours",
    // which is the accurate and more debuggable answer.
    return {
      denied: jsonResponse(403, {
        error: "Caller is not the owner of the requested resource"
      })
    };
  }

  return { principal };
}
