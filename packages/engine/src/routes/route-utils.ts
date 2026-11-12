/**
 * Shared utilities for route handlers: response builders, parsing, and validation helpers.
 */
import { isOrgAttributed, UnattributedOrgError, type OrgAttributedRecord } from "../context/org-attribution";
import type { JsonObject, ResourceConfig } from "@flow-state-dev/core/types";
import {
  extractBareTopic,
  isProjectedResourceCollection,
  matchesPattern,
  resolveCollectionKey,
} from "@flow-state-dev/core/types";
import { hasClientProjection, resolveClientData } from "@flow-state-dev/core/helpers";
import type { OutputItem, RequestStatusEvent, RequestStreamEvent } from "@flow-state-dev/core/items";
import type { RuntimeItem } from "@flow-state-dev/core/internal";
import { collapseToCanonicalLog, resolveItemVisibility } from "@flow-state-dev/core/items";
import { ValidationError, FlowError } from "../errors/flow-error";
import type { RequestActionResult, RequestRecord, SessionRecord, SessionStore } from "../stores/types";
import { terminalAtMs } from "../stores/request-ended-at";
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { FlowRegistry } from "../registry/flow-registry";
import { resolveRecordOwner, type OwnedRecord } from "../context/record-owner";
import { principalOwnsRequest } from "../context/request-principal";
import type { SessionCreateRefusedError } from "../context/session-birth";
import type { ResolvedPrincipal } from "../transports/types";
import { ownerKeyAdmits } from "../resources/owner-private";
import { isSameSession, resolveSessionStorageKey, tenantMatches } from "../stores/scope-keys";
import { isJsonObject } from "../utils/json-helpers";
import { isCollectionConfig } from "../resources/is-collection-config";
import { resourceStorageKeys } from "../resources/storage-keys";
import { normalizeResourceState } from "../resources/normalize-resource-state";
import { sortItemsChronologically } from "../utils/sort";
import { resolveRequestReplayCursor } from "../streaming/resume";

export const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8"
};

export const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache",
  connection: "keep-alive"
};

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
}

export function emptyResponse(status: number): Response {
  return new Response(null, { status });
}

// FIX-406 6D.
/** Default HTTP header carrying the tenant id. */
export const DEFAULT_TENANT_ID_HEADER = "x-tenant-id";

// FIX-682.
/**
 * Read the tenant id from the configurable HTTP header. Returns
 * `undefined` when the header is absent or empty — an empty header is treated
 * as single-tenant (bare keys), matching `resolveSessionStorageKey`. The
 * canonical extraction point so action dispatch and every session-touching
 * route namespace consistently.
 *
 * Rejects a tenant id containing `:` (400). The session storage key is
 * `${tenantId}:${sessionId}` and session ids legitimately contain `:`, so a
 * tenant id with a `:` would make the key ambiguous (tenant `a` + session
 * `b:c` collides with tenant `a:b` + session `c`). Tenant ids are
 * deployment-controlled, so this is a cheap config guard that removes the
 * ambiguity class outright — the binding check still prevents any data leak.
 */
export function extractTenantId(
  request: Request,
  tenantIdHeader?: string
): string | undefined {
  const value = request.headers.get(tenantIdHeader ?? DEFAULT_TENANT_ID_HEADER);
  if (value === null || value.length === 0) return undefined;
  if (value.includes(":")) {
    throw new ValidationError(
      `Tenant id must not contain ":" (received "${value}"). The session storage key reserves ":" as a separator.`
    );
  }
  return value;
}

// FIX-682.
/**
 * Load a session for the calling tenant, returning `undefined` unless the
 * stored record's tenant matches the request's. The
 * `${tenantId}:${sessionId}` storage key is ambiguous when the caller controls
 * `sessionId` — omitting the header while passing `sessionId =
 * "${otherTenant}:${id}"` collides on another tenant's key. Verifying the
 * stored `tenantId` closes that bypass; callers treat `undefined` as
 * not-found, so a cross-tenant probe gets a 404, never another tenant's data.
 */
