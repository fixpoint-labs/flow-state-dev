// FIX-2624.
/**
 * Routes for user and org resources with no session: a direct read by scope
 * and key, a write sent through the flow the resource's `runBy` names, and the
 * identity read of one flow.
 *
 * Each resolves the caller in its handler, through `resolveFlowCaller`
 * (`scope-address.ts`) at the flow whose rules apply, so route-auth classifies
 * them `exempt`, as it does the action route: every declaring flow for a read
 * or a default write (each must sign the caller in, and one's pin admit them,
 * before anything but an unused key's answer is given), the writer for a send
 * to `runBy: { flow }`, as a direct POST to it would, and the path's flow for
 * the identity read. None reads the user or org from the body, the query or a
 * header, except the open mode's development resolver, which takes the
 * request's `userId` as every route does in that mode.
 *
 * A direct read runs no block and touches no session: it is a store read and
 * the client projection. A send derives the writer's session on the server and
 * hands the action route a request it would have taken from a client, with the
 * caller already resolved.
 */
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import type { InboundTransportHost, PrincipalResolver } from "../transports/types";
import { unknownFlowMessage } from "../context/instance-pin";
import type { JsonObject, ProjectedResourceCollectionConfig } from "@flow-state-dev/core/types";
import { searchProjectedRecords } from "@flow-state-dev/core/types";
import { getString, jsonResponse, parseJsonBody, extractTenantId, extractBareTopic } from "./route-utils";
import type { ParsedFlowRoute } from "./parseFlowRoute";
import {
  admitAddress,
  entryStorageKey,
  flowDeclares,
  isAddressScope,
  projectForClient,
  readAddressed,
  readEntries,
  readEntry,
  resolveFlowCaller,
  unknownRefusal
} from "../resources/scope-address";
import { ownerKeyAdmits } from "../resources/owner-private";
import { applyClientData } from "./resource-routes";
import {
  buildProjectedResourceContextFromSession,
  isProjectedResourceCollection,
  readExternalCollectionState
} from "../resources/internal";
import { DEFAULT_WRITE_FLOW, writeSessionId } from "../resources/default-write-flow";

type ScopeRouteContext = {
  host: InboundTransportHost;
  registry: FlowRegistry;
  stores: StoreRegistry;
  hostResolver: PrincipalResolver;
};

function refusedResponse(refused: { status: number; code: string; message: string }): Response {
  return jsonResponse(refused.status, { error: refused.code, message: refused.message });
}

/**
 * GET /resources/:scope/:key
 * The caller's copy of a user or org resource, as the client sees it, and its
 * version (0: nothing stored yet, the value is the schema's default).
 */
export async function handleReadScopeResource(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "read_scope_resource" }>,
  ctx: ScopeRouteContext
): Promise<Response> {
  if (!isAddressScope(route.scope)) {
    return jsonResponse(400, { error: "invalid_scope", message: `Scope "${route.scope}" is not "user" or "org"` });
  }
  const admitted = await admitAddress({
    ...ctx,
    request,
    scope: route.scope,
    key: route.key,
    action: route.kind,
    claimedUserId: getString(new URL(request.url).searchParams.get("userId"))
  });
  if ("refused" in admitted) return refusedResponse(admitted.refused);
  const { address, caller } = admitted;
  if (address.collection) {
    return jsonResponse(400, {
      error: "collection",
      message: `"${route.key}" at ${route.scope} scope is a collection: read it by its entries (/resources/${route.scope}/:key/entries).`
    });
  }
  const { state, version } = await readAddressed(ctx.stores, address, caller);
  const value = await projectForClient(address, state);
  return jsonResponse(200, {
    scope: address.scope,
    key: address.key,
    // Absent when the session's snapshot carries no state for it either.
    ...(value !== undefined ? { value } : {}),
    version
  });
}

const ENTRY_LIST_DEFAULT_LIMIT = 50;
const ENTRY_LIST_MAX_LIMIT = 200;
/** A manifest page is a storage key and a version, so one page can name far more entries than a value page. */
const ENTRY_MANIFEST_MAX_LIMIT = 10_000;

/** A stored entry the list pages, before the client projection. */
type ListedEntry = { storageKey: string; state: JsonObject; version: number };

/** When the entry was sent, when its state carries a finite `at`. Undated entries page after every dated one. */
function sentAt(state: JsonObject): number | null {
  const at = state["at"];
  return typeof at === "number" && Number.isFinite(at) ? at : null;
}

