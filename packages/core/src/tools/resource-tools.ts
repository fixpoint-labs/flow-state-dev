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
  const registries = [
    { scope: "session", registry: ctx.session?.resources },
    { scope: "user", registry: ctx.user?.resources },
    { scope: "org", registry: ctx.org?.resources },
  ];

  for (const { scope, registry } of registries) {
    if (registry === undefined) continue;
    const list = registry.list();
    for (const entry of list) {
      // ResourceCollectionRef has a `pattern` property that ResourceRef does not
      if ("pattern" in entry && "create" in entry) {
        const nsRef = entry as unknown as ResourceCollectionRef<any>;
        entries.push({
          name: nsRef.pattern,
          scope,
          ref: nsRef,
        });
      }
    }
  }

  return entries;
}

function collectStaticResources(ctx: BlockContext): ResourceRef<any>[] {
  const registries = [ctx.session?.resources, ctx.user?.resources, ctx.org?.resources];
  return registries.flatMap((registry) => {
    if (registry === undefined) return [];
    return registry.list().filter((entry): entry is ResourceRef<any> => !("pattern" in entry && "create" in entry));
  });
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
      const handle = nsRef.get(key);
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
      const handle = nsRef.get(key);
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
        const instances = ns.ref.list(input.prefix);
        for (const instance of instances) {
          resources.push({
            path: instance.name,
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
