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
import type { RequestRecord, SessionRecord, StoreRegistry } from "../stores/types";
import type {
  InboundTransportHost,
  PrincipalResolver,
  ResolvedPrincipal
} from "../transports/types";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { PrincipalResolutionError } from "../transports/errors";
import { isDefaultBodyUserIdPrincipalResolver } from "../transports/auth/defaultBodyUserIdPrincipalResolver";
import { resolveRecordOwner, type OwnedRecord } from "../context/record-owner";
import {
  isOrgAttributed,
  UnattributedOrgError,
  type OrgAttributedRecord
} from "../context/org-attribution";
import { sessionKeyOfBlobOwner, userBlobKeeper } from "../blobs/attachments";
import type { BlobUploader } from "../blobs/types";
import { resolveSessionStorageKey, toBareSessionId } from "../stores/scope-keys";
import {
  jsonResponse,
  loadTenantSession,
  refuseUnattributedRecord,
  unknownBlobResponse,
  unknownRequestResponse,
  unknownRequestStreamResponse,
  unknownSessionResponse
} from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";
import { flowAuthenticates } from "./instance-caller";
import { DEFAULT_WRITE_FLOW, writeSessionGoverningFlow } from "../resources/default-write-flow";

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
  // FIX-682.
  /** Tenant id for this request; namespaces the session lookup. */
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
   * flow INSTANCE ids whose effective resolver is the framework default. The
   * handler resolves each row's owner and returns the rows owned by one of
   * these, withholding the rest — so an open instance never makes a
   * same-kind authenticated peer's rows visible. The two listings judge a row
   * owned by an instance with its own resolver through that resolver instead
   * (`instance-caller.ts`); the interrupted-request sweep does not.
   *
   * An empty set means "withhold everything"; `undefined` means the listing is
   * unrestricted (either nothing in the app authenticates, or a principal
   * scoped it already).
   */
  anonymousFlowIds?: Set<string>;
  /**
   * For a session-addressed route, the session the guard read and checked the
   * caller against: `null` when it read none. Absent when the guard read
   * nothing (nothing in the app authenticates, or the route addresses no
   * session). A handler that reads the session again compares the two, so it
   * never serves a session that took the id after the check.
   */
  session?: SessionRecord | null;
  /**
   * For a request-addressed route, the request record the guard read and
   * checked the caller against. Absent when it read none. A request id is
   * the caller's to choose, so between this check and the handler's own read
   * the request can be deleted and the id taken by another owner; a handler
   * that reads the record again compares incarnations and answers as for an
   * unknown request when they differ.
   */
  request?: RequestRecord;
  /**
   * Set with `denied` when the denial is the route's not-found for a session
   * another user owns. A route that checks something of its own before it
   * looks a session up (the debug routes' enablement and origin gate) runs
   * that first, so the caller gets what an unused id would get them.
   */
  sessionHidden?: true;
};

const ALLOWED: RouteAuthResult = {};

/**
 * The not-found a session-addressed route answers for an id with no session
 * behind it, given for a session another user owns. The debug routes name a
 * missing session in their own error code; every other route shares
 * `unknownSessionResponse`.
 */
function hiddenSessionResponse(route: ParsedFlowRoute, sessionId: string): Response {
  // A file's 404 names nothing: not the session that owns it, nor its owner.
  if (route.kind === "get_blob") return unknownBlobResponse();
  return route.kind.startsWith("debug_")
    ? jsonResponse(404, { error: "session_not_found" })
    : unknownSessionResponse(sessionId);
}

/**
 * The answer a request route gives an id with no request behind it, given for
 * a request another user owns. Every request-addressed route has one: the
 * stream's (which names an unknown flow first, and is an empty 200 for a
 * resume cursor), and `unknownRequestResponse` for status, retry, continue,
 * resume and abort.
 */
function hiddenRequestResponse(
  request: Request,
  route: ParsedFlowRoute,
  registry: FlowRegistry,
  requestId: string
): Response {
  return route.kind === "request_stream"
    ? unknownRequestStreamResponse(request, route, registry)
    : unknownRequestResponse(requestId);
}

