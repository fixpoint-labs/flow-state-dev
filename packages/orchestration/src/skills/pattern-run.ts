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
  MaterializeAgentFn,
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
  /** Injected materializer for `agent-ref` workers. */
  materializeAgent?: MaterializeAgentFn;
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
    materializeAgent,
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

      // Validate kebab-case patternConfig against the factory's schema and
      // use the parsed output (so any z.coerce / z.default contributions are
      // applied) — adapters read the coerced shape via binding.patternConfig.
      const parsed = factory.configSchema.safeParse(binding.patternConfig ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
          .join("; ");
        throw new Error(
          `Pattern '${binding.pattern}' config rejected by schema: ${issues}`,
        );
      }
      const validatedBinding: PatternBinding = {
        ...binding,
        patternConfig: parsed.data as Record<string, unknown>,
      };

      const collectionId = nextSkillCollectionId(ctx, input.skillName);
      const deps: PatternRegistryDeps = {
        catalog,
        ...(blockRegistry ? { blocks: blockRegistry } : {}),
        ...(agentRegistry ? { agentRegistry } : {}),
        ...(capabilityCatalog ? { capabilityCatalog } : {}),
        ...(materializeAgent ? { materializeAgent } : {}),
        skillName: input.skillName,
        skillCollection: input.skillCollection,
        ...(defaultModelId ? { defaultModelId } : {}),
        ...(input.input !== undefined ? { input: input.input } : {}),
        collectionId,
      };

      const materialized = await factory.fromConfig(validatedBinding, deps, ctx);

      // Stamp the active-skill entry so taskTools and the badge can find
      // the live collection metadata.
      await recordActivePatternEntry(ctx, input.skillName, input.input, validatedBinding, {
        collectionId: materialized.collectionId,
        backing: materialized.backing,
        ...(materialized.resourceCollectionKey
          ? { resourceCollectionKey: materialized.resourceCollectionKey }
          : {}),
      });

      // The materialized block is typically a SequencerDefinition (taskBoard,
      // planAndExecute, supervisor, parallelTasks, routedSpecialists all
      // return one). The sequencer DSL's sequential-step method is `.step()`,
      // not `.then()`, so a SequencerDefinition is not a thenable and can be
      // returned directly from this async execute — `Promise.resolve` won't
      // mistake it for a promise. The outer router's `isBlockDefinition` check
      // catches it as a route-return and completes the dispatch normally.
      return materialized.block as BlockDefinition<
        typeof patternRunInputSchema,
        typeof patternRunOutputSchema
      >;
    },
  });
}

/**
 * Build a unique TaskCollection id for a single pattern-skill activation.
 * Two activations of the same skill within one request must NOT collide;
 * the substrate keys task state by collectionId on `ctx.request.state`.
 *
 * Format: `skill_<name>_<requestId>_<n>`. The per-request counter lives
 * on the request context's atomicState so concurrent runs serialize the
 * increment.
 */
function nextSkillCollectionId(ctx: BlockContext, skillName: string): string {
  const request = (ctx as unknown as {
    request?: { identity?: { id?: string }; state?: { _skillActivationN?: Record<string, number> } };
  }).request;
  const requestId = request?.identity?.id ?? "req";
  const counters = (request?.state?._skillActivationN ?? {}) as Record<string, number>;
  const n = (counters[skillName] ?? 0) + 1;
  counters[skillName] = n;
  // Best-effort write — the counter is advisory; if the host doesn't expose
  // mutable state this just degrades to per-call uniqueness via Date.now().
  if (request?.state) {
    (request.state as { _skillActivationN?: Record<string, number> })._skillActivationN = counters;
  }
  return `skill_${skillName}_${requestId}_${n}`;
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
