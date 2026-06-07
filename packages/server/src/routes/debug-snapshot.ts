/**
 * Privileged debug snapshot builder for the DevTool's Resources panel.
 *
 * Walks the flat `flow.resources` record by accessor name and groups entries
 * that share a config object identity (dual-registration). For each group it
 * emits one `DebugResourceEntry` containing the raw server-side state, a
 * client-view projection (the result of `config.client.data(state)`, wrapped
 * in `{ ok, ... }`), content metadata, and a snapshot of the resource's
 * `client.*` config so the panel can render projection badges.
 *
 * Bypasses `buildResourceSnapshot` and its `client.*` shaping by design —
 * production client semantics live elsewhere. Off-by-default at the route
 * gate (`debugEndpointsEnabled` / `FSDEV_DEBUG_ENDPOINTS=1`).
 */
import type {
  JsonObject,
  ResourceCollectionConfig,
  ResourceConfig
} from "@flow-state-dev/core/types";
import { getPatternPrefix, matchesPattern } from "@flow-state-dev/core/types";
import { hasClientProjection, resolveClientProjection } from "@flow-state-dev/core/helpers";
import {
  getPersistedData,
  isCollectionConfig,
  type ResolvedResourceScope,
  type ResourceFlowLike,
  type ResourcePersistenceContext
} from "../resources/internal";
import { resourceStorageKeys } from "../resources/storage-keys";
import { resolveSessionStorageKey } from "../stores/scope-keys";
import { isJsonObject } from "../utils/json-helpers";
import { extractBareTopic, isResourceConfig } from "./route-utils";

/**
 * Per-entry projection result. `null` means "not applicable" (e.g. no state
 * persisted yet, or a content-only resource with no projection function).
 */
export type ClientView =
  | { ok: true; value: unknown }
  | {
      ok: false;
      reason: "no_client_data" | "state_read_false" | "threw";
      error?: string;
    }
  | null;

/** A snapshot of the `client.*` config the panel renders next to each entry. */
export interface DebugResourceClientConfig {
  hasClient: boolean;
  data: boolean;
  stateRead: boolean;
  contentRead: boolean;
  prefetchWindow: number | null;
}

/**
 * One row in the debug tree. Dual-registered aliases collapse into one
 * entry; `aliases` carries every accessor name pointing at the same config.
 */
export interface DebugResourceEntry {
  definitionId: string;
  aliases: string[];
  primaryName: string;
  scope: ResolvedResourceScope;
  isCollection: boolean;
  // Single resource fields:
  state?: JsonObject | null;
  clientView?: ClientView;
  hasContent?: boolean;
  contentByteLength?: number;
  contentType?: string;
  contentVisibleToClient?: boolean;
  // Collection fields:
  collectionPattern?: string;
  itemCount?: number;
  itemCountTruncated?: boolean;
  storagePrefix?: string;
  clientConfig: DebugResourceClientConfig;
}

export interface DebugResourcesResponse {
  sessionId: string;
  flowKind: string;
  generatedAt: string;
  resources: DebugResourceEntry[];
}

/**
 * Compute the client-view projection for a single resource state. Wraps the
 * author's `client.data` in try/catch since it can throw. Returns `null` when
 * the entry has no state to project.
 */
export function computeClientView(
  config: ResourceConfig | ResourceCollectionConfig,
  state: JsonObject | null | undefined
): ClientView {
  if (state === undefined || state === null) return null;
  if (!config.client) return { ok: false, reason: "no_client_data" };
  // Collections gate state visibility through `client.state.read`. Single
  // resources have no such gate — the projection itself is the opt-in.
  if (isCollectionConfig(config) && config.client.state?.read !== true) {
    return { ok: false, reason: "state_read_false" };
  }
  if (!hasClientProjection(config.client)) {
    return { ok: false, reason: "no_client_data" };
  }
  try {
    const value = resolveClientProjection(config.client, state);
    if (value instanceof Promise) {
      // Author-supplied async `data` functions are uncommon but not forbidden.
      // The debug snapshot is synchronous-only; surface as "threw" so the
      // panel renders the same explanatory chip as a real exception.
      throw new Error(
        "client.data returned a Promise; async projection not supported in debug snapshot"
      );
    }
    return { ok: true, value };
  } catch (e) {
    return {
      ok: false,
      reason: "threw",
      error: e instanceof Error ? e.message : String(e)
    };
  }
}

