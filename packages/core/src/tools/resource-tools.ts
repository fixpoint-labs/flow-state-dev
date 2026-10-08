import { z } from "zod";
import type { BlockContext } from "../types/block";
import type { AnyResourceRef, ResourceRef } from "../types/resource";
import type { ResourceCollectionRef } from "../types/resource-collection";
import type { ResourceVisibility, ResourceVisibilityRule } from "../types/resource-visibility";
import { handler } from "../blocks/handler";
import {
  extractBareTopic,
  isParameterizedPattern,
  matchesPattern,
  normalizeResourcePath,
} from "../types/collection-patterns";

type CollectionEntry = {
  name: string;
  scope: string;
  ref: ResourceCollectionRef<any>;
  /** What this turn's visibility rule allows the model: never `"hidden"` here. */
  access: Exclude<ResourceVisibility, "hidden">;
};

/**
 * The flow's visibility rule, read off the running flow. `ctx.flow` is the
 * flow instance at run time; the rule is definition-only, so every copy
 * carries its definition's.
 */
function visibilityRuleOf(ctx: BlockContext): ResourceVisibilityRule | undefined {
  return (ctx.flow as { resourceVisibility?: ResourceVisibilityRule } | undefined)?.resourceVisibility;
}

/**
 * Every registered resource the model may reach on this turn, with what it
 * may do: the one place the flow's `resourceVisibility` rule is applied, so
 * every listing and lookup below narrows the same way. A resource the rule
 * hides is left out here, so it answers exactly like one that isn't
 * registered. With no rule, every entry is `"visible"`.
 */
function reachableEntries(ctx: BlockContext): Array<{ entry: AnyResourceRef; access: Exclude<ResourceVisibility, "hidden"> }> {
  const registry = ctx.resources;
  if (registry === undefined) return [];
  const rule = visibilityRuleOf(ctx);
  if (rule === undefined) return registry.list().map((entry) => ({ entry, access: "visible" as const }));
  const out: Array<{ entry: AnyResourceRef; access: Exclude<ResourceVisibility, "hidden"> }> = [];
  // The registry's own keys are its accessor names; `get` and `list` are its methods.
  for (const [name, entry] of Object.entries(registry as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) continue;
    const ref = entry as AnyResourceRef;
    const access = rule(ctx, { name, ref });
    if (access !== "hidden") out.push({ entry: ref, access });
  }
  return out;
}

/**
 * True for a projected resource collection ref (FIX-858) — carries the
 * `projected: true` brand. Both `pattern`-bearing collection kinds (store-backed
 * and projected) are classified by this brand: store-backed CRUD/glob/grep paths
 * take `collectCollections` (projected excluded), while the search-pushdown and
 * URI-read paths take `collectProjectedCollections`.
 */
function isProjectedRef(entry: unknown): boolean {
  return typeof entry === "object" && entry !== null && (entry as { projected?: unknown }).projected === true;
}

/**
 * Store-backed collections only (mutable, `getByPrefix`-enumerable). Projected
 * collections carry `pattern` too, so they're classified out by the `projected`
 * brand — CRUD, glob, grep, and full-enumeration paths must never treat a
 * read-through projected collection as a store-backed one.
 */
function collectCollections(ctx: BlockContext): CollectionEntry[] {
  const entries: CollectionEntry[] = [];
  for (const { entry, access } of reachableEntries(ctx)) {
    // ResourceCollectionRef has a `pattern` property that ResourceRef does not.
    if ("pattern" in entry && !isProjectedRef(entry)) {
      const nsRef = entry as unknown as ResourceCollectionRef<any>;
      entries.push({ name: nsRef.pattern, scope: nsRef.scope, ref: nsRef, access });
    }
  }

  return entries;
}

/**
 * Projected (read-through) collections only — the search/list-pushdown and
 * URI-read surface. Classified by the `projected` brand; the `ref` here is a
 * read-only `ProjectedResourceCollectionRef` (`get`/`getOptional`/`list`, no
 * mutators), so callers must only use the read subset.
 */
