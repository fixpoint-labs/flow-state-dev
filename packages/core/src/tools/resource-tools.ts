import { z } from "zod";
import type { BlockContext } from "../types/block";
import type { ResourceRef } from "../types/resource";
import type { ResourceCollectionRef } from "../types/resource-collection";
import { isDefinedResourceCollection } from "../types/resource-collection";
import { handler } from "../blocks/handler";

type CollectionEntry = {
  name: string;
  scope: string;
  ref: ResourceCollectionRef<any>;
};

function collectCollections(ctx: BlockContext): CollectionEntry[] {
  const entries: CollectionEntry[] = [];
  const registry = ctx.resources;
  if (registry === undefined) return entries;

  for (const entry of registry.list()) {
    // ResourceCollectionRef has a `pattern` property that ResourceRef does not
    if ("pattern" in entry && "create" in entry) {
      const nsRef = entry as unknown as ResourceCollectionRef<any>;
      entries.push({
        name: nsRef.pattern,
        scope: nsRef.scope,
        ref: nsRef,
      });
    }
  }

  return entries;
}

function collectStaticResources(ctx: BlockContext): ResourceRef<any>[] {
  const registry = ctx.resources;
  if (registry === undefined) return [];
  return registry
    .list()
    .filter((entry: any): entry is ResourceRef<any> => !("pattern" in entry && "create" in entry));
}

function buildCollectionDescription(collections: CollectionEntry[]): string {
  if (collections.length === 0) return "";
  const lines = collections.map((ns) => `  - ${ns.ref.pattern} (${ns.scope})`);
  return `\nAvailable collections:\n${lines.join("\n")}`;
}

/**
 * Generic resource CRUD tool blocks for LLM tool surface.
 * Returns handler blocks that work across all registered collections.
 *
 * Provides 5 tools:
 * - `createResource({ path, state? })` — Create a new resource instance
 * - `readResource({ path })` — Read a resource instance
 * - `updateResource({ path, state? })` — Update a resource instance
 * - `deleteResource({ path })` — Delete a resource instance
 * - `listResources({ prefix? })` — List all resource instances
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

  const listResourcesTool = handler({
    name: "listResources",
    description: "List resource instances, optionally filtered by prefix.",
    inputSchema: z.object({
      prefix: z.string().optional().describe("Optional prefix to filter results"),
    }),
    outputSchema: z.object({
      resources: z.array(z.object({
        path: z.string(),
        state: z.record(z.unknown()),
      })),
    }),
    execute: async (input, ctx) => {
      const collections = collectCollections(ctx);
      const resources: Array<{ path: string; state: Record<string, unknown> }> = [];

      for (const ns of collections) {
        const instances = await ns.ref.list(input.prefix);
        for (const instance of instances) {
          resources.push({
            path: instance.path,
            state: instance.state as Record<string, unknown>,
          });
        }
      }

      return { resources };
    },
  });

  return {
    createResource,
    readResource,
    updateResource,
    deleteResource,
    listResources: listResourcesTool,
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
    if (!("pattern" in entry && "create" in entry)) {
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
 * Static resources plus every instance of every collection, as one flat
 * `ResourceRef` list. Collection instances are themselves `ResourceRef`s, so
 * callers treat the two uniformly. Lists each collection in full — suited to
 * the bounded, curated collections the navigation and content tools target.
 */
export async function collectAllResources(ctx: BlockContext): Promise<ResourceRef<any>[]> {
  const out: ResourceRef<any>[] = [...collectStaticResources(ctx)];
  for (const ns of collectCollections(ctx)) {
    for (const instance of await ns.ref.list()) out.push(instance);
  }
  return out;
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