/** Describe `client.*` for the panel; null `prefetchWindow` means "not declared". */
function describeClientConfig(
  config: ResourceConfig | ResourceCollectionConfig
): DebugResourceClientConfig {
  const client = config.client;
  const hasClient = client !== undefined;
  const data = hasClientProjection(client);
  const contentRead = client?.content?.read === true;
  if (isCollectionConfig(config)) {
    return {
      hasClient,
      data,
      stateRead: config.client?.state?.read === true,
      contentRead,
      prefetchWindow:
        typeof config.prefetchWindow === "number" ? config.prefetchWindow : null
    };
  }
  return {
    hasClient,
    data,
    stateRead: hasClient,
    contentRead,
    prefetchWindow: null
  };
}

interface ResourceGroup {
  config: ResourceConfig | ResourceCollectionConfig;
  aliases: string[];
  scope: ResolvedResourceScope;
  /** Canonical persisted storage key for this group (FIX-591). */
  storageKey: string;
}

/**
 * Group `flow.resources` entries by config object identity. Two accessor names
 * pointing at the same DefinedResource collapse into one group; the order of
 * aliases preserves declaration order so `aliases[0]` is the first-encountered
 * name (the panel's primary label).
 */
function groupResources(flow: ResourceFlowLike): ResourceGroup[] {
  const resources = flow.resources;
  if (
    resources === undefined ||
    typeof resources !== "object" ||
    resources === null
  ) {
    return [];
  }
  const storageKeys = resourceStorageKeys(resources as Record<string, unknown>);
  const groups = new Map<unknown, ResourceGroup>();
  const order: unknown[] = [];
  for (const [name, maybeConfig] of Object.entries(
    resources as Record<string, unknown>
  )) {
    if (!isResourceConfig(maybeConfig) && !isCollectionConfig(maybeConfig)) {
      continue;
    }
    const config = maybeConfig as ResourceConfig | ResourceCollectionConfig;
    const scope = (config as { scope?: string }).scope;
    if (scope !== "session" && scope !== "user" && scope !== "org") continue;
    const existing = groups.get(config);
    if (existing) {
      existing.aliases.push(name);
    } else {
      const group: ResourceGroup = {
        config,
        aliases: [name],
        scope,
        storageKey: storageKeys[name] ?? name
      };
      groups.set(config, group);
      order.push(config);
    }
  }
  return order.map((key) => groups.get(key)!);
}

/**
 * Count keys in the persisted map that match a collection pattern, up to
 * `limit + 1` so the caller can detect truncation without enumerating the
 * full set on org/flow-scope collections.
 */
function countMatchingKeys(
  persisted: Record<string, JsonObject>,
  pattern: string,
  limit: number
): { count: number; truncated: boolean } {
  let count = 0;
  for (const key of Object.keys(persisted)) {
    if (!matchesPattern(pattern, key)) continue;
    count++;
    if (count > limit) {
      return { count: limit, truncated: true };
    }
  }
  return { count, truncated: false };
}

/**
 * Cheap content-type heuristic. The text-only ContentStore does not record a
 * MIME type, so we use the resource's contentType config when present and
 * fall back to `text/plain` otherwise. Refined further by per-content
 * sniffing in the future if needed.
 */
function deriveContentType(
  config: ResourceConfig | ResourceCollectionConfig
): string {
  const declared = (config as { contentType?: unknown }).contentType;
  if (typeof declared === "string" && declared.length > 0) return declared;
  return "text/plain";
}

/** Display-friendly storage prefix (e.g. "memos/" for "memos/[topic]"). */
function deriveStoragePrefix(pattern: string): string {
  const prefix = getPatternPrefix(pattern);
  return prefix.length === 0 ? "" : `${prefix}/`;
}