export async function loadTenantSession(
  store: SessionStore,
  sessionId: string,
  tenantId: string | undefined
): Promise<SessionRecord | undefined> {
  const record = await store.get(resolveSessionStorageKey(sessionId, tenantId));
  if (record === undefined) return undefined;
  if (!tenantMatches(record.tenantId, tenantId)) return undefined;
  return record;
}

/**
 * What a session route answers for a session the caller cannot see: one no
 * one has created, and one another user owns. The same status and the same
 * words for both, so the answer says nothing about whether the id is in use
 * or whose it is. One copy, because the route guard (`route-auth.ts`), the
 * action route and every session handler's own missing-session branch must
 * agree character for character, or the difference is the oracle.
 */
export function unknownSessionResponse(sessionId: string): Response {
  return jsonResponse(404, { error: `Unknown session "${sessionId}"` });
}

/**
 * What the read route answers for a file the caller can't read: one gone, one
 * no session owns yet, and one in a session someone else owns, alike. It
 * names neither the file's session nor its owner.
 */
export function unknownBlobResponse(): Response {
  return jsonResponse(404, { error: "attachment_not_found" });
}

/**
 * What a route answers for a session create the flow refused: the status the
 * refusal carries, its message, and the state field when one was the reason.
 * One copy for the create, action and webhook routes, so a caller sees the
 * same refusal whichever way it tried to create the session.
 */
export function sessionCreateRefusedResponse(error: SessionCreateRefusedError): Response {
  return jsonResponse(error.status, {
    error: error.message,
    ...(error.field !== undefined ? { field: error.field } : {})
  });
}

/**
 * What a request route answers for a request the caller cannot reach: one no
 * one has created, one another user or tenant owns, and one the caller owns
 * but may not re-enter from HTTP. The same status and words for each, for the
 * reason `unknownSessionResponse` gives: a request id comes back in the
 * `x-request-id` header and travels in URLs, so any difference between these
 * answers tells a caller holding someone else's id that it is in use.
 */
export function unknownRequestResponse(requestId: string): Response {
  return jsonResponse(404, { error: `Request "${requestId}" not found` });
}

/**
 * What the request stream answers for an id with no request and no events
 * behind it, and (from the route guard) for a request the caller may not
 * read, so the two cannot be told apart. An unknown flow is named first, as
 * the handler names it. Otherwise: without a resume cursor, a 404; with one,
 * an empty 200, because a resuming client that already consumed the whole
 * log is owed "nothing new" rather than a spurious 404.
 */
export function unknownRequestStreamResponse(
  request: Request,
  route: { flowKind: string; requestId: string },
  registry: Pick<FlowRegistry, "get">
): Response {
  if (registry.get(route.flowKind) === undefined) {
    return jsonResponse(404, {
      error: `Unknown flow "${route.flowKind}"`
    });
  }
  const cursor = resolveRequestReplayCursor({
    requestId: route.requestId,
    lastEventId: request.headers.get("last-event-id"),
    startingAfter: new URL(request.url).searchParams.get("starting_after")
  });
  if (cursor.sequenceNumber === undefined) {
    return jsonResponse(404, {
      error: `Unknown request "${route.requestId}"`
    });
  }
  return new Response("", { status: 200, headers: SSE_HEADERS });
}

/**
 * Whether the caller may act on `record` through a request-control route
 * (retry, continue, resume, abort). With a principal, the record must be that
 * principal's in the caller's tenant (`principalOwnsRequest`: user, tenant,
 * and organization when the record carries one). Without one, nothing in the
 * app authenticates, so there is no user to compare and the tenant is the only
 * boundary.
 *
 * Another user's or another tenant's request is answered as a missing one
 * ({@link unknownRequestResponse}), and each handler asks this before any
 * check that could tell them apart: status, flow, session or source. The
 * request id is an address the caller may have learned from someone else's
 * response, and these routes would otherwise re-run, continue, resume or stop
 * that request under its owner's identity.
 *
 * The route guard (`route-auth.ts`) refuses another user's request before the
 * handler runs, with the same answer. This is the handler's own check, and the
 * only one of the two that compares the tenant.
 */
