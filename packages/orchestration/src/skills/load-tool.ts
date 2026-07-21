/**
 * The model-facing **load tool** for a per-generator skill binding.
 *
 * Installed by `presets({ dynamicActivation: true })`. When the model calls it,
 * the tool appends an `inline` activation to the binding's
 * {@link ActivationLocation} so the reader injects the skill's body on the next
 * step of the *same* execution. It runs as a child block of the generator, so
 * for the block-state default it writes the generator's own state via
 * `ctx.parent` (FIX-914's child→ancestor handle).
 *
 * It is named `loadSkill` (distinct from the v1 dispatch router `runSkill` in
 * `run-skill-tool.ts`) because it does one thing — load an inline skill's body.
 * `fork` / `pattern` skills are dispatch routes, not context injections, and
 * stay on the v1 router. A binding rejects fork/pattern skills from `allowed`
 * at build time; this tool rejects them again at call time as a backstop.
 */

import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import type { InitialSkill, SkillState } from "@flow-state-dev/core";
import { activeSkillsArraySchema } from "./active-skill-state";
import {
  appendActivation,
  BLOCK_STATE_FIELD,
  type ActivationLocation,
} from "./activation-store";
import { skillManifestKey } from "./collection";
import { getCollection } from "./internal/get-collection";
import { listEnabledSkills } from "./internal/list-enabled-skills";
import { ensureSeeded } from "./seeding";
import { validateSkillName } from "./skill-md";

const inputSchema = z.object({
  name: z
    .string()
    .describe(
      "The exact skill name to load. Must be one of the names listed in this tool's description.",
    ),
  input: z
    .string()
    .optional()
    .describe(
      "Optional argument string passed to the skill. Substituted for $ARGUMENTS in the skill body.",
    ),
});

const outputSchema = z.object({
  skill: z.string(),
  mode: z.literal("inline"),
  message: z.string(),
});

export interface LoadSkillToolOptions {
  /** Resource registry key for the skills collection. */
  collectionKey: string;
  /** Where activations are written for this binding. */
  location: ActivationLocation;
  /**
   * Skill names the tool may load. `undefined` means the whole enabled
   * catalog. Names outside this set are rejected at call time.
   */
  allowed?: readonly string[];
  /** Bundled defaults, lazily seeded on first call. */
  initialSkills?: InitialSkill[];
}

/**
 * Create the inline load tool for a binding. The tool is a handler, so a tool
 * call is its own child scope — `ctx.parent` reaches the host generator's block
 * state (the block-default path). `parentStateSchema` declares the shape so
 * those ops are present.
 */
export function createLoadSkillTool(opts: LoadSkillToolOptions) {
  const { collectionKey, location, allowed, initialSkills } = opts;
  const allowedSet = allowed ? new Set(allowed) : undefined;

  return handler({
    name: "loadSkill",
    description:
      "Load a named skill's instructions into your context for the rest of this turn. " +
      "The list of loadable skills is provided in the system context — call this with one of those names.",
    inputSchema,
    outputSchema,
    parentStateSchema: z.object({ [BLOCK_STATE_FIELD]: activeSkillsArraySchema }),
    execute: async (input, ctx: BlockContext) => {
      validateSkillName(input.name);

      const collection = getCollection(ctx, collectionKey);
      if (!collection) {
        throw new Error(
          `Skills collection "${collectionKey}" is not registered on ctx.resources`,
        );
      }
      await ensureSeeded(collection, initialSkills);

      if (allowedSet && !allowedSet.has(input.name)) {
        throw new Error(
          `Skill "${input.name}" is not in this generator's allowed set. Allowed: ${
            [...allowedSet].join(", ") || "(none)"
          }`,
        );
      }

      const manifest = await collection.getOptional(skillManifestKey(input.name));
      if (!manifest) {
        const enabled = await listEnabledSkills(collection);
        const available = enabled.map((s) => s.name).join(", ") || "(none)";
        throw new Error(`Unknown skill "${input.name}". Available: ${available}`);
      }

      const state = manifest.state as unknown as SkillState;
      if (state.disableModelInvocation) {
        throw new Error(
          `Skill "${input.name}" has \`disable-model-invocation: true\` and cannot be loaded by the agent`,
        );
      }

      const mode = state.contextMode ?? "inline";
      if (mode !== "inline") {
        throw new Error(
          `Skill "${input.name}" is a ${mode}-mode skill and cannot be loaded inline. ` +
            `Fork/pattern skills dispatch through the runSkill router, not the binding load tool.`,
        );
      }

      await appendActivation(ctx, location, {
        name: input.name,
        mode: "inline",
        input: input.input,
        activatedAt: Date.now(),
      });

      return {
        skill: input.name,
        mode: "inline" as const,
        message: `Skill "${input.name}" loaded. Its instructions are now in your context — re-read it before proceeding.`,
      };
    },
  });
}

export interface LoadCatalogContextOptions {
  collectionKey: string;
  allowed?: readonly string[];
  initialSkills?: InitialSkill[];
}

/**
 * Build the catalog-listing context entry the model reads to discover which
 * skills it can load. Filtered to the binding's `allowed` set (if any) and to
 * `inline`-mode skills — the load tool rejects fork/pattern skills, so listing
 * them would only invite a call that can't succeed.
 */
export function buildLoadCatalogContext(
  opts: LoadCatalogContextOptions,
): (input: unknown, ctx: BlockContext) => Promise<string | null> {
  const allowedSet = opts.allowed ? new Set(opts.allowed) : undefined;
  return async (_input: unknown, ctx: BlockContext) => {
    const collection = getCollection(ctx, opts.collectionKey);
    if (!collection) return null;
    try {
      await ensureSeeded(collection, opts.initialSkills);
    } catch {
      // Seeding failure already logged.
    }
    const enabled = await listEnabledSkills(collection);
    const loadable = enabled.filter(
      (s) => s.mode === "inline" && (!allowedSet || allowedSet.has(s.name)),
    );
    if (loadable.length === 0) return null;
    const lines = [
      "You can load any of these skills with the `loadSkill` tool to pull its instructions into context:",
      "",
    ];
    for (const skill of loadable) lines.push(`- ${skill.name}: ${skill.description}`);
    return lines.join("\n");
  };
}
