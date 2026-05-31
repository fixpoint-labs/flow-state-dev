/**
 * Composed memory capability factory.
 *
 * `createMemoryCapability(options)` builds the same `defineCapability` that
 * `system()` composes internally — four memory tiers, the recall tool, and
 * the orthogonal section presets — but without the write-side lifecycle
 * pipeline (capture, consolidation, prune, hygiene janitor). It is one of two
 * parallel entry points: reach for this factory when a flow only consumes
 * memory (context injection, recall, helpers); reach for `system()` when the
 * flow also captures into memory.
 *
 * The factory returns the capability with `sessionResources`, `userResources`,
 * `tiers`, and `recallToolBlock` attached on the same object (the
 * `createBashCapability` precedent of `DefinedCapability & { extension }`), so
 * the same `defineResource()` references travel with the capability and can be
 * registered at the flow level without divergence (FIX-435).
 */

import { defineCapability } from '@flow-state-dev/core'
import type { DefinedCapability, CapabilityRef } from '@flow-state-dev/core'

import {
  memorySystemResource,
  type WorkingMemorySystemConfig,
  type EpisodicMemoryConfig,
  type SemanticMemoryConfig,
  type DigestSystemConfig,
  type MemoryToolConfig,
  type HygieneConfig,
} from './memory-system'
import { workingMemoryResource } from './working-memory'
import { createEpisodicMemoryResource } from './episodic-memory'
import { createSemanticMemoryResource } from './semantic-memory'
import { createDigestMemoryResource } from './digest-memory'
import {
  createWorkingMemoryCapability,
  createEpisodicMemoryCapability,
  createSemanticMemoryCapability,
  createDigestMemoryCapability,
} from './capabilities'
import {
  createDigestEntry,
  createWorkingEntry,
  createSemanticEntry,
  createEpisodicEntry,
} from './formatter'
import { createRecallTool } from './tools/recall-tool'
import { resolveStrategy } from './tools/strategies/index'
import { buildRecall } from './internal/recall'
import { resolveHygieneConfig } from './internal/hygiene-config'
import { resolveMemoryConfigs } from './internal/config'
import type { ResolvedMemoryConfigs } from './internal/config'
import type { ResolvedHygieneConfig } from './janitor-blocks'

/**
 * Options for `createMemoryCapability`. The subset of `MemorySystemConfig`
 * that drives capability construction; lifecycle-side options (`source`,
 * `maxAssistantChars`, `consolidationModel`, `pruneModel`, `name`,
 * `inputSchema`) are intentionally excluded — they belong to `system()`.
 */
export interface CreateMemoryCapabilityOptions {
  /** Default model id (or fallback chain) for the recall tool's filter call. Required. */
  model: string | string[]
  /** Working memory config. `true` for defaults. Required. */
  working: WorkingMemorySystemConfig | true
  /** Episodic memory config. `true` for defaults. Omit to disable. */
  episodic?: EpisodicMemoryConfig | true
  /** Semantic memory config. `true` for defaults. Omit to disable. Requires episodic. */
  semantic?: SemanticMemoryConfig | true
  /** Digest tier config. `true` for defaults. Omit to disable. Requires semantic. */
  digest?: DigestSystemConfig | true
  /** Recall-tool config. Omit to use defaults (`llm-filter` strategy). */
  tool?: MemoryToolConfig
  /**
   * Memory hygiene configuration (FIX-411). Only the `confidenceDecay` slice
   * affects this capability — it drives recall ranking. Janitor scheduling is
   * a lifecycle concern owned by `system()`.
   */
  hygiene?: HygieneConfig | true | false
}

/** The resource maps a caller spreads into `defineFlow`'s `resources`. */
export interface MemoryCapabilityResources {
  sessionResources: {
    workingMemory: typeof workingMemoryResource
    memorySystem: typeof memorySystemResource
  }
  userResources: {
    episodicMemory?: ReturnType<typeof createEpisodicMemoryResource>
    semanticMemory?: ReturnType<typeof createSemanticMemoryResource>
    digestMemory?: ReturnType<typeof createDigestMemoryResource>
  }
}

/**
 * The composed memory capability returned by `createMemoryCapability`.
 *
 * Extends `DefinedCapability` with the typed resource maps, the per-tier
 * capabilities, and the recall tool block. Install via `uses: [memCap]` on a
 * generator; register `{ ...memCap.sessionResources, ...memCap.userResources }`
 * on the flow.
 *
 * For type-safe resource access, use `sessionResources` / `userResources` —
 * `tiers.*.resources` is typed broadly (`DeclaredResourceEntry`) and is only
 * for installing a single tier in isolation via `uses: [memCap.tiers.working]`.
 */