/**
 * What a route addresses, and therefore who owns it.
 *
 * - `exempt` — no owner to check: public flow metadata, or `execute_action`
 *   and `run_read`, which resolve their own principal in their handlers.
 * - `session` / `request` — owner is the stored record's `userId`.
 * - `blob` — a stored file, checked as the session that owns it is: whoever
 *   can read that session can read the file. A file no session
 *   owns, or one in another tenant, is answered as an unknown file.
 * - `flow` — creating a session under a flow. No record exists yet, so the
 *   caller becomes the owner rather than being checked against one.
 * - `user` — addressed by `userId` in the path; that id is the owner.
 * - `host` — spans every flow and user (listings). No single owner, so the
 *   handler scopes its results to the caller instead.
 */
export type RouteSubject =
  | { kind: "exempt" }
  | { kind: "session"; sessionId: string }
  | { kind: "blob"; blobId: string }
  | { kind: "request"; requestId: string }
  | { kind: "flow"; flowKind: string }
  | { kind: "user"; userId: string }
  | { kind: "host" };

/**
 * Map a parsed route to the thing it addresses. The switch is exhaustive over
 * `ParsedFlowRoute["kind"]` — the `never` assignment at the end makes a newly
 * added route a compile error here, so no route can be introduced without
 * deciding how it is authorized.
 *
 * Exported (module-level only, not from `routes/index.ts`) so the user-route
 * scoping test can derive its route set from this classification rather than
 * from a hand-maintained list.
 */
export function routeSubject(route: ParsedFlowRoute): RouteSubject {
  switch (route.kind) {
    case "not_found":
    case "list_flows":
    case "capabilities":
    case "execute_action":
    // A read resolves its principal the way an action does, in its handler,
    // and runs under the same session binding checks (`read-routes.ts`).
    case "run_read":
    // FIX-2624: each resolves its caller in its handler through the declaring
    // flow's own resolver (`scope-address.ts`), never the body, query or
    // headers (BP-031); a send then runs as an action does.
    case "read_scope_resource":
    case "send_resource":
    case "flow_identity":
      return { kind: "exempt" };

    case "get_session":
    case "delete_session":
    case "patch_session_metadata":
    case "list_session_requests":
    // Session-addressed on the *path's* session id, not `host` (FIX-1010).
    // This is the classification the parent-to-child read exists to land in:
    // the framework resolves the addressed record and checks its owner before
    // the handler runs. Reclassified as `host`, the parent id would never be
    // loaded as a record and so never ownership- or tenant-checked.
    case "list_session_children":
    case "get_session_state":
    // Authorized exactly as the snapshot above: the stream sends what a
    // snapshot read would show, so it answers to the same owner check.
    case "session_stream":
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
    case "answer_suspension":
    case "request_status":
    case "retry_request":
    case "continue_request":
      return { kind: "request", requestId: route.requestId };

    case "create_session":
      return { kind: "flow", flowKind: route.flowKind };

    // User-addressed. The guard checks only the path's `userId`; the handler
    // scopes by tenant, organization and the anonymous allow-list. A route
    // added here needs an entry in the user-route scoping table
    // (`test/user-route-scoping.test.ts`), which fails until it has one and
    // then probes it with cross-org, cross-tenant and anonymous callers.
    case "user_stream":
    // The mint: the guard checks the path's user is the caller, and the
    // handler checks each topic with its own scope's check (FIX-2428).
    case "user_stream_mint":
    case "check_interrupted_requests":
    case "list_interrupted_requests":
      return { kind: "user", userId: route.userId };

    // Cross-flow. The two listings scope their rows to the caller in the
    // handler; `transcribe` has no rows to scope — it is a stateless
    // speech-to-text utility — so for it "host" means authentication only,
    // held to the same bar as the listings rather than left open.
    case "list_sessions":
    case "active_requests":
    case "transcribe":
      return { kind: "host" };

    // An upload has no owner yet: it is held for the caller who sent it, so
    // this is authentication only. Addressed to a flow, it is that flow's own
    // sign-in, so the uploader is the principal the flow's send resolves;
    // otherwise the host's, as for `transcribe`.
    case "upload_blob":
      return route.flowKind === undefined ? { kind: "host" } : { kind: "flow", flowKind: route.flowKind };

    case "get_blob":
      return { kind: "blob", blobId: route.blobId };

    default: {
      const exhaustive: never = route;
      return exhaustive;
    }
  }
}