export function collectProjectedCollections(ctx: BlockContext): CollectionEntry[] {
  const entries: CollectionEntry[] = [];
  for (const { entry, access } of reachableEntries(ctx)) {
    if ("pattern" in entry && isProjectedRef(entry)) {
      const nsRef = entry as unknown as ResourceCollectionRef<any>;
      entries.push({ name: nsRef.pattern, scope: nsRef.scope, ref: nsRef, access });
    }
  }

  return entries;
}

/** The static (single) resources the model may reach on this turn, with what it may do. */
function reachableStatics(ctx: BlockContext): Array<{ ref: ResourceRef<any>; access: Exclude<ResourceVisibility, "hidden"> }> {
  return reachableEntries(ctx)
    .filter(({ entry }) => !("pattern" in entry && "create" in entry) && !isProjectedRef(entry))
    .map(({ entry, access }) => ({ ref: entry as ResourceRef<any>, access }));
}

function collectStaticResources(ctx: BlockContext): ResourceRef<any>[] {
  return reachableStatics(ctx).map(({ ref }) => ref);
}

/**
 * Generic resource CRUD tool blocks for LLM tool surface.
 * Returns handler blocks that work across all registered collections.
 *
 * Provides 4 tools, each acting on a path the caller already names:
 * - `createResource({ path, state? })` — Create a new resource instance
 * - `readResource({ path })` — Read a resource instance
 * - `updateResource({ path, state? })` — Update a resource instance
 * - `deleteResource({ path })` — Delete a resource instance
 *
 * **`listResources` was removed (FIX-817).** It enumerated every collection's
 * full stored state through `collectCollections`, ignoring the `llmReadable`
 * gate this module defines two functions below — so a collection nobody marked
 * readable was dumped to the model anyway. Enumeration is now the discovery
 * door's job (`discoveryTools`), which answers from `collectReadableResources`
 * and returns a planning contract rather than raw state.
 */
export function resourceTools() {
  const createResource = handler({
    name: "createResource",
    description: "Create a new resource instance in a collection.",
    inputSchema: z.object({
      path: z.string().describe("Full path for the resource, e.g. 'files/readme.md'"),
      state: z.record(z.unknown()).optional().describe("Initial state for the resource"),
    }),
    outputSchema: z.object({
      path: z.string(),
      ok: z.literal(true),
    }),
    execute: async (input, ctx) => {
      const { nsRef, key } = resolvePathToCollection(input.path, ctx, "write");
      await nsRef.create(key, input.state as any);
      return { path: input.path, ok: true as const };
    },
  });

  const readResource = handler({
    name: "readResource",
    description: "Read the state of a resource instance.",
    inputSchema: z.object({
      path: z.string().describe("Full path for the resource"),
    }),
    outputSchema: z.object({
      path: z.string(),
      state: z.record(z.unknown()),
    }),
    execute: async (input, ctx) => {
      const { nsRef, key } = resolvePathToCollection(input.path, ctx);
      const handle = await nsRef.get(key);
      return { path: input.path, state: handle.state as Record<string, unknown> };
    },
  });

  const updateResource = handler({
    name: "updateResource",
    description: "Update the state of an existing resource instance.",
    inputSchema: z.object({
      path: z.string().describe("Full path for the resource"),
      state: z.record(z.unknown()).describe("State updates to apply"),
    }),
    outputSchema: z.object({
      path: z.string(),
      ok: z.literal(true),
    }),
    execute: async (input, ctx) => {
      const { nsRef, key } = resolvePathToCollection(input.path, ctx, "write");
      const handle = await nsRef.get(key);
      await handle.patchState(input.state as any);
      return { path: input.path, ok: true as const };
    },
  });

  const deleteResource = handler({
    name: "deleteResource",
    description: "Delete a resource instance.",
    inputSchema: z.object({
      path: z.string().describe("Full path for the resource to delete"),
    }),
    outputSchema: z.object({
      path: z.string(),
      ok: z.literal(true),
    }),
    execute: async (input, ctx) => {
      const { nsRef, key } = resolvePathToCollection(input.path, ctx, "write");
      await nsRef.delete(key);
      return { path: input.path, ok: true as const };
    },
  });

  return {
    createResource,
    readResource,
    updateResource,
    deleteResource,
  };
}