export interface MemoryCapability extends DefinedCapability {
  readonly sessionResources: MemoryCapabilityResources['sessionResources']
  readonly userResources: MemoryCapabilityResources['userResources']
  readonly tiers: {
    working: CapabilityRef
    episodic?: CapabilityRef
    semantic?: CapabilityRef
    digest?: CapabilityRef
  }
  readonly recallToolBlock: ReturnType<typeof createRecallTool>
}

/**
 * The composed capability plus the intermediate values its construction
 * produced. Returned by `buildMemoryCapability` so `system()` can reuse the
 * resolved configs, hygiene, and recall helper in a single pass rather than
 * re-resolving them. Internal to the package — `createMemoryCapability` is the
 * public entry and returns only `capability`.
 */
export interface BuiltMemoryCapability {
  capability: MemoryCapability
  /** Resolved tier configs — the same the lifecycle blocks in `system()` need. */
  resolved: ResolvedMemoryConfigs
  /** Resolved hygiene config (`false` when disabled). */
  hygiene: false | ResolvedHygieneConfig
  /** The standalone cross-store recall helper wired into `fns.recall`. */
  recall: ReturnType<typeof buildRecall>
}

/**
 * Build the composed memory capability and return it alongside the resolved
 * configs, hygiene, and recall helper produced along the way.
 *
 * Validates tier dependencies (semantic requires episodic, digest requires
 * semantic) and the required `model` up front, then constructs the tier
 * capabilities, the recall tool, and the `defineCapability` with five
 * orthogonal section presets (`digest`, `working`, `semantic`, `episodic`,
 * `recall`; defaults `['digest', 'working', 'recall']`).
 *
 * Internal — exported for `system()` so it can reuse the intermediate values
 * without re-resolving. Not re-exported from the package index; external
 * callers use `createMemoryCapability`.
 */