/**
 * The instance a stored record belongs to. Absent when its owner is not in
 * this process, which falls to the host resolver below exactly as an
 * unregistered kind always did. Ambiguous legacy history is different: a
 * collection's ownerless row has NO instance whose authentication could
 * govern it, and letting it fall to the host resolver would serve an
 * authenticated collection's history to whoever the host admits. It is
 * refused with the same `409 migration-required` the record routes answer.
 *
 * Either refusal is DECIDED here and DELIVERED later, once the caller's
 * standing is known (see `pendingDenial` in `authorizeManagementRoute`). What
 * that means for an anonymous caller differs by axis, because the two axes
 * leave `governing` in different states:
 *
 *  - **Unattributed organization, owner resolvable.** The owning instance is
 *    returned alongside the refusal, so the caller is authenticated against
 *    that instance's resolver first. An anonymous caller gets the ordinary
 *    `401` — identical to what an attributed record answers them — so the
 *    status cannot be used to probe which ids exist and which predate
 *    organizations.
 *  - **Owner unresolvable.** No instance governs the row, so there is no
 *    resolver to authenticate against and `governing` stays undefined. The
 *    refusal is spent at the unauthenticated exit instead, and an anonymous
 *    caller does get the `409` — unchanged, and asserted by
 *    `flow-instance-ownership.test.ts`. There is no oracle to close here: the
 *    row is refused to everyone, on every route, with or without a credential.
 */
function ownerFlowOf(
  ctx: RouteAuthContext,
  record: OwnedRecord & OrgAttributedRecord
): { flow?: FlowInstance; denied?: Response } {
  const owner = resolveRecordOwner(ctx.registry, record);
  let flow = owner.ok ? owner.flow : undefined;
  // FIX-2624: a write session answers to the sign-in of the flow that declares
  // the resource it writes, not to the default write flow, which has none.
  if (flow?.id === DEFAULT_WRITE_FLOW) {
    const sessionId = (record as { sessionId?: string }).sessionId ?? (record as { id?: string }).id;
    flow = writeSessionGoverningFlow(ctx.registry, ctx.hostResolver, sessionId);
    if (flow === undefined) return { denied: jsonResponse(404, { error: "Unknown write session" }) };
  }
  // The organization axis is checked FIRST and independently of the owner
  // (FIX-1442). A record can name its owning flow perfectly well and still
  // predate organizations entirely — which is the common case, since `flowId`
  // and `orgId` became required at different times. Folding this into the
  // `!owner.ok` branch below would only refuse rows that failed BOTH, and the
  // rows this rule exists for are exactly the ones that pass the first.
  //
  // The owning flow is still handed back with the refusal: the caller has to
  // be authenticated against the right resolver before the refusal is spent
  // on them (see `pendingDenial` in `authorizeManagementRoute`).
  if (!isOrgAttributed(record)) {
    return {
      flow,
      denied: jsonResponse(409, {
        error: "migration-required",
        message: new UnattributedOrgError("this route").message
      })
    };
  }
  if (owner.ok) return { flow };
  const denied = refuseUnattributedRecord(ctx.registry, record);
  return denied === undefined ? {} : { denied };
}

/** Whether any registered flow configures a resolver that is not the framework default. */
function anyFlowAuthenticates(ctx: RouteAuthContext): boolean {
  return ctx.registry.list().some(flowAuthenticates);
}