/**
 * Build the debug snapshot tree for a session. Returns `null` if the session
 * does not exist or the flow is not registered; callers translate that into
 * the appropriate 404 response.
 */
export async function buildDebugResourceTree(opts: {
  sessionId: string;
  ctx: ResourcePersistenceContext;
  countLimit: number;
  /** Tenant id for namespacing the session lookup (FIX-682). */
  tenantId?: string;
}): Promise<DebugResourcesResponse | null> {
  const { sessionId, ctx, countLimit, tenantId } = opts;
  const session = await ctx.stores.session.get(
    resolveSessionStorageKey(sessionId, tenantId)
  );
  if (!session) return null;
  const flow = ctx.registry.get(session.flowKind);
  if (!flow) return null;

  const groups = groupResources(flow as ResourceFlowLike);

  // Pre-warm distinct scopes in parallel — each scope hits a different store
  // (session/user/org), so the three round trips can overlap.
  const distinctScopes = Array.from(new Set(groups.map((g) => g.scope)));
  const persistedCache = new Map<
    ResolvedResourceScope,
    { resources: Record<string, JsonObject>; content: Record<string, string> } | null
  >();
  await Promise.all(
    distinctScopes.map(async (scope) => {
      const data = await getPersistedData(
        ctx,
        flow as ResourceFlowLike,
        sessionId,
        scope,
        tenantId
      );
      persistedCache.set(scope, data ?? null);
    })
  );

  const entries: DebugResourceEntry[] = [];
  let counter = 0;
  for (const group of groups) {
    counter++;
    const definitionId = `dr_${counter}`;
    const persisted = persistedCache.get(group.scope) ?? null;
    const clientConfig = describeClientConfig(group.config);
    const primaryName = group.aliases[0]!;

    if (isCollectionConfig(group.config)) {
      const pattern = group.config.pattern;
      if (persisted === null) {
        entries.push({
          definitionId,
          aliases: group.aliases,
          primaryName,
          scope: group.scope,
          isCollection: true,
          collectionPattern: pattern,
          itemCount: 0,
          itemCountTruncated: false,
          storagePrefix: deriveStoragePrefix(pattern),
          clientConfig
        });
        continue;
      }
      const { count, truncated } = countMatchingKeys(
        persisted.resources,
        pattern,
        countLimit
      );
      entries.push({
        definitionId,
        aliases: group.aliases,
        primaryName,
        scope: group.scope,
        isCollection: true,
        collectionPattern: pattern,
        itemCount: count,
        itemCountTruncated: truncated,
        storagePrefix: deriveStoragePrefix(pattern),
        clientConfig
      });
      continue;
    }

    // Single resource. Dual-registered aliases share one persisted slot at
    // the group's canonical storage key (FIX-591).
    const rawState = persisted ? persisted.resources[group.storageKey] : undefined;
    const state: JsonObject | null = isJsonObject(rawState)
      ? (rawState as JsonObject)
      : null;
    const rawContent = persisted ? persisted.content[group.storageKey] : undefined;
    const hasContent = typeof rawContent === "string";
    entries.push({
      definitionId,
      aliases: group.aliases,
      primaryName,
      scope: group.scope,
      isCollection: false,
      state,
      clientView: computeClientView(group.config, state),
      hasContent,
      contentByteLength: hasContent
        ? Buffer.byteLength(rawContent!, "utf-8")
        : undefined,
      contentType: hasContent ? deriveContentType(group.config) : undefined,
      contentVisibleToClient: clientConfig.contentRead,
      clientConfig
    });
  }

  return {
    sessionId,
    flowKind: session.flowKind,
    generatedAt: new Date().toISOString(),
    resources: entries
  };
}

/**
 * One item in a collection's paginated debug listing.
 */
export interface DebugCollectionItem {
  topic: string;
  storageKey: string;
  state: JsonObject | null;
  clientView: ClientView;
  hasContent: boolean;
  contentByteLength?: number;
  contentType?: string;
  contentVisibleToClient: boolean;
}