export function buildMemoryCapability(
  options: CreateMemoryCapabilityOptions,
): BuiltMemoryCapability {
  // Validate: semantic requires episodic
  if (options.semantic && !options.episodic) {
    throw new Error('Semantic memory requires episodic memory to be configured')
  }

  // Validate: digest requires semantic
  if (options.digest && !options.semantic) {
    throw new Error('Digest requires semantic memory to be configured')
  }

  // Validate: model is required for the recall tool's filter strategy.
  // TypeScript enforces this at compile time; this guard catches untyped callers.
  if (options.model == null || (Array.isArray(options.model) && options.model.length === 0)) {
    throw new Error('createMemoryCapability requires a `model` for the recall tool')
  }

  const resolved = resolveMemoryConfigs(options)
  const { resolvedWorking, episodicConfig, semanticConfig, digestConfig } = resolved

  // Resolve hygiene — only the confidence-decay slice is consumed here (recall
  // ranking). Janitor scheduling is acted on by `system()`, not the capability.
  const hygiene = resolveHygieneConfig(options.hygiene)

  // Create tier capabilities FIRST — these own the resource references.
  const wmCapability = createWorkingMemoryCapability(resolvedWorking)

  const epCapability = episodicConfig
    ? createEpisodicMemoryCapability({
        scope: episodicConfig.scope,
        maxEpisodes: episodicConfig.maxEpisodes,
      })
    : undefined

  const semCapability = semanticConfig
    ? createSemanticMemoryCapability({
        scope: semanticConfig.scope,
      })
    : undefined

  const digestCapability = digestConfig
    ? createDigestMemoryCapability({ scope: digestConfig.scope })
    : undefined

  // Extract typed resource references from the tier capabilities. Cast
  // required: capability types store resources as DeclaredResourceEntry
  // (broad), but callers want the specific resource types.
  const episodicResource = epCapability
    ? epCapability.resources!.episodicMemory as ReturnType<typeof createEpisodicMemoryResource>
    : undefined

  const semanticResource = semCapability
    ? semCapability.resources!.semanticMemory as ReturnType<typeof createSemanticMemoryResource>
    : undefined

  const digestResource = digestCapability
    ? digestCapability.resources!.digestMemory as ReturnType<typeof createDigestMemoryResource>
    : undefined

  // Build the recall tool (FIX-409). The strategy uses a single model id (no
  // fallback chain); pick the primary entry when `model` is an array. Callers
  // override explicitly via `tool.model`.
  const toolConfig = options.tool ?? {}
  const fallbackPrimary = Array.isArray(options.model) ? options.model[0] : options.model
  const recallStrategy = resolveStrategy(toolConfig.strategy ?? 'llm-filter', {
    model: toolConfig.model ?? fallbackPrimary,
  })
  const recallToolBlock = createRecallTool({
    strategy: recallStrategy,
    defaults: toolConfig.defaults,
  })

  // Build the recall helper (ranking decay derived from hygiene).
  const recallFn = buildRecall(
    episodicConfig ? { scope: episodicConfig.scope } : undefined,
    semanticConfig ? { scope: semanticConfig.scope } : undefined,
    hygiene,
  )

  // Compose the unified memory capability
  const capUses: CapabilityRef[] = [wmCapability]
  if (epCapability) capUses.push(epCapability)
  if (semCapability) capUses.push(semCapability)
  if (digestCapability) capUses.push(digestCapability)

  const composedCapability = defineCapability({
    name: 'memory' as const,
    uses: capUses,
    resources: { memorySystem: memorySystemResource },
    fns: (ctx: any) => ({
      /** Cross-store recall — queries all configured stores, deduplicates, ranks by relevance. */
      recall: (cue?: string) => recallFn(ctx, cue),
    }),
    presets: {
      /**
       * Inject the rolling digest into the prompt under
       * `<memory><digest>…</digest></memory>`. Default-on. No-op when no
       * digest tier is configured — the entry's function returns `undefined`
       * and the framework drops the section.
       */
      digest: digestConfig
        ? { context: { memory: createDigestEntry() } }
        : {},
      /**
       * Inject working-memory entries under
       * `<memory><working>…</working></memory>`. Default-on. Working memory
       * is the base tier, so this is always wired when memory is enabled.
       */
      working: {
        context: { memory: createWorkingEntry() },
      },
      /**
       * Inject the top-N semantic facts under
       * `<memory><semantic>…</semantic></memory>`. Default-off. Uses a fixed
       * default top-N; reach for `createMemoryContextFormatter` directly for a
       * custom limit. No-op when no semantic tier is configured.
       */
      semantic: semanticConfig
        ? { context: { memory: createSemanticEntry() } }
        : {},
      /**
       * Inject the most-recent episodes under
       * `<memory><episodic>…</episodic></memory>`. Default-off. Uses a fixed
       * default count; reach for `createMemoryContextFormatter` directly for a
       * custom limit. No-op when no episodic tier is configured.
       */
      episodic: episodicConfig
        ? { context: { memory: createEpisodicEntry() } }
        : {},
      /**
       * Install the `memory/recall` tool so the model can search semantic
       * facts and past episodes on demand. Default-on. No-op when neither
       * episodic nor semantic is configured (recall has nothing to search).
       */
      recall: {
        context: { memory: {
          additional: "There are additional memories available then what are included within this context. Use the memory_recall tool to access them when you are being asked for information that is not already included in this context, or in which there might be more useful information available. Before saying you don’t know, check memory for any relevant context first."
        }},
        tools: () => [recallToolBlock],
      },
      default: ['digest', 'working', 'recall'],
    },
  })

  const sessionResources: MemoryCapabilityResources['sessionResources'] = {
    workingMemory: workingMemoryResource,
    memorySystem: memorySystemResource,
  }

  const userResources: MemoryCapabilityResources['userResources'] = {
    ...(episodicResource ? { episodicMemory: episodicResource } : {}),
    ...(semanticResource ? { semanticMemory: semanticResource } : {}),
    ...(digestResource ? { digestMemory: digestResource } : {}),
  }

  const tiers: MemoryCapability['tiers'] = {
    working: wmCapability,
    ...(epCapability ? { episodic: epCapability } : {}),
    ...(semCapability ? { semantic: semCapability } : {}),
    ...(digestCapability ? { digest: digestCapability } : {}),
  }

  const capability = Object.assign(composedCapability, {
    sessionResources,
    userResources,
    tiers,
    recallToolBlock,
  }) as MemoryCapability

  return { capability, resolved, hygiene, recall: recallFn }
}

/**
 * Build the composed memory capability for the configured tiers.
 *
 * One of two parallel entry points (see `system()`). Returns a
 * `DefinedCapability` extended with `sessionResources`, `userResources`,
 * `tiers`, and `recallToolBlock` — install it on a generator with
 * `uses: [mem]` and register `{ ...mem.sessionResources, ...mem.userResources }`
 * on the flow.
 */
export function createMemoryCapability(
  options: CreateMemoryCapabilityOptions,
): MemoryCapability {
  return buildMemoryCapability(options).capability
}
