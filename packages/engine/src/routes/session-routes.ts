/**
 * Session CRUD route handlers: create, get, list, delete.
 */
import type { JsonObject, RequestStatus } from "@flow-state-dev/core/types";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowRegistry } from "../registry/flow-registry";
import type { SessionParentage, SessionRecord, StoreRegistry } from "../stores/types";
import type { ResolvedPrincipal } from "../transports/types";
import { generateId } from "../utils/generate-id";
import { purgeStaleResourceState } from "../context/ensure-session-record";
import { resolveRecordOwner } from "../context/record-owner";
import { pinRejectsCaller, unknownFlowMessage } from "../context/hire-plane";
import { isOrgAttributed } from "../context/org-attribution";
import {
  asObject,
  asStringArray,
  emptyResponse,
  getBooleanFlag,
  getPositiveInteger,
  getString,
  jsonResponse,
  loadTenantSession,
  parseJsonBody,
  refuseUnattributedRecord
} from "./route-utils";
import {
  resolveSessionStorageKey,
  toBareSessionId
} from "../stores/scope-keys";
import type { ParsedFlowRoute } from "./parseFlowRoute";

type SessionRouteContext = {
  registry: FlowRegistry;
  stores: StoreRegistry;
  /**
   * Tenant id from the request header (FIX-682). Namespaces every session
   * storage key so a route resolves only the calling tenant's session.
   * Undefined for single-tenant requests.
   */
  tenantId?: string;
  /**
   * The authenticated caller, when route-level authentication is active
   * (see `route-auth.ts`). Undefined for an app on the framework default
   * resolver, where these routes behave exactly as they always have.
   */
  principal?: ResolvedPrincipal;
  /**
   * For an anonymous cross-flow listing in a mixed app: the flow instance ids
   * whose sessions may be listed without a principal. Undefined means
   * unrestricted. See `route-auth.ts`.
   */
  anonymousFlowIds?: Set<string>;
};

/**
 * The one include this listing accepts, spelled for callers rather than for
 * the store (FIX-1440).
 *
 * `parentage` is a storage concept with three modes; a caller has one question
 * — *do I also want the sessions a dispatcher ran work in?* — so that is what
 * the wire asks. Keeping the two apart is what lets the store grow a fourth
 * mode without teaching it to every client.
 */
const DISPATCH_RUNS_INCLUDE = "dispatch-runs";

/**
 * Map the `include` query parameter onto a store parentage.
 *
 * `undefined` — no include — leaves the option **off**, so the listing narrows
 * to top-level sessions exactly as it always has. That is the rule, not an
 * implementation detail: a caller that did not ask gets today's result set,
 * unchanged (FIX-1009, and `SessionListOptions.parentage`).
 *
 * An unrecognised token is a **400 naming what is accepted**, never a silent
 * ignore: a caller that misspells the include would otherwise be told nothing
 * and conclude the flow has no dispatch runs.
 */
function resolveSessionInclude(
  raw: string | null
): { parentage?: SessionParentage } | { error: string } {
  if (raw === null) return {};
  const tokens = raw
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  const unknown = tokens.filter((token) => token !== DISPATCH_RUNS_INCLUDE);
  if (unknown.length > 0) {
    return {
      error: `include accepts "${DISPATCH_RUNS_INCLUDE}"; received ${unknown
        .map((token) => `"${token}"`)
        .join(", ")}`
    };
  }
  return tokens.length === 0 ? {} : { parentage: "all" };
}