export interface DebugCollectionItemsResponse {
  items: DebugCollectionItem[];
  nextCursor: string | null;
}

/** Outcome of `buildDebugCollectionItems` — distinguishes 404 vs 400. */
export type BuildItemsResult =
  | { ok: true; data: DebugCollectionItemsResponse }
  | {
      ok: false;
      kind: "session_not_found" | "resource_not_found" | "not_collection" | "bad_request";
      detail?: string;
    };

const MAX_PAGE_LIMIT = 500;
const DEFAULT_PAGE_LIMIT = 50;

/**
 * Build a paginated debug listing of a collection's items. Topic filter is a
 * case-sensitive substring match on the bare topic. Pagination uses an opaque
 * base64 cursor encoding the last-yielded storage key in sorted order.
 */
export async function buildDebugCollectionItems(opts: {
  sessionId: string;
  ref: string;
  limit: number | null;
  cursor: string | null;
  topicFilter: string | null;
  ctx: ResourcePersistenceContext;
  /** Tenant id for namespacing the session lookup (FIX-682). */
  tenantId?: string;
}): Promise<BuildItemsResult> {
  const { sessionId, ref, ctx, tenantId } = opts;
  const limit = clampLimit(opts.limit);
  if (limit === null) {
    return { ok: false, kind: "bad_request", detail: "invalid_limit" };
  }
  const after = decodeCursor(opts.cursor);
  if (after === undefined) {
    return { ok: false, kind: "bad_request", detail: "invalid_cursor" };
  }

  const session = await ctx.stores.session.get(
    resolveSessionStorageKey(sessionId, tenantId)
  );
  if (!session) return { ok: false, kind: "session_not_found" };
  const flow = ctx.registry.get(session.flowKind);
  if (!flow) return { ok: false, kind: "session_not_found" };

  // Locate the requested config via grouping so dual-registered aliases
  // resolve to the same collection regardless of which name was used.
  const groups = groupResources(flow as ResourceFlowLike);
  const group = groups.find((g) => g.aliases.includes(ref));
  if (!group) return { ok: false, kind: "resource_not_found" };
  if (!isCollectionConfig(group.config)) {
    return { ok: false, kind: "not_collection" };
  }
  const config = group.config;
  const pattern = config.pattern;

  const persisted = await getPersistedData(
    ctx,
    flow as ResourceFlowLike,
    sessionId,
    group.scope,
    tenantId
  );
  if (!persisted) {
    return {
      ok: true,
      data: { items: [], nextCursor: null }
    };
  }

  const allKeys = Object.keys(persisted.resources)
    .filter((k) => matchesPattern(pattern, k))
    .sort();
  const startIdx =
    after === null ? 0 : findCursorIndex(allKeys, after);
  const filter = opts.topicFilter ?? "";
  const items: DebugCollectionItem[] = [];
  let scanned = startIdx;
  for (; scanned < allKeys.length && items.length < limit; scanned++) {
    const storageKey = allKeys[scanned]!;
    const topic = extractBareTopic(pattern, storageKey);
    if (filter.length > 0 && !topic.includes(filter)) continue;
    const rawState = persisted.resources[storageKey];
    const state: JsonObject | null = isJsonObject(rawState)
      ? (rawState as JsonObject)
      : null;
    const rawContent = persisted.content[storageKey];
    const hasContent = typeof rawContent === "string";
    items.push({
      topic,
      storageKey,
      state,
      clientView: computeClientView(config, state),
      hasContent,
      contentByteLength: hasContent
        ? Buffer.byteLength(rawContent!, "utf-8")
        : undefined,
      contentType: hasContent ? deriveContentType(config) : undefined,
      contentVisibleToClient: config.client?.content?.read === true
    });
  }

  const nextCursor =
    scanned < allKeys.length ? encodeCursor(allKeys[scanned - 1]!) : null;
  return { ok: true, data: { items, nextCursor } };
}

function clampLimit(raw: number | null): number | null {
  if (raw === null) return DEFAULT_PAGE_LIMIT;
  if (!Number.isFinite(raw) || raw <= 0 || raw > MAX_PAGE_LIMIT) return null;
  return Math.floor(raw);
}

