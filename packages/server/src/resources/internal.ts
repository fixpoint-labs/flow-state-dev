/**
 * Resource lookup, persistence, and rendering helpers shared between the
 * built-in HTTP route handlers and sibling-package transport adapters
 * (e.g. `@flow-state-dev/mcp`).
 *
 * Extracted from `routes/resource-routes.ts` so adapters that need to
 * answer "what resources does this flow expose, and what is their content
 * right now?" do not have to reimplement scope resolution and the
 * content-store/record merge.
 *
 * These helpers are exported from `@flow-state-dev/server` under the
 * `unstable_` prefix — they are deliberately not part of the long-term
 * public API surface.
 */
import type {
  JsonObject,
  ResourceCollectionConfig,
  ResourceConfig
} from "@flow-state-dev/core/types";
import type { FlowRegistry } from "../registry/flow-registry";
import type { StoreRegistry } from "../stores/types";
import {
  resolveOrgStorageKey,
  resolveUserStorageKey
} from "../stores/scope-keys";
import { isResourceConfig } from "../routes/route-utils";
import { resourceStorageKeys } from "./storage-keys";
import {
  parseResourceTemplate,
  renderResourceTemplate,
} from "@flow-state-dev/core/resource-template";

/** Storage scope a resource lookup resolves to. */
export type ResolvedResourceScope = "session" | "user" | "org";

/**
 * Minimal flow shape these helpers consume. Accepts any object with
 * `kind`, `resources`, and the user/org isolation flags — covers both
 * `FlowInstance` and `FlowType`.
 */
export type ResourceFlowLike = {
  kind: string;
  resources?: unknown;
  isolateUserState?: boolean;
  isolateOrgState?: boolean;
};

/** Context required for persisted-data lookups (mirrors what the route handlers carry). */
export type ResourcePersistenceContext = {
  registry: FlowRegistry;
  stores: StoreRegistry;
};

/**
 * True when a resource entry shape is a collection (has a `pattern`
 * field). Single resources expose `stateSchema`; collections add
 * `pattern` + collection-specific schemas.
 */
export function isCollectionConfig(value: unknown): value is ResourceCollectionConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "pattern" in value &&
    typeof (value as ResourceCollectionConfig).pattern === "string"
  );
}

// Re-export so older callers keep working.
export { resourceStorageKeys } from "./storage-keys";

/**
 * Look up a resource by accessor key on a flow. Returns the config and
 * its intrinsic scope, or `undefined` if the key is missing or points
 * at something that isn't a resource. Mirrors the original
 * `resource-routes.ts` helper exactly so behavior is preserved.
 */
export function findResourceConfig(
  flow: ResourceFlowLike,
  ref: string
):
  | {
      config: ResourceConfig | ResourceCollectionConfig;
      scope: ResolvedResourceScope;
      /** Canonical storage key — equals `ref` for non-aliased single resources. */
      storageKey: string;
    }
  | undefined {
  const resources = flow.resources;
  if (resources === undefined || typeof resources !== "object" || resources === null) {
    return undefined;
  }
  const config = (resources as Record<string, unknown>)[ref];
  if (config === undefined) return undefined;
  if (!isResourceConfig(config) && !isCollectionConfig(config)) return undefined;
  const scope = (config as { scope?: string }).scope;
  if (scope !== "session" && scope !== "user" && scope !== "org") return undefined;
  // Resolve the persisted storage key for this accessor — aliases that share
  // a `DefinedResource` reference collapse to a single slot (FIX-591).
  const allKeys = resourceStorageKeys(resources as Record<string, unknown>);
  const storageKey = allKeys[ref] ?? ref;
  return { config, scope, storageKey };
}

/**
 * Read the persisted resource state and content for a given scope of a
 * session. Resource state lives in the ResourceStateStore (FIX-689) and
 * content in the ContentStore (FIX-347) — both keyed per-resource, separate
 * from the scope record.
 *
 * Returns `undefined` if the session, user record, or org record is
 * missing for the requested scope.
 */