export async function handleListSessions(
  request: Request,
  _route: Extract<ParsedFlowRoute, { kind: "list_sessions" }>,
  ctx: SessionRouteContext
): Promise<Response> {
  const url = new URL(request.url);
  const include = resolveSessionInclude(url.searchParams.get("include"));
  if ("error" in include) return jsonResponse(400, include);
  const sessions = await ctx.stores.session.list({
    flowKind: getString(url.searchParams.get("flowKind")),
    // Exact owner: one instance of a collection flow. A record with no owner
    // recorded never matches, so an ownerless legacy row cannot leak in.
    flowId: getString(url.searchParams.get("flowId")),
    // An authenticated caller sees only their own sessions — the `userId`
    // query param is a convenience filter, never a way to widen the result
    // set past the principal. Without a principal (framework default
    // resolver) the param is the only filter there is, unchanged.
    userId: ctx.principal?.userId ?? getString(url.searchParams.get("userId")),
    // The same rule on the organization axis (BR-9, FIX-1442), and for the
    // same reason: one person in two organizations must not see one
    // organization's rows while acting for the other. There is deliberately no
    // `orgId` query fallback — unlike `userId`, an organization is never a
    // caller's to name, so a query param here could only ever widen.
    //
    // The key is spread in rather than always present: the store reads
    // "`orgId` in options" as the filter being ACTIVE, so passing an explicit
    // `undefined` would filter the listing down to rows that have no
    // organization — the exact legacy rows BR-14 withholds.
    ...(ctx.principal?.orgId === undefined ? {} : { orgId: ctx.principal.orgId }),
    // Always pass the tenant (present, possibly undefined) so listing isolates
    // to the calling tenant's sessions (FIX-682).
    tenantId: ctx.tenantId,
    // Spread rather than always present, so a listing without the include is
    // byte-identical to the one this route has always issued. The store reads
    // an absent `parentage` as `"top-level"`, which is the narrowing FIX-1009
    // put there on purpose; the include is the only way past it, and it widens
    // parentage alone — never owner, tenant or organization.
    ...(include.parentage === undefined ? {} : { parentage: include.parentage }),
    limit: getPositiveInteger(url.searchParams.get("limit")),
    offset: getPositiveInteger(url.searchParams.get("offset"))
  });

  // Anonymous cross-flow listing in a mixed app: withhold rows belonging to a
  // flow that authenticates. Filtered after the query, so a page can come back
  // shorter than `limit` — the alternative is one query per allowed kind, which
  // is not worth it for a path that only exists when a host-level
  // `resolvePrincipal` is absent.
  // Judged per row under its OWNER, not its kind, so an open peer of an
  // authenticated instance does not make that instance's sessions visible.
  const allowed = ctx.anonymousFlowIds;
  const flowVisible =
    allowed === undefined
      ? sessions
      : sessions.filter((s) => {
          const owner = resolveRecordOwner(ctx.registry, s);
          return owner.ok && allowed.has(owner.flow.id);
        });

  // Records stored before organizations were required are withheld (BR-14),
  // on EVERY path to this listing and not only the authenticated one.
  //
  // The `orgId` filter above runs only when there is a principal to take an
  // organization from, so an anonymous listing reached it with no attribution
  // filter at all — and handed out exactly the rows `handleGetSession` answers
  // with `409 migration-required`. A refusal the listing beside it routes
  // around is not a refusal.
  // `isOrgAttributed`, not a presence check: the legacy shape is dual-read as
  // `orgId?: string | null` (BP-030), so a presence check withholds the rows
  // that stored nothing and hands out the ones that stored `null` — which is
  // what a legacy row usually holds. Same predicate the addressed routes
  // refuse on, so the two cannot disagree.
  //
  // `allowed !== undefined` means nothing authenticated this caller, and such
  // an app's identity is the framework default (D3). A row stamped with some
  // OTHER organization predates the upgrade and is refused by the addressed
  // read, so it is withheld here for the same reason (BR-10) — the store query
  // above could not scope it, because there was no principal to scope it by.
  const visible = flowVisible.filter(
    (s) =>
      isOrgAttributed(s) && (allowed === undefined || s.orgId === DEFAULT_ORG_ID)
  );

  return jsonResponse(200, {
    // Surface bare session ids — the stored `id` is the namespaced storage key.
    sessions: visible.map((s) => ({
      ...s,
      id: toBareSessionId(s.id, ctx.tenantId)
    }))
  });
}

export async function handleGetSession(
  _request: Request,
  route: Extract<ParsedFlowRoute, { kind: "get_session" }>,
  ctx: SessionRouteContext
): Promise<Response> {
  const session = await loadTenantSession(
    ctx.stores.session,
    route.sessionId,
    ctx.tenantId
  );
  if (session === undefined) {
    return jsonResponse(404, {
      error: `Unknown session "${route.sessionId}"`
    });
  }
  const unattributed = refuseUnattributedRecord(ctx.registry, session);
  if (unattributed !== undefined) return unattributed;

  return jsonResponse(200, {
    // Surface the bare session id, not the namespaced storage key (FIX-682).
    session: { ...session, id: route.sessionId }
  });
}

