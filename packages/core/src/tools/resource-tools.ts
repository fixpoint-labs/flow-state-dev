import { z } from "zod";
import type { BlockContext } from "../types/block";
import type { ResourceRef } from "../types/resource";
import type { ResourceCollectionRef } from "../types/resource-collection";
import { handler } from "../blocks/handler";

type CollectionEntry = {
  name: string;
  scope: string;
  ref: ResourceCollectionRef<any>;
};

/**
 * True for an external resource collection ref (FIX-858) — carries the
 * `external: true` brand. Both `pattern`-bearing collection kinds (store-backed
 * and external) are classified by this brand: store-backed CRUD/glob/grep paths
 * take `collectCollections` (external excluded), while the search-pushdown and
 * URI-read paths take `collectExternalCollections`.
 */
function isExternalRef(entry: unknown): boolean {
  return typeof entry === "object" && entry !== null && (entry as { external?: unknown }).external === true;
}

/**
 * Store-backed collections only (mutable, `getByPrefix`-enumerable). External
 * collections carry `pattern` too, so they're classified out by the `external`
 * brand — CRUD, glob, grep, and full-enumeration paths must never treat a
 * read-through external collection as a store-backed one.
 */
function collectCollections(ctx: BlockContext): CollectionEntry[] {
  const entries: CollectionEntry[] = [];
  const registry = ctx.resources;
  if (registry === undefined) return entries;

  for (const entry of registry.list()) {
    // ResourceCollectionRef has a `pattern` property that ResourceRef does not.
    if ("pattern" in entry && !isExternalRef(entry)) {
      const nsRef = entry as unknown as ResourceCollectionRef<any>;
      entries.push({ name: nsRef.pattern, scope: nsRef.scope, ref: nsRef });
    }
  }

  return entries;
}

/**
 * External (read-through) collections only — the search/list-pushdown and
 * URI-read surface. Classified by the `external` brand; the `ref` here is a
 * read-only `ExternalResourceCollectionRef` (`get`/`getOptional`/`list`, no
 * mutators), so callers must only use the read subset.
 */
export function collectExternalCollections(ctx: BlockContext): CollectionEntry[] {
  const entries: CollectionEntry[] = [];
  const registry = ctx.resources;
  if (registry === undefined) return entries;

  for (const entry of registry.list()) {
    if ("pattern" in entry && isExternalRef(entry)) {
      const nsRef = entry as unknown as ResourceCollectionRef<any>;
      entries.push({ name: nsRef.pattern, scope: nsRef.scope, ref: nsRef });
    }
  }

  return entries;
}

function collectStaticResources(ctx: BlockContext): ResourceRef<any>[] {
  const registry = ctx.resources;
  if (registry === undefined) return [];
  return registry
    .list()
    .filter(
      (entry: any): entry is ResourceRef<any> =>
        !("pattern" in entry && "create" in entry) && !isExternalRef(entry)
    );
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
      const { nsRef, key } = resolvePathToCollection(input.path, ctx);
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
      const { nsRef, key } = resolvePathToCollection(input.path, ctx);
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
      const { nsRef, key } = resolvePathToCollection(input.path, ctx);
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
 * existing `resolvePathToCollection` matcher (+ `nsRef.get(key)`). Returns
 * a `ResourceRef` (collection instances are themselves `ResourceRef`s, so
 * `readContent()` is uniform). Returns `undefined` on a miss.
 */
export async function resolveResourceByPath(
  path: string,
  ctx: BlockContext,
): Promise<ResourceRef<any> | undefined> {
  const registry = ctx.resources;
  if (registry === undefined) return undefined;

  for (const entry of registry.list()) {
    if (!("pattern" in entry && "create" in entry) && !isExternalRef(entry)) {
      const ref = entry as ResourceRef<any>;
      if (ref.path === path) return ref;
    }
  }

  const collections = collectCollections(ctx);
  for (const ns of collections) {
    const { key } = tryMatchPath(ns, path);
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
 * The readable external collections — the same opt-in gate
 * `collectReadableResources` applies to store-backed collections, applied to
 * the read-through ones. One expression in one place: search and the discovery
 * door both answer from external collections, and a gate written twice is a
 * gate that can drift so one of them leaks.
 *
 * Synchronous and collection-level, like the store-backed gate: it reads
 * `config` off refs the registry already holds and never calls `list()`, so a
 * collection that did not opt in is filtered out before anything reaches it.
 */
export function collectReadableExternalCollections(ctx: BlockContext): CollectionEntry[] {
  return collectExternalCollections(ctx).filter((ns) => ns.ref.config?.llmReadable === true);
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
    const { key } = tryMatchPath(ns, path);
    if (key === undefined) continue;
    const ref = await ns.ref.getOptional(key);
    if (ref !== undefined && ref.uri === uri) return ref;
  }

  // External collections (FIX-858): the agent reaches these by a URI it already
  // learned from a search hit. Resolve directly through the read-through
  // `getOptional` — the ref already renders content — no list/enumeration.
  for (const ns of collectExternalCollections(ctx)) {
    if (ns.scope !== scope) continue;
    const { key } = tryMatchPath(ns, path);
    if (key === undefined) continue;
    const ref = await ns.ref.getOptional(key);
    if (ref !== undefined && ref.uri === uri) return ref;
  }
  return undefined;
}

function resolvePathToCollection(
  path: string,
  ctx: BlockContext
): { nsRef: ResourceCollectionRef<any>; key: string } {
  const collections = collectCollections(ctx);

  for (const ns of collections) {
    const { nsRef, key } = tryMatchPath(ns, path);
    if (key !== undefined) {
      return { nsRef, key };
    }
  }

  throw new Error(`No resource collection found matching path: ${path}`);
}

function tryMatchPath(
  ns: CollectionEntry,
  path: string
): { nsRef: ResourceCollectionRef<any>; key: string | undefined } {
  const { ref } = ns;
  const pattern = ref.pattern;

  // For wildcard patterns, check if the path starts with the prefix
  if (pattern.includes("*")) {
    const prefix = pattern.replace(/\/?\*+$/, "");
    if (path.startsWith(prefix + "/")) {
      const key = path.slice(prefix.length + 1);
      return { nsRef: ref, key };
    }
    return { nsRef: ref, key: undefined };
  }

  // For parameterized patterns, check if the path matches
  if (pattern.includes("[")) {
    // Extract param names from pattern segments
    const patternSegments = pattern.split("/");
    const pathSegments = path.split("/");

    if (patternSegments.length !== pathSegments.length) {
      return { nsRef: ref, key: undefined };
    }

    const params: Record<string, string> = {};
    let matches = true;

    for (let i = 0; i < patternSegments.length; i++) {
      const pSeg = patternSegments[i]!;
      const vSeg = pathSegments[i]!;
      const paramMatch = pSeg.match(/^\[([a-zA-Z0-9_]+)\]$/);
      if (paramMatch) {
        params[paramMatch[1]!] = vSeg;
      } else if (pSeg !== vSeg) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return { nsRef: ref, key: path };
    }
    return { nsRef: ref, key: undefined };
  }

  return { nsRef: ref, key: undefined };
}