/**
 * Unified path lookup spanning single resources and collection instances.
 * Tries single resources by `ResourceRef.path`, then collections via the
 * same matcher as the CRUD tools (`matchCollectionKey`, + `nsRef.get(key)`). Returns
 * a `ResourceRef` (collection instances are themselves `ResourceRef`s, so
 * `readContent()` is uniform). Returns `undefined` on a miss.
 */
export async function resolveResourceByPath(
  path: string,
  ctx: BlockContext,
): Promise<ResourceRef<any> | undefined> {
  for (const ref of collectStaticResources(ctx)) {
    if (ref.path === path) return ref;
  }

  const collections = collectCollections(ctx);
  for (const ns of collections) {
    const key = matchCollectionKey(ns, path);
    if (key !== undefined) {
      try {
        return await ns.ref.get(key);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/not found/i.test(msg)) continue;
        throw err;
      }
    }
  }

  return undefined;
}

/**
 * Content read gate. A collection instance carries its owning collection's
 * config (the server stamps `config: nsConfig` onto every instance ref), so the
 * collection-level `llmReadable` flag reaches each instance through `ref.config`.
 */
export function isLlmReadable(ref: ResourceRef<any>): boolean {
  return ref.config?.llmReadable === true;
}

/** Content write gate. Independent of `llmReadable`, matching the single-resource contract. */
export function isLlmWritable(ref: ResourceRef<any>): boolean {
  return ref.config?.llmWritable === true;
}

/**
 * Whether the model may write `ref` on this turn: its own `llmWritable`, and
 * the flow's visibility rule leaving it writable. `ref` is a static resource
 * or a collection instance resolved through this module on this turn.
 */
export function isLlmWritableNow(ref: ResourceRef<any>, ctx: BlockContext): boolean {
  if (!isLlmWritable(ref)) return false;
  if (visibilityRuleOf(ctx) === undefined) return true;
  const own = reachableStatics(ctx).find((s) => s.ref === ref || s.ref.uri === ref.uri);
  if (own !== undefined) return own.access === "visible";
  const slash = ref.uri.indexOf("/");
  const scope = ref.uri.slice(0, slash);
  const path = ref.uri.slice(slash + 1);
  const owner = collectCollections(ctx).find((ns) => ns.scope === scope && matchCollectionKey(ns, path) !== undefined);
  return owner?.access === "visible";
}

/**
 * Every `llmReadable` resource — static resources that opted in, plus the
 * instances of collections that opted in. Filters collections by their
 * collection-level `llmReadable` BEFORE calling `list()`, so a collection that
 * didn't opt in is never enumerated (a lazy collection isn't bulk-loaded, and a
 * large/broken one can't fail an unrelated read). Flags are collection-wide, so
 * skipping a non-readable collection drops exactly the instances an
 * instance-level filter would have.
 */
export async function collectReadableResources(ctx: BlockContext): Promise<ResourceRef<any>[]> {
  const out: ResourceRef<any>[] = collectStaticResources(ctx).filter(isLlmReadable);
  for (const ns of collectCollections(ctx)) {
    if (ns.ref.config?.llmReadable !== true) continue;
    for (const instance of await ns.ref.list()) out.push(instance);
  }
  return out;
}

/**
 * The readable projected collections — the same opt-in gate
 * `collectReadableResources` applies to store-backed collections, applied to
 * the read-through ones. One expression in one place: search and the discovery
 * door both answer from projected collections, and a gate written twice is a
 * gate that can drift so one of them leaks.
 *
 * Synchronous and collection-level, like the store-backed gate: it reads
 * `config` off refs the registry already holds and never calls `list()`, so a
 * collection that did not opt in is filtered out before anything reaches it.
 */
export function collectReadableProjectedCollections(ctx: BlockContext): CollectionEntry[] {
  return collectProjectedCollections(ctx).filter((ns) => ns.ref.config?.llmReadable === true);
}