export function callerReachesRequest(
  record: Pick<RequestRecord, "userId" | "orgId" | "tenantId">,
  tenantId: string | undefined,
  principal: ResolvedPrincipal | undefined
): boolean {
  if (principal === undefined) return tenantMatches(record.tenantId, tenantId);
  return principalOwnsRequest(record, { userId: principal.userId, orgId: principal.orgId, tenantId });
}

/**
 * Whether `session`, a handler's own read of the session its route addresses,
 * is the session the owner check admitted the caller to
 * (`RouteAuthResult.session`). The check found none (`null`): then no session
 * is, since one that arrived after it was never checked. The check read
 * nothing (`undefined`, nothing in the app authenticates): then there is
 * nothing to compare, and any is.
 */
export function isCheckedSession(
  checked: SessionRecord | null | undefined,
  session: SessionRecord
): boolean {
  if (checked === undefined) return true;
  return checked !== null && isSameSession(checked, session);
}

/**
 * A session-addressed handler's own read of its session, for a route that
 * goes on to act under it: the session at `sessionId` in the caller's tenant
 * ({@link loadTenantSession}), provided it is the one the owner check admitted
 * the caller to ({@link isCheckedSession}). `undefined` when there is none, or
 * when the id changed hands between the check and this read, and the caller
 * answers both as an unknown session.
 *
 * @param checked The session the route guard checked (`RouteAuthResult.session`).
 */
export async function loadCheckedSession(
  store: SessionStore,
  sessionId: string,
  tenantId: string | undefined,
  checked: SessionRecord | null | undefined
): Promise<SessionRecord | undefined> {
  const session = await loadTenantSession(store, sessionId, tenantId);
  if (session === undefined || !isCheckedSession(checked, session)) return undefined;
  return session;
}

// `extractBareTopic` now lives in core alongside `getPatternPrefix` /
// `resolveCollectionKey` (its inverse). Re-exported here so existing route
// importers keep resolving it from this module.
export { extractBareTopic } from "@flow-state-dev/core/types";

export function asObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export function getString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function getPositiveInteger(value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }

  if (!/^\d+$/.test(value)) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed)) {
    return undefined;
  }

  return parsed;
}

export function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter((item): item is string => typeof item === "string");
}

export function getBooleanFlag(value: string | null): boolean {
  if (value === null) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

/** A stored action result as a read sends it: plus `hasOutput`, with `output` only when asked. */
export type ProjectedRequestResult = RequestActionResult & { hasOutput: boolean };

// FIX-1661.
/**
 * Project a request's stored action result for the wire. The
 * session request list and the status route send the same shape, so one
 * request reads the same in both: `hasOutput` says whether an output is
 * stored, and `output` is sent only when the caller asked for it.
 */
export function projectRequestResult(
  result: RequestActionResult,
  includeOutput: boolean
): ProjectedRequestResult {
  const hasOutput = Object.prototype.hasOwnProperty.call(result, "output");
  const { output: _output, ...summary } = result;
  return { ...(includeOutput ? result : summary), hasOutput };
}

export type ClientDataScope = "session" | "user" | "org";
export type ClientDataFilter = Partial<Record<ClientDataScope, Set<string>>>;

export function parseClientDataFilter(value: string | null): ClientDataFilter | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }

  const parsed: ClientDataFilter = {};
  const entries = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const entry of entries) {
    const [scopeCandidate, dataName] = entry.split(".", 2);
    const isScoped =
      scopeCandidate === "session" ||
      scopeCandidate === "user" ||
      scopeCandidate === "org";
    const scope: ClientDataScope = isScoped ? scopeCandidate : "session";
    const name = isScoped ? dataName : scopeCandidate;

    if (name === undefined || name.trim().length === 0) {
      continue;
    }

    if (parsed[scope] === undefined) {
      parsed[scope] = new Set<string>();
    }

    parsed[scope]!.add(name.trim());
  }

  if (Object.keys(parsed).length === 0) {
    return undefined;
  }

  return parsed;
}

