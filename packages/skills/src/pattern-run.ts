/**
 * Pattern dispatch route for the `runSkill` tool.
 *
 * Activating a `mode: "pattern"` skill routes through here. The inner
 * router is permissive (`validateRoute: () => true`) because the
 * dispatched block is built dynamically per-invocation from the
 * registered pattern factory — strict identity-based validation can't
 * match a freshly-constructed block. The outer `runSkill` router's
 * validation stays intact; this is internal infrastructure not exposed
 * as a user-extension surface.
 */

import { z } from "zod";
import { router } from "@flow-state-dev/core";
import type {
  AgentRegistry,
  DefinedCapability,
  PatternBinding,
  ResourceCollectionRef,
  ToolCatalog,
} from "@flow-state-dev/core";
import type { BlockContext, BlockDefinition } from "@flow-state-dev/core/types";
import { pushActiveSkill, readActiveSkills, type ActiveSkillEntry } from "./active-skill-state";
import type { PatternRegistry, PatternRegistryDeps } from "./pattern-registry";

const patternRunInputSchema = z.object({
  skillName: z.string(),
  binding: z.unknown(),
  input: z.string().optional(),
  skillCollection: z.unknown(),
});

type PatternRunInput = {
  skillName: string;
  binding: PatternBinding;
  input?: string;
  skillCollection: ResourceCollectionRef;
};

const patternRunOutputSchema = z.unknown();

export interface PatternRunRouterOptions {
  /** Tool catalog forwarded into worker materialization. */
  catalog: ToolCatalog;
  /** Required: the pattern registry to resolve `binding.pattern` against. */
  patternRegistry: PatternRegistry;
  /** Optional block-ref registry threaded to materializeWorker. */
  blockRegistry?: Record<string, BlockDefinition>;
  /** Optional AgentRegistry for `agent-ref` workers (Agents primitive slot). */
  agentRegistry?: AgentRegistry;
  /** Optional capability catalog (Agents primitive slot). */
  capabilityCatalog?: Record<string, DefinedCapability>;
  /** Default model id when a worker omits its own. */
  defaultModelId?: string;
}

/**
 * Build the pattern-route router. Wired into `createRunSkillTool` as a
 * third route alongside `inlineActivate` and `forkGen`.
 */
export function createPatternRunRoute(
  opts: PatternRunRouterOptions,
): BlockDefinition {
  const {
    catalog,
    patternRegistry,
    blockRegistry,
    agentRegistry,
    capabilityCatalog,
    defaultModelId,
  } = opts;

  return router({
    name: "skillPatternRun",
    description: "Runs a SKILL.md pattern declaration.",
    inputSchema: patternRunInputSchema,
    outputSchema: patternRunOutputSchema,
    // Empty routes + permissive validator: the dispatched block is built
    // dynamically per call. The outer runSkill router's strict identity
    // check still validates this whole block against its routes array;
    // only the dynamic stage is permissive.
    routes: [],
    validateRoute: () => true,
    execute: async (raw, ctx) => {
      const input = raw as PatternRunInput;
      const binding = input.binding;
      const factory = patternRegistry.get(binding.pattern);
      if (!factory) {
        const available = patternRegistry
          .list()
          .map((f) => f.key)
          .join(", ");
        throw new Error(
          `Pattern '${binding.pattern}' not in registry. Available: ${available}`,
        );
      }

      // Validate kebab-case patternConfig against the factory's schema.
      const parsed = factory.configSchema.safeParse(binding.patternConfig ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
          .join("; ");
        throw new Error(
          `Pattern '${binding.pattern}' config rejected by schema: ${issues}`,
        );
      }

      const deps: PatternRegistryDeps = {
        catalog,
        ...(blockRegistry ? { blocks: blockRegistry } : {}),
        ...(agentRegistry ? { agentRegistry } : {}),
        ...(capabilityCatalog ? { capabilityCatalog } : {}),
        skillName: input.skillName,
        skillCollection: input.skillCollection,
        ...(defaultModelId ? { defaultModelId } : {}),
        ...(input.input !== undefined ? { input: input.input } : {}),
      };

      const materialized = await factory.fromConfig(binding, deps, ctx);

      // Stamp the active-skill entry so taskTools and the badge can find
      // the live collection metadata.
      await recordActivePatternEntry(ctx, input.skillName, input.input, binding, {
        collectionId: materialized.collectionId,
        backing: materialized.backing,
        ...(materialized.resourceCollectionKey
          ? { resourceCollectionKey: materialized.resourceCollectionKey }
          : {}),
      });

      return materialized.block as BlockDefinition<typeof patternRunInputSchema, typeof patternRunOutputSchema>;
    },
  });
}

async function recordActivePatternEntry(
  ctx: BlockContext,
  skillName: string,
  input: string | undefined,
  binding: PatternBinding,
  pattern: {
    collectionId: string;
    backing: "request" | "resource";
    resourceCollectionKey?: string;
  },
): Promise<void> {
  const session = (ctx as unknown as { session?: { state?: unknown; patchState?: (u: unknown) => Promise<unknown> } }).session;
  if (!session?.patchState) return;
  const current = readActiveSkills(session.state);
  const entry: ActiveSkillEntry = {
    name: skillName,
    mode: "pattern",
    input,
    activatedAt: Date.now(),
    pattern: {
      patternKey: binding.pattern,
      collectionId: pattern.collectionId,
      backing: pattern.backing,
      ...(pattern.resourceCollectionKey
        ? { resourceCollectionKey: pattern.resourceCollectionKey }
        : {}),
    },
  };
  await session.patchState({ activeSkills: pushActiveSkill(current, entry) });
}
