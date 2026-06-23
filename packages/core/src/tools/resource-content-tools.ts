// ---------------------------------------------------------------------------
// Generic content read/write tool blocks for the LLM tool surface.
//
// These address resources by their scope-qualified `uri` (`${scope}/${path}`),
// the same handle the navigation tools (`globResources` / `grepResourceContent`
// / `searchResources`) emit — so the agent can discover a resource with glob/grep
// and feed the returned uri straight to read/write. The uri is unique across
// scopes (FIX-842), so resolution is unambiguous even when two collections share
// a pattern in different scopes. Both static resources and collection instances
// are covered: a collection opts in with `llmReadable` / `llmWritable` on its
// definition, which the server threads onto every instance ref's `config`.
// ---------------------------------------------------------------------------

import { z } from "zod";
import { handler } from "../blocks/handler";
import { collectAllResources, isLlmReadable, isLlmWritable, resolveResourceByUri } from "./resource-tools";

/**
 * Tool block for reading rendered resource content, keyed by scope-qualified uri.
 *
 * Input `uri` is optional:
 * - omitted: returns the uris of every readable resource (static + collection instance)
 * - provided: returns rendered content for that uri
 */
export function readResourceContentTool() {
  return handler({
    name: "readResourceContent",
    description:
      "Read rendered resource content by its scope-qualified uri (e.g. 'session/artifacts/memo-1'). With no uri, returns the uris you can read.",
    inputSchema: z.object({ uri: z.string().optional() }),
    outputSchema: z.object({
      uris: z.array(z.string()).optional(),
      uri: z.string().optional(),
      content: z.string().nullable().optional()
    }),
    execute: async (input, ctx) => {
      if (input.uri === undefined) {
        const readable = (await collectAllResources(ctx)).filter(isLlmReadable);
        return { uris: readable.map((ref) => ref.uri).sort() };
      }

      const ref = await resolveResourceByUri(input.uri, ctx);
      if (ref === undefined || !isLlmReadable(ref)) {
        throw new Error(`Readable resource not found for uri: ${input.uri}`);
      }

      return { uri: input.uri, content: await ref.readContent() };
    }
  });
}

/**
 * Tool block for overwriting resource content when `llmWritable` is enabled,
 * keyed by scope-qualified uri.
 */
export function writeResourceContentTool() {
  return handler({
    name: "writeResourceContent",
    description:
      "Overwrite resource content for an llmWritable resource, addressed by its scope-qualified uri (e.g. 'session/artifacts/memo-1').",
    inputSchema: z.object({ uri: z.string(), content: z.string() }),
    outputSchema: z.object({ uri: z.string(), ok: z.literal(true) }),
    execute: async (input, ctx) => {
      const ref = await resolveResourceByUri(input.uri, ctx);
      if (ref === undefined || !isLlmWritable(ref)) {
        throw new Error(`Writable resource not found for uri: ${input.uri}`);
      }

      await ref.writeContent(input.content);
      return { uri: input.uri, ok: true as const };
    }
  });
}