export function shouldIncludeClientData(
  filter: ClientDataFilter | undefined,
  scope: ClientDataScope,
  name: string
): boolean {
  if (filter === undefined) {
    return true;
  }

  const values = filter[scope];
  if (values === undefined) {
    return false;
  }

  return values.has(name);
}

export function isResourceConfig(value: unknown): value is ResourceConfig {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { stateSchema?: { safeParse?: unknown } };
  return (
    typeof candidate.stateSchema === "object" &&
    candidate.stateSchema !== null &&
    typeof candidate.stateSchema.safeParse === "function"
  );
}

/**
 * Build the client-visible state object for a single scope: each `expose`
 * key copies `state[name]` verbatim. The query-param filter
 * (`?clientData=session.foo,user.bar`) picks which names are sent.
 */
export function computeClientData(options: {
  config: { expose?: ReadonlyArray<string> } | undefined;
  scope: ClientDataScope;
  filter: ClientDataFilter | undefined;
  state: JsonObject;
}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const name of options.config?.expose ?? []) {
    if (!shouldIncludeClientData(options.filter, options.scope, name)) continue;
    out[name] = (options.state as Record<string, unknown>)[name];
  }
  return out;
}

// FIX-579; FIX-427.
/**
 * Builds the client-visible `resources` snapshot for one scope.
 *
 * Collections: emit `count` always, plus a `prefetched` window when
 * the collection declares `prefetchWindow > 0`. Per-item `clientData` in the
 * window is included only when `client.state.read === true`.
 *
 * Single resources retain their existing shape (clientData + optional
 * prefetched content).
 *
 * Strictly client-shaped: resources without a `client` config are omitted.
 * The DevTool's previous `includeInternal` escape hatch was removed — use `/api/flows/sessions/:id/debug/resources*` for full
 * server-side inspection.
 */
export async function buildResourceSnapshot(options: {
  configs: Record<string, unknown> | undefined;
  persisted: Record<string, unknown> | undefined;
  persistedContent?: Record<string, string> | undefined;
  /**
   * The session's user. A collection's count and prefetch window hold only
   * the keys {@link ownerKeyAdmits} admits for this user; without one,
   * no row keyed to an owner.
   */
  userId?: string;
}): Promise<Record<string, unknown> | undefined> {
  const out: Record<string, unknown> = {};
  const contentMap = options.persistedContent ?? {};
  let hasAny = false;
  const storageKeys = resourceStorageKeys(options.configs);

  for (const [resourceName, maybeConfig] of Object.entries(options.configs ?? {})) {
    if (isCollectionConfig(maybeConfig)) {
      if (maybeConfig.client === undefined) continue;

      // FIX-858: projected collections are read-through — the snapshot does NOT
      // enumerate the app source (it holds only instances loaded this request,
      // typically none). Emit an empty anchor keyed on a serializable
      // `prefetched: []` — NOT `count: undefined`, which `JSON.stringify` drops
      // to `{}` and the client's `useResource` then misclassifies as a single
      // resource (it discriminates a collection by a present `count`/`prefetched`
      // key). `count` stays absent (honest unknown cardinality — never a false 0);
      // the client discovers instances via the list/search route + per-URI reads.
      if (isProjectedResourceCollection(maybeConfig)) {
        out[resourceName] = { prefetched: [] };
        hasAny = true;
        continue;
      }

      const pattern = maybeConfig.pattern;
      const persisted = options.persisted ?? {};
      const collectionClient = maybeConfig.client;
      const prefetchContent = maybeConfig.client?.content?.prefetch === true;
      const stateReadable = maybeConfig.client?.state?.read === true;
      const prefetchWindow = typeof maybeConfig.prefetchWindow === "number" && maybeConfig.prefetchWindow > 0
        ? maybeConfig.prefetchWindow
        : 0;

      const matchedKeys = Object.keys(persisted)
        .filter((k) => matchesPattern(pattern, k))
        .filter((k) => ownerKeyAdmits(maybeConfig, k, options.userId))
        .sort();
      const count = matchedKeys.length;

      const collectionEntry: Record<string, unknown> = { count };

      if (prefetchWindow > 0) {
        const window = matchedKeys.slice(0, prefetchWindow);
        const prefetched: Array<Record<string, unknown>> = [];
        for (const key of window) {
          const state = isJsonObject(persisted[key]) ? persisted[key] as JsonObject : {};
          const item: Record<string, unknown> = {
            topic: extractBareTopic(pattern, key),
            storageKey: key
          };
          if (stateReadable) {
            item.clientData = await resolveClientData(maybeConfig, state);
          }
          if (prefetchContent && contentMap[key] !== undefined) {
            item.content = contentMap[key];
          }
          prefetched.push(item);
        }
        collectionEntry.prefetched = prefetched;
      }

      out[resourceName] = collectionEntry;
      hasAny = true;
      continue;
    }

    if (!isResourceConfig(maybeConfig)) continue;
    const config = maybeConfig as ResourceConfig;
    if (config.client === undefined) continue;

    const storageKey = storageKeys[resourceName] ?? resourceName;
    const state = normalizeResourceState(config, options.persisted?.[storageKey]);
    const prefetch = config.client?.content?.prefetch === true;

    const entry: Record<string, unknown> = {};
    if (hasClientProjection(config.client)) {
      entry.clientData = await resolveClientData(config, state);
    }
    if (prefetch && contentMap[storageKey] !== undefined) {
      entry.content = contentMap[storageKey];
    }
    out[resourceName] = entry;
    hasAny = true;
  }

  return hasAny ? out : undefined;
}