export async function getPersistedData(
  ctx: ResourcePersistenceContext,
  flow: ResourceFlowLike,
  sessionId: string,
  scope: ResolvedResourceScope
): Promise<{ resources: Record<string, JsonObject>; content: Record<string, string> } | undefined> {
  const session = await ctx.stores.session.get(sessionId);
  if (!session) return undefined;

  if (scope === "session") {
    const [resources, content] = await Promise.all([
      ctx.stores.resourceState.getAll("session", session.id),
      ctx.stores.content.getAll("session", session.id)
    ]);
    return { resources, content };
  }

  if (scope === "user") {
    // Forward the full flow object — `resolveUserStorageKey` consults
    // `flow.resources` to honor per-resource `flowIsolation` overrides
    // (FIX-435). Stripping the field would silently route to the wrong
    // storage key when any user-scope resource sets its own override.
    const user = await ctx.stores.user.get(
      resolveUserStorageKey(session.userId, toIsolationFlow(flow))
    );
    if (!user) return undefined;
    const [resources, content] = await Promise.all([
      ctx.stores.resourceState.getAll("user", user.id),
      ctx.stores.content.getAll("user", user.id)
    ]);
    return { resources, content };
  }

  // org
  if (!session.orgId) return undefined;
  const org = await ctx.stores.org.get(
    resolveOrgStorageKey(session.orgId, toIsolationFlow(flow))
  );
  if (!org) return undefined;
  const [resources, content] = await Promise.all([
    ctx.stores.resourceState.getAll("org", org.id),
    ctx.stores.content.getAll("org", org.id)
  ]);
  return { resources, content };
}

/**
 * Render a resource's content via its config-supplied `render` hook,
 * falling back to the raw stored string when no hook is configured.
 * Returns `null` when there is no raw content to render.
 */
export async function renderContent(
  config: ResourceConfig | ResourceCollectionConfig,
  rawContent: string | undefined,
  state: JsonObject,
  templateRaw?: string
): Promise<string | null> {
  if ("contentTemplate" in config && config.contentTemplate !== undefined) {
    return renderResourceTemplate(config.contentTemplate, state);
  }
  if ("contentTemplateRef" in config && config.contentTemplateRef !== undefined) {
    const raw = templateRaw;
    if (raw === undefined || raw === null) return null;
    const template = parseResourceTemplate(raw);
    return renderResourceTemplate(template, state);
  }
  if (rawContent === undefined) return null;
  if ("render" in config && typeof config.render === "function") {
    return config.render(rawContent, state);
  }
  return rawContent;
}

/**
 * Coerce a `ResourceFlowLike` into the `IsolationFlow` shape consumed by
 * `resolveUserStorageKey` / `resolveOrgStorageKey`. Forwards `resources`
 * so `effectiveScopeIsolation` can iterate per-resource `flowIsolation`
 * overrides (FIX-435).
 */
function toIsolationFlow(flow: ResourceFlowLike): {
  kind: string;
  isolateUserState: boolean;
  isolateOrgState: boolean;
  resources?: Record<string, { scope?: string; flowIsolation?: boolean }>;
} {
  return {
    kind: flow.kind,
    isolateUserState: flow.isolateUserState ?? false,
    isolateOrgState: flow.isolateOrgState ?? false,
    resources: flow.resources as Record<string, { scope?: string; flowIsolation?: boolean }> | undefined
  };
}

/** Shape returned for each entry surfaced by `listExposedResources`. */
export type ExposedResourceEntry = {
  ref: string;
  scope: ResolvedResourceScope;
  /** Canonical URI used by sibling adapters (e.g. MCP's `flow://` scheme). */
  uri: string;
  name: string;
  description?: string;
  mimeType: string;
};

/**
 * Enumerate the resources a flow exposes to external transports — i.e.
 * resources whose `client.content.read` is `true`.
 *
 * v1 of FIX-22 (MCP server) ships with no general "flow scope" concept
 * in the resource model (resources are session/user/org). The MCP
 * adapter consumes this helper today; until the resource model grows a
 * truly flow-bound scope, this returns an empty list — sibling code
 * paths still wire up correctly without behavior surprises.
 */
export async function listExposedResources(
  _flow: ResourceFlowLike,
  _ctx: ResourcePersistenceContext
): Promise<ExposedResourceEntry[]> {
  return [];
}