/** The ids of every registered flow instance that does NOT configure its own authentication. */
function unauthenticatedFlowIds(ctx: RouteAuthContext): Set<string> {
  return new Set(
    ctx.registry
      .list()
      // The default write flow is never open: its records answer to the
      // declaring flow's sign-in (`ownerFlowOf`).
      .filter((flow) => !flowAuthenticates(flow) && flow.id !== DEFAULT_WRITE_FLOW)
      .map((flow) => flow.id)
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

  // Governing flow instance and record owner, both read from stored records
  // so neither is caller-controlled (BP-031). The instance is the record's
  // stored OWNER, resolved through the one owner interpretation — never a
  // lookup by its stored kind, which for a collection could pick a peer whose
  // authentication differs.
  let governing: FlowInstance | undefined;
  let owner: string | undefined;
  // The record's organization, checked alongside its owner below. Undefined
  // for a route that addresses no stored record (creating a session, a
  // listing) — there is nothing to compare against yet.
  let ownerOrgId: string | undefined;
  let sessionId: string | undefined;
  /**
   * The session or request record an addressed route was checked against;
   * see `RouteAuthResult.session` and `RouteAuthResult.request`.
   */
  let checked: { session: SessionRecord } | { request: RequestRecord } | undefined;
  /**
   * A refusal this record has already earned, HELD until the caller has been
   * authenticated.
   *
   * `migration-required` names something about the stored record — that it
   * exists, and that it predates organizations — so handing it to an anonymous
   * caller turns the route into an oracle: probe an id and the status tells you
   * which. An attributed record answers 401 to the same probe, and so must this
   * one. It is spent below, at each exit where the caller is either
   * authenticated or facing a route that authenticates nobody.
   */
  let pendingDenial: Response | undefined;
  /** The route reads a file a user's own scope keeps: every refusal is an unknown file's 404. */
  let userKept = false;

  // A file is read under the check of the session that owns it. A file no
  // session owns (held for its uploader, or another tenant's) has no session
  // to check against and is answered as no file at all.
  let effective: RouteSubject = subject;
  if (subject.kind === "blob") {
    const owning = await blobSessionId(ctx.stores, subject.blobId, ctx.tenantId);
    // A file a user's own scope keeps (a task's brief, FIX-2522) is read
    // under that user's check, signed in as the flow that kept it would sign
    // them in: the read route names no flow, and with authentication on the
    // flow alone the host's resolver verifies nobody. The flow is the one the
    // stored owner names, never the caller's choice (BP-031).
    const keeper = owning === undefined ? await blobUserScope(ctx.stores, subject.blobId, ctx.tenantId) : undefined;
    if (owning !== undefined) effective = { kind: "session", sessionId: owning };
    else if (keeper !== undefined) {
      owner = keeper.user.userId;
      ownerOrgId = keeper.user.orgId;
      governing = ctx.registry.get(keeper.flowId);
      userKept = true;
      // A keeping flow this app no longer runs leaves no sign-in to check the
      // caller under. Where something authenticates, nobody can be shown to be
      // the file's user, so it is no file at all.
      if (governing === undefined && isDefaultBodyUserIdPrincipalResolver(ctx.hostResolver)) {
        return { denied: unknownBlobResponse() };
      }
    } else return { denied: unknownBlobResponse() };
  }

  switch (effective.kind) {
    case "session": {
      const session = await loadTenantSession(
        ctx.stores.session,
        effective.sessionId,
        ctx.tenantId
      );
      if (session === undefined) {
        return subject.kind === "blob" ? { denied: unknownBlobResponse() } : { session: null };
      }
      const resolved = ownerFlowOf(ctx, session);
      if (resolved.denied !== undefined) pendingDenial = resolved.denied;
      governing = resolved.flow;
      owner = session.userId;
      ownerOrgId = session.orgId;
      sessionId = effective.sessionId;
      checked = { session };
      break;
    }
    case "request": {
      const record = await ctx.stores.request.get(effective.requestId);
      if (record !== undefined) {
        checked = { request: record };
        const resolved = ownerFlowOf(ctx, record);
        if (resolved.denied !== undefined) pendingDenial = resolved.denied;
        governing = resolved.flow;
        owner = record.userId;
        ownerOrgId = record.orgId;
        sessionId = record.sessionId;
        break;
      }
      // The record may not be persisted yet: on serverless the POST and the
      // GET can land on different instances, and `handleRequestStream` waits
      // for it to appear rather than 404ing. Resolving the owner from the
      // in-flight registry — which `runAction` writes earlier, and which
      // carries the same `userId` — keeps that window authorized instead of
      // letting it through unchecked.
      const active = await ctx.stores.activeRequests.get(effective.requestId);
      if (active === undefined) {
        // No record and no in-flight entry: nothing names an owner. The stream
        // would still replay an event log that outlived its record (evicted
        // by retention, or older than event cleanup), by id alone, to
        // whoever asks. In an app that authenticates, no caller can be
        // checked against a log with no owner, so it is answered as an id
        // nobody has used, its owner included. Every other request route
        // has nothing to serve without a record, and answers that itself.
        if (route.kind === "request_stream") {
          return { denied: unknownRequestStreamResponse(request, route, ctx.registry) };
        }
        return ALLOWED;
      }
      const resolved = ownerFlowOf(ctx, active);
      if (resolved.denied !== undefined) pendingDenial = resolved.denied;
      governing = resolved.flow;
      owner = active.userId;
      ownerOrgId = active.orgId;
      sessionId = active.sessionId;
      break;
    }
    case "flow":
      // No record yet — the authenticated caller becomes the owner. The
      // address is an exact instance id.
      governing = ctx.registry.get(effective.flowKind);
      break;
    case "user":
      owner = effective.userId;
      break;
    case "host":
      break;
  }

  // The same precedence `pickPrincipalResolver` applies for the host, on the
  // instance resolved above: a record whose owner cannot be resolved falls to
  // the host resolver, exactly as an unregistered kind always did.
  const resolver = governing?.authentication?.resolvePrincipal ?? ctx.hostResolver;
  if (isDefaultBodyUserIdPrincipalResolver(resolver)) {
    // Nothing authenticates this record, so there is no identity to withhold
    // the refusal for and no oracle to open: spend it here.
    if (pendingDenial !== undefined) return { denied: pendingDenial };

    // An app with no resolver still has an organization: the framework default
    // (D3) is what every record it writes is stamped with, so that — not
    // "nothing" — is the identity to compare against. A record carrying a
    // DIFFERENT organization was written before the upgrade, from the
    // caller-controlled `body.orgId` this change removes, and belongs to an
    // organization nobody on this path can prove they are in.
    //
    // This is the half the earlier reading missed. "No resolver, so every
    // record is under the default, so there is no boundary to skip" is true of
    // records this app WROTE and false of the ones it inherited — and the
    // inherited ones are attributed, so the `migration-required` refusal above
    // does not reach them. Without this, the open path is the one way around
    // BR-8.
    if (ownerOrgId !== undefined && ownerOrgId !== DEFAULT_ORG_ID) {
      if (userKept) return { denied: unknownBlobResponse() };
      return {
        denied: jsonResponse(403, {
          error: "Caller's organization does not own the requested resource"
        })
      };
    }

    // No authentication governs this route. For a flow-scoped route that means
    // the flow is genuinely open in this app, so leave it alone.
    if (subject.kind !== "host" && subject.kind !== "user") return { ...checked };

    // A user-addressed route (`/users/:userId/...`) takes its userId from the
    // path, so an anonymous caller can name anyone. That is harmless while every
    // flow is open, but `check-interrupted` *mutates* — it sweeps in-flight
    // requests to `interrupted` — so in a mixed app it would let an anonymous
    // caller disrupt an authenticated flow's runs. Scope it the same way as the
    // cross-flow listing below rather than refusing the route: an app where
    // nothing authenticates gets every kind back and is unaffected.
    //
    // A cross-flow listing is different: some other flow may authenticate, and
    // serving its sessions here would hand them out through the back door.
    // Withhold those rows rather than refusing the route — refusing would take
    // the whole listing away from every app that has one authenticated flow
    // (a cron-triggered digest is enough), including the flows that are open
    // by design. The caller still gets everything they could already see.
    return { anonymousFlowIds: unauthenticatedFlowIds(ctx) };
  }

  let principal: ResolvedPrincipal;
  try {
    principal = await ctx.host.resolvePrincipal({
      source: "http",
      request,
      envelope: {
        // The governing instance's address, so the host picks the same
        // resolver this guard did. Empty for host- and user-addressed routes
        // and for an unresolvable owner: `registry.get("")` misses, so the host
        // falls through to its own resolver with `requireUser` enforced —
        // exactly the intended behavior for a route with no flow.
        flowKind: governing?.id ?? "",
        action: route.kind,
        sessionId,
        // Deliberately no `body` — see the file header.
        metadata: {},
        input: undefined
      }
    });
  } catch (error) {
    if (error instanceof PrincipalResolutionError) {
      // A kept file's id travels in every brief that names it: a caller who
      // can't sign in hears what an id nobody has used answers.
      if (userKept) return { denied: unknownBlobResponse() };
      return { denied: jsonResponse(error.status, { error: error.message }) };
    }
    throw error;
  }

  // Another user's session is not found, exactly as an id nobody has used
  // is. A session id is an address that travels in URLs, so holding one
  // proves nothing; a 403 here would tell the caller the id is in use. Ahead
  // of the held refusal below: a legacy session's `migration-required` names
  // something about the record, and is its owner's to hear, not another
  // user's.
  if (effective.kind === "session" && owner !== undefined && principal.userId !== owner) {
    return {
      denied: hiddenSessionResponse(route, effective.sessionId),
      sessionHidden: true
    };
  }
  // The same for every request-addressed route, reads and control alike: a
  // request id travels in headers, bodies and URLs, so another user's is
  // answered as an id nobody has used, a legacy one included (ahead of the
  // held refusal, as for the session above).
  if (subject.kind === "request" && owner !== undefined && principal.userId !== owner) {
    return { denied: hiddenRequestResponse(request, route, ctx.registry, subject.requestId) };
  }

  // The caller has now proven who they are, so the held refusal costs nothing
  // to give. Before the owner and organization checks: a record that cannot be
  // admitted at all is answered as such rather than as somebody else's.
  if (pendingDenial !== undefined) return { denied: pendingDenial };

  // Another person's kept file is no file at all, as another session's is.
  if (subject.kind === "blob" && owner !== undefined && principal.userId !== owner) {
    return { denied: unknownBlobResponse() };
  }

  if (owner !== undefined && principal.userId !== owner) {
    // Only a user-addressed route reaches here (sessions and requests were
    // answered above): the path names someone else, and 403 says so.
    return {
      denied: jsonResponse(403, {
        error: "Caller is not the owner of the requested resource"
      })
    };
  }

  // The organization boundary, checked as well as the owner and not instead of
  // it (FIX-1442, BR-8).
  //
  // The user check above passes for the case this exists to stop: ONE person
  // who belongs to two organizations, holding a session id from one and asking
  // for it while acting as the other. Same `userId` on both sides, so ownership
  // matched and the record was served straight across the boundary the app
  // believed it had. Both axes must agree, because either alone admits a real
  // caller to real data that is not theirs in this context.
  //
  // Read from the STORED record, never from the request (BP-031) — the whole
  // point is that the caller does not get to say which organization they are
  // in; the verified principal does.
  if (ownerOrgId !== undefined && principal.orgId !== ownerOrgId) {
    // A request id travels as freely across organizations as across users, so
    // another organization's is answered as an id nobody has used, exactly as
    // another user's is above.
    if (subject.kind === "request") {
      return { denied: hiddenRequestResponse(request, route, ctx.registry, subject.requestId) };
    }
    // A file id travels inside every message that names it, the same way.
    if (subject.kind === "blob") return { denied: unknownBlobResponse() };
    return {
      denied: jsonResponse(403, {
        error: "Caller's organization does not own the requested resource"
      })
    };
  }

  return { principal, ...checked };
}

// FIX-2522.
/**
 * The user whose own scope keeps a stored file (`userBlobOwner`), in
 * `tenantId`'s namespace, and the flow instance that kept it; `undefined` for
 * any other file. The user is the file's uploader: a scope keeps only its own
 * user's files.
 */
export async function blobUserScope(
  stores: Pick<StoreRegistry, "blobs">,
  blobId: string,
  tenantId: string | undefined
): Promise<{ user: BlobUploader; flowId: string } | undefined> {
  const record = await stores.blobs?.head(blobId);
  if (record?.owner === undefined) return undefined;
  const flowId = userBlobKeeper(record.owner, tenantId, record.uploader);
  return flowId === undefined ? undefined : { user: record.uploader, flowId };
}

/**
 * The bare id of the session that owns a stored file, when that session is in
 * `tenantId`'s namespace; `undefined` for a file held for its uploader, gone,
 * or another tenant's. Shared with the read route, which runs it again on an
 * app where nothing authenticates and this guard checked nothing.
 */
export async function blobSessionId(
  stores: Pick<StoreRegistry, "blobs">,
  blobId: string,
  tenantId: string | undefined
): Promise<string | undefined> {
  const record = await stores.blobs?.head(blobId);
  const key = record?.owner === undefined ? undefined : sessionKeyOfBlobOwner(record.owner);
  if (key === undefined) return undefined;
  const bare = toBareSessionId(key, tenantId);
  // A key that doesn't round-trip is in another tenant's namespace.
  return resolveSessionStorageKey(bare, tenantId) === key ? bare : undefined;
}