// FIX-811.
/**
 * The items a session snapshot shows from one request's item log.
 *
 * The request's physical log is collapsed to its canonical view first:
 * a resumed request's suspending block re-emits its pre-suspension
 * items, and the superseded copies must not surface. Per request, because
 * logical ids are scoped by request id. Then either the caller's type filter
 * or, without one, client visibility decides what stays.
 *
 * The one filter behind both the session snapshot (`GET /sessions/:id/state`)
 * and the session stream (`GET /sessions/:id/stream`), so a live view and a
 * reload show the same set.
 *
 * @param items One request record's `items`, as the store returned them.
 * @param itemTypes The snapshot's `item_types` filter, when the caller passed one.
 * @returns The items a snapshot would show from that request, in log order.
 */
export function snapshotItemsOf(
  items: readonly RuntimeItem[] | undefined,
  itemTypes?: ReadonlySet<string>
): OutputItem[] {
  if (items === undefined) return [];
  // Visibility drops trace rows unless `itemTypes` names one.
  return collapseToCanonicalLog(items).filter((item) =>
    itemTypes !== undefined ? itemTypes.has(item.type) : resolveItemVisibility(item).client
  ) as OutputItem[];
}

export function sortItems(items: OutputItem[] | undefined): OutputItem[] {
  if (!Array.isArray(items)) {
    return [];
  }

  return sortItemsChronologically(items);
}

export function requestStatusEventType(status: RequestRecord["status"]): RequestStatusEvent["type"] {
  if (status === "completed") {
    return "request.completed";
  }

  if (status === "failed") {
    return "request.failed";
  }

  if (status === "incomplete") {
    return "request.incomplete";
  }

  return "request.in_progress";
}

