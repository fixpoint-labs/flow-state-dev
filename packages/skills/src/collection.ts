/**
 * Skills resource collection — `skills/**` flat pattern with mixed entry kinds.
 *
 * The framework's collection pattern validator only accepts `*`, `**`, and
 * `[param]`. We use the `**` form and split `{name}/{rest}` at access time;
 * SKILL.md entries carry the typed `SkillState`, and any other entries are
 * plain file resources whose state is just `{}`. Mixing them in one
 * collection is fine — `state` is permissive (`JsonObject`).
 */

import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

/** The Zod schema for a SKILL.md resource's state. */
export const skillStateSchema = z.object({
  description: z.string(),
  allowedTools: z.array(z.string()).optional(),
  contextMode: z.enum(["inline", "fork"]).optional(),
  disableModelInvocation: z.boolean().optional(),
  outputSchema: z.unknown().optional(),
  whenToUse: z.string().optional(),
  argumentHint: z.string().optional(),
  _seededAt: z.string().optional(),
  _preservedFields: z.record(z.unknown()).optional(),
}).passthrough();

/** Public options for the helper. */
export interface DefineSkillsCollectionOptions {
  /** Pattern prefix. Default `"skills"`. The collection pattern is `${prefix}/**`. */
  prefix?: string;
  /** Maximum number of resources (SKILL.md + supporting files combined). */
  maxInstances?: number;
}

/**
 * Helper that returns a `defineResourceCollection` instance configured for
 * the skills layout. The returned value is a normal collection — it can be
 * registered under any scope's `resources` map.
 *
 * @example
 *   project: {
 *     resources: { skills: defineSkillsCollection() }
 *   }
 */
export function defineSkillsCollection(
  options: DefineSkillsCollectionOptions = {},
) {
  const prefix = options.prefix ?? "skills";
  return defineResourceCollection({
    pattern: `${prefix}/**`,
    stateSchema: skillStateSchema,
    maxInstances: options.maxInstances,
    client: {
      // Skills are user-modifiable by design — expose CRUD to the client.
      content: {
        read: true,
        prefetch: false,
        create: true,
        update: true,
        delete: true,
      },
      // Surface the description and key flags on the client snapshot.
      data: (state) => {
        const s = state as Record<string, unknown>;
        const out: Record<string, unknown> = {
          description: typeof s.description === "string" ? s.description : "",
          disableModelInvocation: s.disableModelInvocation === true,
        };
        if (Array.isArray(s.allowedTools)) out.allowedTools = s.allowedTools;
        if (typeof s.contextMode === "string") out.contextMode = s.contextMode;
        if (typeof s._seededAt === "string") out.seededAt = s._seededAt;
        return out as never;
      },
    },
  });
}

/** Reserved resource key (relative to prefix) for collection-level metadata. */
export const META_KEY = "_meta";

/** Resource key (relative to prefix) for a skill's manifest file. */
export function skillManifestKey(name: string): string {
  return `${name}/SKILL.md`;
}

/** Resource key (relative to prefix) for a skill's supporting file. */
export function skillFileKey(name: string, relativePath: string): string {
  return `${name}/${relativePath.replace(/^\/+/, "")}`;
}