/**
 * Resolve a scope-qualified resource `uri` (`${scope}/${path}`) to its
 * `ResourceRef` — static resource or collection instance, uniformly. Unlike
 * `resolveResourceByPath`, the uri is unique across scopes (FIX-842), so
 * resolution is unambiguous even when two collections share a pattern in
 * different scopes. Resolves the target directly — statics by uri, then a single
 * `getOptional` on the one collection whose scope+pattern matches — so reading
 * one resource never lists (and so never bulk-loads) unrelated collections.
 * Returns `undefined` on a miss.
 */
export async function resolveResourceByUri(
  uri: string,
  ctx: BlockContext,
): Promise<ResourceRef<any> | undefined> {
  const staticMatch = collectStaticResources(ctx).find((ref) => ref.uri === uri);
  if (staticMatch !== undefined) return staticMatch;

  // uri is `${scope}/${path}`; the scope is the first segment, the rest is the
  // within-scope path the collection pattern matches.
  const slash = uri.indexOf("/");
  if (slash === -1) return undefined;
  const scope = uri.slice(0, slash);
  const path = uri.slice(slash + 1);

  for (const ns of collectCollections(ctx)) {
    if (ns.scope !== scope) continue;
    const key = matchCollectionKey(ns, path);
    if (key === undefined) continue;
    const ref = await ns.ref.getOptional(key);
    if (ref !== undefined && ref.uri === uri) return ref;
  }

  // Projected collections (FIX-858): the agent reaches these by a URI it already
  // learned from a search hit. Resolve directly through the read-through
  // `getOptional` — the ref already renders content — no list/enumeration.
  for (const ns of collectProjectedCollections(ctx)) {
    if (ns.scope !== scope) continue;
    const key = matchCollectionKey(ns, path);
    if (key === undefined) continue;
    const ref = await ns.ref.getOptional(key);
    if (ref !== undefined && ref.uri === uri) return ref;
  }
  return undefined;
}

function resolvePathToCollection(
  path: string,
  ctx: BlockContext,
  intent: "read" | "write" = "read"
): { nsRef: ResourceCollectionRef<any>; key: string | Record<string, string> } {
  // A collection the rule leaves read-only isn't a target for a write: the
  // write answers as for a path no collection matches.
  const collections = collectCollections(ctx).filter((ns) => intent === "read" || ns.access === "visible");

  for (const ns of collections) {
    const key = matchCollectionKey(ns, path);
    if (key !== undefined) {
      return { nsRef: ns.ref, key };
    }
  }

  throw new Error(`No resource collection found matching path: ${path}`);
}

/**
 * The key that addresses `path` in collection `ns`, or `undefined` when the
 * path is not one of its instances.
 *
 * A collection instance's path is its storage key, so a path belongs to a
 * collection exactly when the collection's own rule (`matchesPattern`) accepts
 * it: `*` is one segment, `**` is any depth, `[param]` is one segment bound to
 * that param. The path is normalized first, the same way a string key is, so
 * separator noise (`files//a`, `files/a/`) still lands; a path that can't be
 * normalized (empty, `..`) matches nothing.
 *
 * Returns the bare key for a wildcard pattern and the param object for a
 * parameterized one: the two key shapes `resolveCollectionKey` accepts.
 */
function matchCollectionKey(
  ns: CollectionEntry,
  path: string
): string | Record<string, string> | undefined {
  const pattern = ns.ref.pattern;
  let storageKey: string;
  try {
    storageKey = normalizeResourcePath(path);
  } catch {
    return undefined;
  }
  if (!matchesPattern(pattern, storageKey)) return undefined;

  if (!isParameterizedPattern(pattern)) return extractBareTopic(pattern, storageKey);

  const params: Record<string, string> = {};
  const keySegments = storageKey.split("/");
  pattern.split("/").forEach((segment, i) => {
    const param = segment.match(/^\[([a-zA-Z0-9_]+)\]$/);
    if (param) params[param[1]!] = keySegments[i]!;
  });
  return params;
}
