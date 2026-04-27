import { z } from "zod";
import type { BlockContext } from "../types/block";
import type { ResourceRef } from "../types/resource";
import { handler } from "../blocks/handler";

function toResourcePath(resource: ResourceRef<any>): string {
  return `${resource.scope}/${resource.name}`;
}

function listResources(ctx: BlockContext): ResourceRef<any>[] {
  const registry = ctx.resources;
  if (registry === undefined) return [];

  // Filter out collection refs — only static ResourceRefs have content
  return registry.list().filter((entry: any): entry is ResourceRef<any> =>
    !("pattern" in entry && "create" in entry)
  );
}

/**
 * Tool block for reading rendered resource content.
 *
 * Input `path` is optional:
 * - omitted: returns available readable resource paths
 * - provided: returns rendered content for that path
 */
export function readResourceContentTool() {
  return handler({
    name: "readResourceContent",
    description: "Read rendered resource content. With no path, returns available readable paths.",
    inputSchema: z.object({ path: z.string().optional() }),
    outputSchema: z.object({
      paths: z.array(z.string()).optional(),
      path: z.string().optional(),
      content: z.string().nullable().optional()
    }),
    execute: async (input, ctx) => {
      const readable = listResources(ctx).filter((resource) => resource.config.llmReadable === true);

      if (input.path === undefined) {
        return { paths: readable.map((resource) => toResourcePath(resource)).sort() };
      }

      const resource = readable.find((entry) => toResourcePath(entry) === input.path);
      if (resource === undefined) {
        throw new Error(`Readable resource not found for path: ${input.path}`);
      }

      return {
        path: input.path,
        content: await resource.readContent()
      };
    }
  });
}

/**
 * Tool block for overwriting resource content when `llmWritable` is enabled.
 */
export function writeResourceContentTool() {
  return handler({
    name: "writeResourceContent",
    description: "Overwrite resource content for an llmWritable resource path.",
    inputSchema: z.object({ path: z.string(), content: z.string() }),
    outputSchema: z.object({ path: z.string(), ok: z.literal(true) }),
    execute: async (input, ctx) => {
      const resource = listResources(ctx)
        .find((entry) => toResourcePath(entry) === input.path && entry.config.llmWritable === true);

      if (resource === undefined) {
        throw new Error(`Writable resource not found for path: ${input.path}`);
      }

      await resource.writeContent(input.content);
      return { path: input.path, ok: true };
    }
  });
}