function encodeCursor(storageKey: string): string {
  return Buffer.from(storageKey, "utf-8").toString("base64url");
}

// Strict base64url alphabet, no padding (per RFC 4648 §5).
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Decode a pagination cursor. Returns `null` for an absent cursor (start of
 * list), a decoded string for a valid cursor, and `undefined` when the cursor
 * is malformed (handler returns 400). We validate the input charset up front
 * because Node's `Buffer.from(_, "base64url")` is lenient — it silently
 * ignores invalid characters rather than throwing, so try/catch is not enough
 * to enforce a well-formed cursor.
 */
function decodeCursor(raw: string | null): string | null | undefined {
  if (raw === null) return null;
  if (raw.length === 0 || !BASE64URL_RE.test(raw)) return undefined;
  return Buffer.from(raw, "base64url").toString("utf-8");
}

/**
 * Resume index after a cursor. Returns the index of the first key strictly
 * greater than the cursor key; uses linear scan since `allKeys` is already
 * sorted and bounded by `debugCountLimit` upstream.
 */
function findCursorIndex(allKeys: string[], cursor: string): number {
  for (let i = 0; i < allKeys.length; i++) {
    if (allKeys[i]! > cursor) return i;
  }
  return allKeys.length;
}

/** Result returned by `lookupDebugContent`. */
export type DebugContentResult =
  | { ok: true; body: string; contentType: string }
  | {
      ok: false;
      kind:
        | "session_not_found"
        | "resource_not_found"
        | "not_collection"
        | "is_collection"
        | "content_not_found";
    };

/**
 * Locate a content blob for a single resource (when `topic` is null) or for
 * one item of a collection. Bypasses `client.content.read` since this is the
 * debug surface. Returns a typed failure when the session, ref, or content
 * cannot be resolved.
 */
export async function lookupDebugContent(opts: {
  sessionId: string;
  ref: string;
  topic: string | null;
  ctx: ResourcePersistenceContext;
  /** Tenant id for namespacing the session lookup (FIX-682). */
  tenantId?: string;
}): Promise<DebugContentResult> {
  const { sessionId, ref, topic, ctx, tenantId } = opts;
  const session = await ctx.stores.session.get(
    resolveSessionStorageKey(sessionId, tenantId)
  );
  if (!session) return { ok: false, kind: "session_not_found" };
  const flow = ctx.registry.get(session.flowKind);
  if (!flow) return { ok: false, kind: "session_not_found" };

  const groups = groupResources(flow as ResourceFlowLike);
  const group = groups.find((g) => g.aliases.includes(ref));
  if (!group) return { ok: false, kind: "resource_not_found" };
  const isColl = isCollectionConfig(group.config);
  if (topic === null && isColl) return { ok: false, kind: "is_collection" };
  if (topic !== null && !isColl) return { ok: false, kind: "not_collection" };

  const persisted = await getPersistedData(
    ctx,
    flow as ResourceFlowLike,
    sessionId,
    group.scope,
    tenantId
  );
  if (!persisted) return { ok: false, kind: "content_not_found" };

  // For collections the storage key is pattern-derived. For single resources
  // dual-registered aliases share one slot at the group's canonical storage
  // key (FIX-591).
  if (topic !== null) {
    const storageKey = joinPatternTopic(
      (group.config as ResourceCollectionConfig).pattern,
      topic
    );
    const body = persisted.content[storageKey];
    if (typeof body !== "string") return { ok: false, kind: "content_not_found" };
    return { ok: true, body, contentType: deriveContentType(group.config) };
  }
  const body = persisted.content[group.storageKey];
  if (typeof body === "string") {
    return { ok: true, body, contentType: deriveContentType(group.config) };
  }
  return { ok: false, kind: "content_not_found" };
}

/** Compose a full collection storage key from pattern prefix + bare topic. */
function joinPatternTopic(pattern: string, topic: string): string {
  const prefix = getPatternPrefix(pattern);
  return prefix.length === 0 ? topic : `${prefix}/${topic}`;
}