export async function handleCreateSession(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "create_session" }>,
  ctx: SessionRouteContext
): Promise<Response> {
  const flow = ctx.registry.get(route.flowKind);
  if (flow === undefined) {
    return jsonResponse(404, {
      error: `Unknown flow "${route.flowKind}"`
    });
  }

  const body = await parseJsonBody(request);
  // Ownership comes from the resolved principal when one exists — never from
  // `body.userId`, which the caller writes. The same rule the action path
  // applies to `orgId` (BP-031): a verified identity is not displaceable by a
  // request field. Apps on the framework default resolver have no principal,
  // and `body.userId` remains the identity, as it is for their actions.
  const userId = ctx.principal?.userId ?? getString(body.userId);
  if (userId === undefined) {
    return jsonResponse(400, {
      error: "Session creation requires non-empty userId"
    });
  }

  // The hire's pin, before any session is written. `body.userId` is not an
  // owner: only the resolved principal counts, and a missing one fails a
  // user-owned hire closed. A mismatch is the same 404 an unknown address
  // gets, so nothing is written and the address cannot be probed.
  if (
    pinRejectsCaller(flow.ownerPin, {
      userId: ctx.principal?.userId ?? "",
      orgId: ctx.principal?.orgId ?? DEFAULT_ORG_ID,
    })
  ) {
    return jsonResponse(404, { error: unknownFlowMessage(route.flowKind) });
  }

  const now = Date.now();
  const sessionId = getString(body.sessionId) ?? generateId("sess");
  const sessionKey = resolveSessionStorageKey(sessionId, ctx.tenantId);

  // Pre-apply the session state schema's defaults (`z.string().default("...")`,
  // `z.record(...).default({})`, etc.) so a brand-new session's `state`
  // contains every declared key with its initial value. Without this the
  // initial state is `{}`, which causes two downstream bugs:
  //  1. `expose`-projected `clientData[scope]` keys are `undefined`, which
  //     JSON.stringify drops on the wire — clients receive no key at all,
  //     so `mergeStateChangeIntoSnapshot`'s `hasOwn(prev, field)` guard
  //     bails on every mid-stream `state_change` for those keys until the
  //     terminal-status snapshot refresh.
  //  2. Block code that reads `ctx.session.state.foo` before any patch
  //     would observe `undefined` rather than the schema's default.
  // Caller-supplied `body.state` overrides the defaults.
  const callerState = asObject(body.state);
  const stateSchema = flow.session?.stateSchema;
  let initialState: JsonObject = (callerState ?? {}) as JsonObject;
  if (stateSchema !== undefined) {
    const parseResult = stateSchema.safeParse(callerState ?? {});
    if (parseResult.success) {
      initialState = parseResult.data as JsonObject;
    }
    // On schema-parse failure (caller supplied an invalid override), fall
    // back to the caller's raw state — preserves prior behavior. Validation
    // happens at action-execution time, not session-create time.
  }

  const record: SessionRecord = {
    // `id` is the tenant-namespaced storage key (FIX-682), consistent with the
    // session record created in `createExecutionContext`. The response surfaces
    // the bare id below.
    id: sessionKey,
    flowKind: flow.kind,
    // The owner: the instance this route was addressed to. Every later action,
    // re-entry and read on this session is admitted against it.
    flowId: flow.id,
    userId,
    // The organization this session is bound to for the rest of its life —
    // and the one every later read, action and dispatched child is checked
    // against (FIX-1442). `body.orgId` is deliberately not consulted, at all:
    // it is caller-written, and a value taken from here would become a binding
    // the runtime afterwards treats as verified (BP-031).
    //
    // No principal means no flow governing this route authenticates anybody,
    // which is the same condition that puts the whole app on `DEFAULT_ORG_ID` —
    // so that is what the session binds to, rather than binding to nothing and
    // becoming a record the reads then have to refuse.
    orgId: ctx.principal?.orgId ?? DEFAULT_ORG_ID,
    tenantId: ctx.tenantId,
    title: getString(body.title),
    description: getString(body.description),
    tags: asStringArray(body.tags),
    metadata: asObject(body.metadata),
    state: initialState,
    // Minted per record. Recreating a deleted id therefore yields a NEW
    // lineage, which is what makes a surviving descendant of the old one keep
    // its own address with nothing conjoined in to keep them apart (FIX-1068).
    lineageId: generateId("lin"),
    version: 0,
    createdAt: now,
    updatedAt: now,
    journal: []
  };

  // This route does not go through `ensureSessionRecord` — it owes the caller a
  // 409 on a lost race, which that helper resolves into an adoption instead —
  // so it makes the same reclamation decision explicitly. `sessionId` is
  // caller-supplied, so this may be the second session to live under it, and
  // the first one's resource-state tombstones would otherwise brick every
  // static resource here (FIX-1258).
  //
  // This read does NOT decide the create race — `"absent"` below still does,
  // for the reason it always did: two requests can both pass an existence check
  // and both write, and the loser would silently overwrite the winner. What it
  // decides is whether to reclaim at all. A retried create against a session
  // that plainly already exists must not reclaim that live session's
  // tombstones, and answering 409 here keeps it from reaching one.
  if ((await ctx.stores.session.get(record.id)) !== undefined) {
    return jsonResponse(409, {
      error: `Session "${sessionId}" already exists`
    });
  }

  // Before the create, so a failure leaves nothing committed for a retry to
  // trip over. See `purgeStaleResourceState` for why this order and no other.
  await purgeStaleResourceState(ctx.stores, record.id);

  const created = await ctx.stores.session.set(record.id, record, "absent");
  if (!created.ok) {
    return jsonResponse(409, {
      error: `Session "${sessionId}" already exists`
    });
  }

  return jsonResponse(201, {
    session: { ...record, id: sessionId }
  });
}