/** Newest first: a later `at` first, undated entries after every dated one, storage key ascending to break a tie. */
function compareNewest(a: ListedEntry, b: ListedEntry): number {
  const left = sentAt(a.state);
  const right = sentAt(b.state);
  if (left !== null && right !== null && left !== right) return right - left;
  if (left !== null && right === null) return -1;
  if (left === null && right !== null) return 1;
  return a.storageKey < b.storageKey ? -1 : a.storageKey > b.storageKey ? 1 : 0;
}

/** The cursor of a newest-first page: the last entry's `at` (null when it has none) and its storage key. */
type NewestMark = { at: number | null; storageKey: string };

function parseNewestCursor(cursor: string): NewestMark | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(cursor);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || parsed.length !== 2 || typeof parsed[1] !== "string") return undefined;
  const at = parsed[0];
  if (at !== null && (typeof at !== "number" || !Number.isFinite(at))) return undefined;
  return { at, storageKey: parsed[1] };
}

/** Whether `entry` is strictly older than `mark` in {@link compareNewest} order. */
function afterNewest(entry: ListedEntry, mark: NewestMark): boolean {
  const at = sentAt(entry.state);
  if (mark.at !== null && at !== null) {
    if (at !== mark.at) return at < mark.at;
    return entry.storageKey > mark.storageKey;
  }
  if (mark.at !== null && at === null) return true;
  if (mark.at === null && at !== null) return false;
  return entry.storageKey > mark.storageKey;
}

/**
 * A version that moves when a projected entry's state moves. A projected
 * collection has no stored version (the value read reports 0), so the manifest
 * cannot tell a change from an unchanged row without one derived from the state.
 */
function contentVersion(state: JsonObject): number {
  const text = JSON.stringify(state);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const version = hash >>> 0;
  return version === 0 ? 1 : version;
}

/**
 * GET /resources/:scope/:key/entries?limit=&cursor=&topicPrefix=&manifest=&order=
 * GET /resources/:scope/:key/entries/:entry
 *
 * The caller's entries of a user or org collection, as the client sees them,
 * each with its version: one cursor-paged page (the cursor is the last storage
 * key returned), or one entry (`null` when absent, or not the caller's to
 * read). `manifest=1` returns each entry's storage key and version and no
 * value, and accepts a much larger page. `order=newest` pages by each entry's
 * `at`, newest first, and the cursor is that order's place. Gated by
 * `client.state.read`, as the session-addressed list is. A projected collection
 * reads through its app source, with a context built from the caller instead
 * of a session.
 */
