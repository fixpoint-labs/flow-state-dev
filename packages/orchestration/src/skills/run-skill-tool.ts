/**
 * The `runSkill` tool — the agent's mid-flow entry point into the skills
 * system (the legacy session-global surface).
 *
 * Skills are NOT auto-matched. The model decides when a skill applies by
 * calling this tool with `name` (and optionally `input`). The tool resolves the
 * skill from the configured collection and dispatches to `inlineActivate`,
 * which patches `activeSkills` so the next generator step renders the
 * substituted body in its system prompt.
 *
 * After FIX-918 there is only one mode (`inline`) — the `fork` and `pattern`
 * dispatch routes were removed. The router shell is kept for the mid-flow
 * activation path; the per-generator binding surface (`createSkillsLibrary`) is
 * the modern home for inline activation.
 *
 * The dynamic tool `description` is built from the active skill catalog at call
 * time so the model sees only currently-enabled skill names.
 */

import { z } from "zod";
import { router } from "@flow-state-dev/core";
import type {
  BlockDefinition,
  ResourceCollectionRef,
} from "@flow-state-dev/core/types";
import type { InitialSkill, SkillState, ToolCatalog } from "@flow-state-dev/core";
import { skillManifestKey } from "./collection";
import { getCollection as resolveCollection } from "./internal/get-collection";
import { listEnabledSkills } from "./internal/list-enabled-skills";
import { ensureSeeded } from "./seeding";
import { inlineActivate } from "./inline-activate";
import { validateSkillName } from "./skill-md";

// ---------------------------------------------------------------------------
// Tool I/O — public surface unchanged from the prior handler implementation
// ---------------------------------------------------------------------------

const inputSchema = z.object({
  name: z
    .string()
    .describe(
      "The exact skill name (matches the directory under skills/). Must be one of the names listed in this tool's description.",
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
  message: z.string().optional(),
});

type RunSkillInput = z.infer<typeof inputSchema>;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface RunSkillToolOptions {
  /** Resource registry key for the skills collection. */
  collectionKey: string;
  /** Default-on initial skills, lazily seeded on first invocation. */
  initialSkills?: InitialSkill[];
  /**
   * Tool catalog. Retained for API compatibility with the prior fork-mode
   * surface; inline activation does not resolve tools here (the generator
   * registers the catalog directly).
   */
  catalog?: ToolCatalog;
}

// ---------------------------------------------------------------------------
// Helpers — retained for re-export and test use
// ---------------------------------------------------------------------------

function getRequiredCollection(
  ctx: import("@flow-state-dev/core/types").BlockContext,
  key: string,
): ResourceCollectionRef {
  const collection = resolveCollection(ctx, key);
  if (!collection) {
    throw new Error(
      `Skills collection "${key}" is not registered on ctx.resources`,
    );
  }
  return collection;
}

// Re-exported so existing importers of the v1 catalog primitive keep working.
export { listEnabledSkills } from "./internal/list-enabled-skills";

/**
 * Build the runSkill tool's dynamic description listing available skills.
 * Returns a stable string so the model sees the same enum on every step.
 */
export function buildRunSkillDescription(
  enabled: Array<{ name: string; description: string }>,
): string {
  if (enabled.length === 0) {
    return "No skills are currently available — this tool will reject any invocation.";
  }
  const lines = [
    "Invoke a domain-specific skill by name. Skills are pre-authored playbooks that load specialized instructions and (optionally) extra tools when activated.",
    "",
    "Available skills:",
  ];
  for (const skill of enabled) {
    lines.push(`- ${skill.name}: ${skill.description}`);
  }
  lines.push(
    "",
    "Pass the skill name in `name`. Pass any required argument string in `input` (substituted for $ARGUMENTS in the skill body).",
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the `runSkill` router tool configured against a specific collection
 * scope. Returns a `BlockDefinition` usable as a `GeneratorTool`.
 */
export function createRunSkillTool(opts: RunSkillToolOptions) {
  const { collectionKey, initialSkills } = opts;

  const routes = [inlineActivate] as unknown as BlockDefinition<
    typeof inputSchema,
    typeof outputSchema
  >[];

  return router({
    name: "runSkill",
    description:
      "Invoke a named skill. The list of available skills is provided in the system context — call this tool with one of those names to activate it.",
    inputSchema,
    outputSchema,
    routes,
    execute: async (input: RunSkillInput, ctx) => {
      validateSkillName(input.name);

      const collection = getRequiredCollection(ctx, collectionKey);
      // Lazy seed on first invocation per process. ensureSeeded is memoized
      // via WeakMap on the collection ref, so this is a no-op after the
      // initial pass.
      await ensureSeeded(collection, initialSkills);

      const manifestKey = skillManifestKey(input.name);
      const manifest = await collection.getOptional(manifestKey);
      if (!manifest) {
        const enabled = await listEnabledSkills(collection);
        const available = enabled.map((s) => s.name).join(", ") || "(none)";
        throw new Error(
          `Unknown skill "${input.name}". Available: ${available}`,
        );
      }

      const state = manifest.state as unknown as SkillState;
      if (state.disableModelInvocation) {
        throw new Error(
          `Skill "${input.name}" has \`disable-model-invocation: true\` and cannot be invoked by the agent`,
        );
      }

      // Inline is the only mode. Adapt input shape and pass output through as
      // the router's output (it already matches the inline ack shape).
      return inlineActivate.connectInput(
        (raw: RunSkillInput) => ({
          skillName: raw.name,
          input: raw.input,
        }),
      ) as unknown as BlockDefinition<typeof inputSchema, typeof outputSchema>;
    },
  });
}