export async function handleDeleteSession(
  _request: Request,
  route: Extract<ParsedFlowRoute, { kind: "delete_session" }>,
  ctx: SessionRouteContext
): Promise<Response> {
  const sessionKey = resolveSessionStorageKey(route.sessionId, ctx.tenantId);
  const existing = await loadTenantSession(
    ctx.stores.session,
    route.sessionId,
    ctx.tenantId
  );
  if (existing === undefined) {
    return jsonResponse(404, {
      error: `Unknown session "${route.sessionId}"`
    });
  }
  const unattributed = refuseUnattributedRecord(ctx.registry, existing);
  if (unattributed !== undefined) return unattributed;

  // Delete per-resource content and state first — if either fails, the session
  // record still exists and the operation can be retried. The reverse (orphaned
  // content/state) is a leak. All keyed by the namespaced session key (FIX-682).
  await Promise.all([
    ctx.stores.content.deleteAll("session", sessionKey),
    ctx.stores.resourceState.deleteAll("session", sessionKey)
  ]);
  await ctx.stores.session.delete(sessionKey);
  return emptyResponse(204);
}

export async function handlePatchSessionMetadata(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "patch_session_metadata" }>,
  ctx: SessionRouteContext
): Promise<Response> {
  const session = await loadTenantSession(
    ctx.stores.session,
    route.sessionId,
    ctx.tenantId
  );
  if (session === undefined) {
    return jsonResponse(404, {
      error: `Unknown session "${route.sessionId}"`
    });
  }
  const unattributed = refuseUnattributedRecord(ctx.registry, session);
  if (unattributed !== undefined) return unattributed;

  const body = await parseJsonBody(request);
  const now = Date.now();

  const updated: SessionRecord = {
    ...session,
    ...(body.title !== undefined ? { title: getString(body.title) } : {}),
    ...(body.description !== undefined ? { description: getString(body.description) } : {}),
    ...(body.tags !== undefined ? { tags: asStringArray(body.tags) } : {}),
    ...(body.metadata !== undefined
      ? { metadata: { ...session.metadata, ...asObject(body.metadata) } }
      : {}),
    updatedAt: now
  };

  await ctx.stores.session.set(updated.id, updated, "any");

  return jsonResponse(200, {
    // Surface the bare session id, not the namespaced storage key (FIX-682).
    session: { ...updated, id: route.sessionId }
  });
}

export async function handleListSessionRequests(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "list_session_requests" }>,
  ctx: SessionRouteContext
): Promise<Response> {
  const session = await loadTenantSession(
    ctx.stores.session,
    route.sessionId,
    ctx.tenantId
  );
  if (session === undefined) {
    return jsonResponse(404, {
      error: `Unknown session "${route.sessionId}"`
    });
  }
  const unattributed = refuseUnattributedRecord(ctx.registry, session);
  if (unattributed !== undefined) return unattributed;

  const url = new URL(request.url);
  // Summary listing omits full item logs by default (FIX-685). Inspection
  // surfaces (the DevTool) opt in with `include_items=true` to back-fill the
  // item tree for requests that completed before the view was opened (FIX-733).
  const includeItems = getBooleanFlag(url.searchParams.get("include_items"));
  const requests = await ctx.stores.request.list({
    // Request records keep a bare sessionId; isolate by the tenant filter
    // (always present, possibly undefined) so history never crosses tenants.
    sessionId: route.sessionId,
    tenantId: ctx.tenantId,
    // Conjoin the *stored session's* flow kind (FIX-1046). Nothing binds a
    // request's flow kind to its session's — the adopt-an-existing-session
    // branch of `createExecutionContext` validates user, org and tenant, and
    // the engine defines no flow-kind binding error — while route
    // authorization picks its resolver from the **session's** flow kind. So a
    // request dispatched under a flow that authenticates, into a session
    // stored under one that does not, was served here in full (items
    // included) to a caller authorized only for the permissive flow.
    //
    // BP-030: this narrows an existing endpoint's results. A request whose
    // recorded flow kind differs from its session's no longer appears — which
    // is the point, and which no shipped writer produces on the ordinary path.
    // Taken from the loaded record, never from the caller (BP-031).
    flowKind: session.flowKind,
    // And the exact owner, when the session records one: a session's requests
    // are the runs its owning instance admitted. A legacy session without an
    // owner keeps the kind filter alone, as before.
    ...(session.flowId != null ? { flowId: session.flowId } : {}),
    status: getString(url.searchParams.get("status")) as
      | RequestStatus
      | undefined,
    limit: getPositiveInteger(url.searchParams.get("limit")),
    offset: getPositiveInteger(url.searchParams.get("offset")),
    withItems: includeItems
  });

  return jsonResponse(200, {
    requests
  });
}