export function buildReplayEvents(record: RequestRecord, session?: SessionRecord): RequestStreamEvent[] {
  const createdAt = record.startedAtMs ?? record.createdAt;
  const statusTs = terminalAtMs(record) ?? record.updatedAt ?? createdAt;

  const events: RequestStreamEvent[] = [
    {
      stream: "request",
      type: "request.created",
      requestId: record.id,
      sequence_number: 1,
      status: "in_progress",
      ts: createdAt
    }
  ];

  let seq = 2;
  if (record.items !== undefined) {
    // Seed from the canonical view (FIX-811): this empty-cursor fallback
    // reconstructs the stream from the items record, so it must drop a resumed
    // request's superseded run-1 emissions just like the GET history does. The
    // append-only event log (the primary replay source) is never collapsed.
    for (const runtimeItem of collapseToCanonicalLog(record.items)) {
      // Wire events name OutputItem; trace rows ride them.
      const item = runtimeItem as OutputItem;
      events.push({
        stream: "request",
        type: "item.added",
        requestId: record.id,
        sequence_number: seq++,
        ts: item.ts ?? createdAt,
        item
      });
      events.push({
        stream: "request",
        type: "item.done",
        requestId: record.id,
        sequence_number: seq++,
        ts: item.ts ?? createdAt,
        item
      });
    }
  }

  if (
    session !== undefined &&
    record.sessionId !== undefined &&
    (session.title !== undefined || session.description !== undefined || session.tags !== undefined)
  ) {
    events.push({
      stream: "request",
      type: "session.metadata.changed",
      requestId: record.id,
      sessionId: record.sessionId,
      sequence_number: seq++,
      ts: statusTs,
      ...(session.title !== undefined ? { title: session.title } : {}),
      ...(session.description !== undefined ? { description: session.description } : {}),
      ...(session.tags !== undefined ? { tags: session.tags } : {})
    });
  }

  events.push({
    stream: "request",
    type: requestStatusEventType(record.status),
    requestId: record.id,
    sequence_number: seq,
    status: record.status,
    ts: statusTs
  });

  return events;
}

export function errorStatus(error: Error): number {
  if (error instanceof ValidationError) {
    return 400;
  }

  if (error instanceof FlowError && error.code === "validation_error") {
    return 400;
  }

  return 500;
}

export async function parseJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.trim().length === 0) {
    return {};
  }

  const parsed = JSON.parse(text);
  const object = asObject(parsed);
  if (object === undefined) {
    throw new ValidationError("Request body must be a JSON object", {
      scope: "request"
    });
  }

  return object;
}

/**
 * The flow instance a stored session or request belongs to, for a route that
 * goes on to read that record's declarations — schemas, resources, resolver.
 * One outcome per refusal: an owner this process cannot resolve is the same
 * `404 Unknown flow` the route always returned for an unregistered kind, and
 * ambiguous legacy history is a `409 migration-required` so an operator sees
 * the cutover they owe rather than a missing flow. No route resolves a
 * record's flow by its stored kind on its own.
 */
export function resolveOwnerFlow(
  registry: Pick<FlowRegistry, "get" | "list">,
  record: OwnedRecord
): { flow: FlowInstance; denied?: undefined } | { flow?: undefined; denied: Response } {
  const owner = resolveRecordOwner(registry, record);
  if (owner.ok) return { flow: owner.flow };
  const refused = refuseUnattributedRecord(registry, record);
  if (refused !== undefined) return { denied: refused };
  return {
    denied: jsonResponse(404, { error: `Unknown flow "${record.flowId ?? record.flowKind}"` })
  };
}

// FIX-1442.
/**
 * The `409 migration-required` for a record this process cannot attribute, or
 * `undefined` for any record it can read.
 *
 * Two axes, one answer. A record is unattributed when its legacy history names
 * no single flow instance, OR when it names no organization.
 * Both are the same situation from an operator's worker: data that predates a
 * requirement, which the runtime preserves and refuses to serve rather than
 * guess about, and which one offline migration pass fixes. Giving them one
 * refusal is what makes "run the recipe until nothing 409s" a complete
 * instruction.
 *
 * For a route that needs nothing from the record's flow — a plain session read,
 * edit, delete or request listing — this is the one attribution check it owes:
 * an unattributed row is refused at every door, not only where a flow's
 * declarations are read (and, in an app where some flow authenticates, no such
 * row is served under a resolver that never governed it).
 */
export function refuseUnattributedRecord(
  registry: Pick<FlowRegistry, "get" | "list">,
  record: OwnedRecord & OrgAttributedRecord
): Response | undefined {
  const owner = resolveRecordOwner(registry, record);
  if (!owner.ok && owner.reason === "migration-required") {
    return jsonResponse(409, { error: "migration-required", message: owner.detail });
  }
  if (!isOrgAttributed(record)) {
    return jsonResponse(409, {
      error: "migration-required",
      message: new UnattributedOrgError("this route").message
    });
  }
  return undefined;
}
