/**
 * Route-level authentication and ownership authorization for the management
 * surface of `/api/flows` — session CRUD, session state, resource content,
 * request control, and the debug endpoints. Runs once per request, before the
 * route dispatcher: it resolves a principal through `host.resolvePrincipal`
 * and checks that the principal owns the record the URL addressed.
 *
 * The contract — the route/subject/owner table, when enforcement is active,
 * and how cross-flow listings behave in a mixed app — is
 * `docs/architecture/authentication.md` → "Scope: the whole `/api/flows`
 * surface". Read that first; the invariants that are easy to break while
 * editing this file are noted inline below.
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
import { pickPrincipalResolver } from "../transports/auth/pickPrincipalResolver";
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
  /**
   * Set only for a cross-flow listing reached without a principal, in an app
   * where some flow authenticates and the host-level fallback does not: the
   * flow kinds whose effective resolver is the framework default. The handler
   * returns rows for these kinds and withholds the rest.
   *
   * An empty set means "withhold everything"; `undefined` means the listing is
   * unrestricted (either nothing in the app authenticates, or a principal
   * scoped it already).
   */
  anonymousFlowKinds?: Set<string>;
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

    case "get_session":
    case "delete_session":
    case "patch_session_metadata":
    case "list_session_requests":
    case "get_session_state":
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

    // Request-addressed. `retry_request` / `continue_request` also carry a
    // `sessionId`, but the request record is the subject: it is what these
    // routes act on, and it names the owner. Authorizing on the path's session
    // instead would let a caller pair a session they own with a `requestId`
    // they do not — `handleRetryRequest` never checks that the two are related
    // (`handleContinueRequest` does, but relying on a linkage check that only
    // one of the pair performs is not an authorization model).
    case "request_stream":
    case "abort_request":
    case "resume_suspension":
    case "request_status":
    case "retry_request":
    case "continue_request":
      return { kind: "request", requestId: route.requestId };

    case "create_session":
      return { kind: "flow", flowKind: route.flowKind };

    case "user_stream":
    case "check_interrupted_requests":
      return { kind: "user", userId: route.userId };

    // Cross-flow. The two listings scope their rows to the caller in the
    // handler; `transcribe` has no rows to scope — it is a stateless
    // speech-to-text utility — so for it "host" means authentication only,
    // held to the same bar as the listings rather than left open.
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

/** Whether `flow` configures a resolver that is not the framework default. */
function flowAuthenticates(flow: {
  authentication?: { resolvePrincipal?: PrincipalResolver };
}): boolean {
  const resolver = flow.authentication?.resolvePrincipal;
  return resolver !== undefined && !isDefaultBodyUserIdPrincipalResolver(resolver);
}

/** Whether any registered flow configures a resolver that is not the framework default. */
function anyFlowAuthenticates(ctx: RouteAuthContext): boolean {
  return ctx.registry.list().some(flowAuthenticates);
}

/** The kinds of every registered flow that does NOT configure its own authentication. */
function unauthenticatedFlowKinds(ctx: RouteAuthContext): Set<string> {
  return new Set(
    ctx.registry
      .list()
      .filter((flow) => !flowAuthenticates(flow))
      .map((flow) => flow.kind)
  );
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

  const resolver = pickPrincipalResolver(ctx.registry, flowKind, ctx.hostResolver);
  if (isDefaultBodyUserIdPrincipalResolver(resolver)) {
    // No authentication governs this route. For a flow-scoped route that means
    // the flow is genuinely open in this app, so leave it alone. A
    // user-addressed route (`/users/:userId/...`) acts on one caller's own
    // records rather than listing across flows, so it is left alone too.
    if (subject.kind !== "host") return ALLOWED;

    // A cross-flow listing is different: some other flow may authenticate, and
    // serving its sessions here would hand them out through the back door.
    // Withhold those rows rather than refusing the route — refusing would take
    // the whole listing away from every app that has one authenticated flow
    // (a cron-triggered digest is enough), including the flows that are open
    // by design. The caller still gets everything they could already see.
    return { anonymousFlowKinds: unauthenticatedFlowKinds(ctx) };
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
