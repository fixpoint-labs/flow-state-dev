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
import { matchesPattern } from "@flow-state-dev/core/types";
import { resolveClientProjection } from "@flow-state-dev/core/utils";
import {
  getPersistedData,
  isCollectionConfig,
  type ResolvedResourceScope,
  type ResourceFlowLike,
  type ResourcePersistenceContext
} from "../resources/internal";
import { isJsonObject } from "../utils/json-helpers";
import { isResourceConfig } from "./route-utils";

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
  if (isCollectionConfig(config)) {
    if (config.client.state?.read !== true) {
      return { ok: false, reason: "state_read_false" };
    }
  }
  const client = config.client;
  const hasProjection =
    typeof client.data === "function" ||
    Array.isArray(client.expose) ||
    Array.isArray(client.exclude);
  if (!hasProjection) return { ok: false, reason: "no_client_data" };
  try {
    const value = resolveClientProjection(client, state);
    if (value instanceof Promise) {
      // resolveClientProjection is synchronous in practice for the cases we
      // care about (expose/exclude/data over plain JsonObjects). Promise
      // returns are author-supplied async `data` functions — uncommon but
      // not forbidden. Surface as "threw" so the caller can resolve it.
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
  const isColl = isCollectionConfig(config);
  const stateRead = isColl
    ? (config as ResourceCollectionConfig).client?.state?.read === true
    : client !== undefined;
  return {
    hasClient: client !== undefined,
    data:
      typeof client?.data === "function" ||
      Array.isArray(client?.expose) ||
      Array.isArray(client?.exclude),
    stateRead,
    contentRead: client?.content?.read === true,
    prefetchWindow:
      isColl &&
      typeof (config as ResourceCollectionConfig).prefetchWindow === "number"
        ? (config as ResourceCollectionConfig).prefetchWindow!
        : null
  };
}

interface ResourceGroup {
  config: ResourceConfig | ResourceCollectionConfig;
  aliases: string[];
  scope: ResolvedResourceScope;
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
      const group: ResourceGroup = { config, aliases: [name], scope };
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

/** Storage prefix used by the panel to label a collection (display only). */
function deriveStoragePrefix(pattern: string): string {
  const idx = pattern.indexOf("[");
  const wildcard = pattern.indexOf("*");
  const cuts = [idx, wildcard].filter((n) => n >= 0);
  if (cuts.length === 0) return pattern;
  const cut = Math.min(...cuts);
  return pattern.slice(0, cut);
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
}): Promise<DebugResourcesResponse | null> {
  const { sessionId, ctx, countLimit } = opts;
  const session = await ctx.stores.session.get(sessionId);
  if (!session) return null;
  const flow = ctx.registry.get(session.flowKind);
  if (!flow) return null;

  const groups = groupResources(flow as ResourceFlowLike);

  // Lazy per-scope persisted data; loaded only when a group needs it.
  const persistedCache = new Map<
    ResolvedResourceScope,
    { resources: Record<string, JsonObject>; content: Record<string, string> } | null
  >();
  async function loadPersisted(scope: ResolvedResourceScope) {
    if (persistedCache.has(scope)) return persistedCache.get(scope) ?? null;
    const data = await getPersistedData(
      ctx,
      flow as ResourceFlowLike,
      sessionId,
      scope
    );
    persistedCache.set(scope, data ?? null);
    return data ?? null;
  }

  const entries: DebugResourceEntry[] = [];
  let counter = 0;
  for (const group of groups) {
    counter++;
    const definitionId = `dr_${counter}`;
    const persisted = await loadPersisted(group.scope);
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

    // Single resource. Storage key = primary accessor name (the runtime
    // writes single-resource state under the accessor name directly).
    const rawState = persisted?.resources[primaryName];
    const state: JsonObject | null = isJsonObject(rawState)
      ? (rawState as JsonObject)
      : null;
    const rawContent = persisted?.content[primaryName];
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