export async function handleReadScopeEntries(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "list_scope_entries" | "read_scope_entry" }>,
  ctx: ScopeRouteContext & { tenantIdHeader?: string }
): Promise<Response> {
  if (!isAddressScope(route.scope)) {
    return jsonResponse(400, { error: "invalid_scope", message: `Scope "${route.scope}" is not "user" or "org"` });
  }
  const admitted = await admitAddress({
    ...ctx,
    request,
    scope: route.scope,
    key: route.key,
    action: route.kind,
    claimedUserId: getString(new URL(request.url).searchParams.get("userId"))
  });
  if ("refused" in admitted) return refusedResponse(admitted.refused);
  const { address, caller } = admitted;
  if (!address.collection) {
    return jsonResponse(400, { error: "not_a_collection", message: `"${route.key}" at ${route.scope} scope is not a collection` });
  }
  const config = address.config;
  if (config.client?.state?.read !== true) {
    return jsonResponse(403, { error: "not_readable", message: `State read not permitted for "${route.key}"` });
  }
  const shaped = async (storageKey: string, state: JsonObject, version: number) => ({
    topic: extractBareTopic(config.pattern, storageKey),
    storageKey,
    value: await applyClientData(config, state),
    version
  });
  const projected = isProjectedResourceCollection(config)
    ? buildProjectedResourceContextFromSession(
        // The tenant from the tenant header, as every route takes it (FIX-682), never the body.
        {
          userId: caller.userId,
          orgId: caller.orgId,
          tenantId: extractTenantId(request, ctx.tenantIdHeader),
          flowKind: address.flow.id
        },
        address.scope,
        "",
        request.signal
      )
    : undefined;

  if (route.kind === "read_scope_entry") {
    const storageKey = entryStorageKey(config, route.entry);
    if (storageKey === undefined) {
      return jsonResponse(400, { error: "invalid_entry", message: `Entry "${route.entry}" does not match "${config.pattern}"` });
    }
    if (projected !== undefined) {
      if (!ownerKeyAdmits(config, storageKey, caller.userId)) return jsonResponse(200, null);
      const state = await readExternalCollectionState(config, extractBareTopic(config.pattern, storageKey), projected);
      return jsonResponse(200, state === undefined ? null : await shaped(storageKey, state, contentVersion(state)));
    }
    const found = await readEntry(ctx.stores, address, caller, storageKey);
    return jsonResponse(200, found === undefined ? null : await shaped(storageKey, found.state, found.version));
  }

  const url = new URL(request.url);
  const manifest = url.searchParams.get("manifest") === "1";
  const order = url.searchParams.get("order");
  if (order !== null && order !== "newest") {
    return jsonResponse(400, { error: "invalid_order", message: `order must be "newest"` });
  }
  if (order === "newest" && (manifest || projected !== undefined)) {
    return jsonResponse(400, {
      error: "invalid_order",
      message: manifest
        ? "A manifest is paged in storage-key order."
        : "A projected collection is paged by its source, not by newest."
    });
  }
  const maxLimit = manifest ? ENTRY_MANIFEST_MAX_LIMIT : ENTRY_LIST_MAX_LIMIT;
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam !== null ? Number.parseInt(limitParam, 10) : ENTRY_LIST_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    return jsonResponse(400, { error: "invalid_limit", message: `limit must be 1–${maxLimit}` });
  }
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const topicPrefix = url.searchParams.get("topicPrefix") ?? undefined;
  if (projected !== undefined) {
    const { hits, nextCursor } = await searchProjectedRecords(
      config as unknown as ProjectedResourceCollectionConfig,
      { limit, ...(cursor !== undefined ? { cursor } : {}), ...(topicPrefix !== undefined ? { prefix: topicPrefix } : {}) },
      projected
    );
    const admittedHits = hits.filter((hit) => ownerKeyAdmits(config, hit.storageKey, caller.userId));
    const items = manifest
      ? admittedHits.map((hit) => ({ storageKey: hit.storageKey, version: contentVersion(hit.state as JsonObject) }))
      : await Promise.all(admittedHits.map((hit) => shaped(hit.storageKey, hit.state as JsonObject, contentVersion(hit.state as JsonObject))));
    return jsonResponse(200, { items, ...(nextCursor !== undefined ? { nextCursor } : {}) });
  }
  const matched = (await readEntries(ctx.stores, address, caller)).filter(
    (found) => topicPrefix === undefined || found.storageKey.startsWith(topicPrefix)
  );
  let after: ListedEntry[];
  let nextCursor: string | undefined;
  if (order === "newest") {
    const mark = cursor === undefined ? undefined : parseNewestCursor(cursor);
    if (cursor !== undefined && mark === undefined) {
      return jsonResponse(400, { error: "invalid_cursor", message: "cursor is not a newest-page cursor" });
    }
    const ordered = [...matched].sort(compareNewest);
    after = mark === undefined ? ordered : ordered.filter((found) => afterNewest(found, mark));
    const page = after.slice(0, limit);
    const last = page[page.length - 1];
    nextCursor = after.length > limit && last !== undefined ? JSON.stringify([sentAt(last.state), last.storageKey]) : undefined;
    const items = await Promise.all(page.map((found) => shaped(found.storageKey, found.state, found.version)));
    return jsonResponse(200, { items, ...(nextCursor !== undefined ? { nextCursor } : {}) });
  }
  after = matched.filter((found) => cursor === undefined || found.storageKey > cursor);
  const page = after.slice(0, limit);
  nextCursor = after.length > limit ? page[page.length - 1]!.storageKey : undefined;
  const items = manifest
    ? page.map((found) => ({ storageKey: found.storageKey, version: found.version }))
    : await Promise.all(page.map((found) => shaped(found.storageKey, found.state, found.version)));
  return jsonResponse(200, { items, ...(nextCursor !== undefined ? { nextCursor } : {}) });
}

/**
 * GET /:flowKind/identity
 * The user and org the server acts as under this flow's sign-in.
 */
