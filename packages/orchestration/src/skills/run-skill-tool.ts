/**
 * The `runSkill` tool — the agent's entry point into the skills system.
 *
 * Skills are NOT auto-matched. The model decides when a skill applies by
 * calling this tool with `name` (and optionally `input`). The tool resolves
 * the skill from the configured collection and dispatches to:
 *   - `inlineActivate` (handler) — patches `activeSkills` so the next
 *     generator step renders the substituted body in its system prompt.
 *   - the pattern route — when the skill declares `pattern:` frontmatter.
 *
 * Fork-mode skills no longer dispatch here (FIX-919). Fork installs per
 * generator via `createSkillsLibrary`'s `fork` preset — a `forkSkill` tool
 * whose child inherits the conversation to the fork point and returns only its
 * result. This router rejects a fork skill with a pointer to that path.
 *
 * The tool is a `router` rather than a handler: dispatch + per-branch
 * input/output adaptation belongs inside a router (BP-013), and routing to
 * a framework-native generator (the pattern route) lets a subagent stream tool
 * calls and text to the client in real time for DevTool observability.
 *
 * The dynamic tool `description` is built from the active skill catalog at
 * call time so the model sees only currently-enabled skill names.
 */

import { z } from "zod";
import { router } from "@flow-state-dev/core";
import type {
  BlockDefinition,
  ResourceCollectionRef,
} from "@flow-state-dev/core/types";
import type {
  AgentRegistry,
  DefinedCapability,
  InitialSkill,
  MaterializeAgentFn,
  SkillState,
  ToolCatalog,
} from "@flow-state-dev/core";
import { skillManifestKey } from "./collection";
import { getCollection as resolveCollection } from "./internal/get-collection";
import { listEnabledSkills } from "./internal/list-enabled-skills";
import { ensureSeeded } from "./seeding";
import { inlineActivate } from "./inline-activate";
import { createPatternRunRoute } from "./pattern-run";
import type { PatternRegistry } from "./pattern-registry";
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
  mode: z.enum(["inline", "fork", "pattern"]),
  message: z.string().optional(),
  result: z.unknown().optional(),
});

type RunSkillInput = z.infer<typeof inputSchema>;
type RunSkillOutput = z.infer<typeof outputSchema>;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface RunSkillToolOptions {
  /** Resource registry key for the skills collection. */
  collectionKey: string;
  /** Tool catalog used by pattern-mode workers to resolve `allowed-tools`. */
  catalog: ToolCatalog;
  /** Default-on initial skills, lazily seeded on first invocation. */
  initialSkills?: InitialSkill[];
  /** Optional override of the default model used by pattern-mode workers. */
  forkModelId?: string;
  /**
   * Optional pattern registry. When supplied, skills declaring `pattern:`
   * frontmatter dispatch through the pattern route; when absent, those
   * skills fail with a clear configuration error at activation.
   */
  patternRegistry?: PatternRegistry;
  /** Optional block-ref registry for pattern workers. */
  blockRegistry?: Record<string, BlockDefinition>;
  /** Optional AgentRegistry for pattern workers using `agent-ref`. */
  agentRegistry?: AgentRegistry;
  /** Optional capability catalog forwarded to the Agents primitive. */
  capabilityCatalog?: Record<string, DefinedCapability>;
  /** Injected materializer for `agent-ref` workers. */
  materializeAgent?: MaterializeAgentFn;
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
 * scope and tool catalog. Returns a `BlockDefinition` usable as a
 * `GeneratorTool` (router + handler + generator all satisfy the surface).
 */
export function createRunSkillTool(opts: RunSkillToolOptions) {
  const {
    collectionKey,
    catalog,
    initialSkills,
    forkModelId,
    patternRegistry,
    blockRegistry,
    agentRegistry,
    capabilityCatalog,
    materializeAgent,
  } = opts;

  const patternRoute = patternRegistry
    ? createPatternRunRoute({
        catalog,
        patternRegistry,
        ...(blockRegistry ? { blockRegistry } : {}),
        ...(agentRegistry ? { agentRegistry } : {}),
        ...(capabilityCatalog ? { capabilityCatalog } : {}),
        ...(materializeAgent ? { materializeAgent } : {}),
        ...(forkModelId ? { defaultModelId: forkModelId } : {}),
      })
    : undefined;

  const routes: BlockDefinition<typeof inputSchema, typeof outputSchema>[] = [
    inlineActivate,
  ] as unknown as BlockDefinition<typeof inputSchema, typeof outputSchema>[];
  if (patternRoute) {
    routes.push(
      patternRoute as unknown as BlockDefinition<typeof inputSchema, typeof outputSchema>,
    );
  }

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

      const mode = state.contextMode ?? "inline";
      if (mode === "inline") {
        // Inline branch: adapt input shape and pass output through as the
        // router's output (it already matches RunSkillOutput).
        return inlineActivate.connectInput(
          (raw: RunSkillInput) => ({
            skillName: raw.name,
            input: raw.input,
          }),
        ) as unknown as BlockDefinition<typeof inputSchema, typeof outputSchema>;
      }

      if (mode === "pattern") {
        if (!patternRoute) {
          throw new Error(
            `Skill "${input.name}" declares a pattern but no patternRegistry was supplied to createSkillsCapability`,
          );
        }
        const binding = state.patternBinding;
        if (!binding) {
          throw new Error(
            `Skill "${input.name}" has contextMode="pattern" but no patternBinding parsed — re-seed the skill`,
          );
        }
        const skillName = input.name;
        type AnyBlock = BlockDefinition<typeof inputSchema, typeof outputSchema>;
        // The patternRoute's input shape differs from runSkill's; bypass
        // the strict ConnectorFn typing via an `as unknown as AnyBlock` cast.
        // The pattern-run router will validate the payload at execute.
        return (patternRoute as unknown as {
          connectInput: (
            fn: (raw: RunSkillInput) => unknown,
          ) => {
            connectOutput: (fn: (result: unknown) => RunSkillOutput) => AnyBlock;
          };
        })
          .connectInput((raw) => ({
            skillName: raw.name,
            binding,
            input: raw.input,
            skillCollection: collection,
          }))
          .connectOutput((result) => ({
            skill: skillName,
            mode: "pattern" as const,
            result: result ?? null,
          }));
      }

      // Fork skills no longer dispatch here (FIX-919). They install per
      // generator via createSkillsLibrary's `fork` preset.
      throw new Error(
        `Skill "${input.name}" is a fork skill. Fork skills are invoked via the ` +
          `\`forkSkill\` tool installed by createSkillsLibrary's fork preset, not the ` +
          `runSkill router.`,
      );
    },
  });
}