export async function handleFlowIdentity(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "flow_identity" }>,
  ctx: ScopeRouteContext
): Promise<Response> {
  const flow = ctx.registry.get(route.flowKind);
  if (flow === undefined || flow.id === DEFAULT_WRITE_FLOW) {
    return jsonResponse(404, { error: unknownFlowMessage(route.flowKind) });
  }
  const principal = await resolveFlowCaller({
    ...ctx,
    request,
    flow,
    action: route.kind,
    claimedUserId: getString(new URL(request.url).searchParams.get("userId"))
  });
  if ("refused" in principal) {
    return principal.refused.code === "outside_pin"
      ? jsonResponse(404, { error: unknownFlowMessage(route.flowKind) })
      : jsonResponse(principal.refused.status, { error: "unauthenticated", message: principal.refused.message });
  }
  return jsonResponse(200, { userId: principal.userId, orgId: principal.orgId });
}

/** What the action route needs to run a resource send. */
export type ResourceSend = {
  /** The writing flow's instance id. */
  flowKind: string;
  /** The writer's session, derived on the server. */
  sessionId: string;
  /** The caller, resolved through the declaring flow. */
  principal: { userId: string; orgId: string };
};

/**
 * Resolve a send addressed to a resource (`POST /resources/:scope/:key/actions/:action`)
 * to the flow that writes it, its caller and the caller's write session. A
 * resource with no `runBy` is refused: a client can't write it.
 */
export async function resolveResourceSend(
  request: Request,
  route: Extract<ParsedFlowRoute, { kind: "send_resource" }>,
  ctx: ScopeRouteContext & { tenantIdHeader?: string }
): Promise<ResourceSend | Response> {
  if (!isAddressScope(route.scope)) {
    return jsonResponse(400, { error: "invalid_scope", message: `Scope "${route.scope}" is not "user" or "org"` });
  }
  // The open mode's development resolver takes the body's userId, as the action route does.
  const claimedUserId = getString((await parseJsonBody(request.clone())).userId);
  // Nothing about the resource is said until the caller passes every declaring flow.
  const admitted = await admitAddress({ ...ctx, request, scope: route.scope, key: route.key, action: route.actionName, claimedUserId });
  if ("refused" in admitted) return refusedResponse(admitted.refused);
  const { address } = admitted;
  const runBy = address.config.runBy;
  if (runBy === undefined) {
    return jsonResponse(403, {
      error: "not_writable",
      message:
        `Resource "${route.key}" at ${route.scope} scope sets no runBy, so a client can't write it. ` +
        `Server flows still write it from inside their actions.`
    });
  }
  let writer: string;
  let caller = admitted.caller;
  if (runBy === "default") {
    // Held by every host from the start (`registerBuiltIn`); a hand-built registry may lack it.
    if (ctx.registry.get(DEFAULT_WRITE_FLOW) === undefined) {
      return jsonResponse(501, { error: "no_default_write_flow", message: "This host's registry holds no default write flow." });
    }
    writer = DEFAULT_WRITE_FLOW;
  } else {
    const flow = ctx.registry.get(runBy.flow);
    const declares = flow !== undefined && flowDeclares(ctx.registry, flow, address.scope, address.key);
    if (flow === undefined || !declares) {
      return jsonResponse(409, {
        error: "runby_flow_missing",
        message:
          `Resource "${route.key}" at ${route.scope} scope names runBy flow "${runBy.flow}", which is not registered ` +
          `here or does not declare it.`
      });
    }
    // The writer's action runs, so the writer's door decides who the caller is:
    // its resolver, requireUser and defaultUserId, as a direct POST to it would.
    const writerCaller = await resolveFlowCaller({ ...ctx, request, flow, action: route.actionName, claimedUserId });
    // Refused by the writer (its pin): the unused key's answer, naming no writer.
    if ("refused" in writerCaller) return refusedResponse(unknownRefusal(address.scope, address.key));
    writer = flow.id;
    caller = writerCaller;
  }
  const tenantId = extractTenantId(request, ctx.tenantIdHeader);
  return {
    flowKind: writer,
    sessionId: writeSessionId(
      // A default write records the declaring instance that admitted its caller.
      {
        scope: address.scope,
        key: address.key,
        writer,
        ...(writer === DEFAULT_WRITE_FLOW ? { admittedBy: address.flow.id } : {})
      },
      { userId: caller.userId, orgId: caller.orgId, tenantId }
    ),
    principal: caller
  };
}
