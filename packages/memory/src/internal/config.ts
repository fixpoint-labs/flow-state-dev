/**
 * Internal: tier-config resolution.
 *
 * Resolves the user-facing tier configs (`working` / `episodic` / `semantic`
 * / `digest`, each accepting `true` for defaults) into the concrete shapes
 * the tier capabilities and lifecycle blocks consume. Shared between
 * `createMemoryCapability` (tier-capability construction) and `system()`
 * (lifecycle-block construction) so the defaulting logic lives in one place
 * and cannot drift between the two entry points.
 *
 * Resolution produces plain config objects — never `defineResource()`
 * references — so sharing it has no bearing on the FIX-435
 * same-reference discipline (which governs resources, not configs).
 * Internal-only — not re-exported from the package index.
 */

import { DEFAULT_WORKING_MEMORY_CONFIG } from '../working-memory-helpers.js'
import type { WorkingMemoryHelperConfig } from '../working-memory-helpers.js'
import {
  DEFAULT_EPISODIC_CONFIG,
  DEFAULT_CONSOLIDATION_CONFIG,
  DEFAULT_PRUNE_CONFIG,
  DEFAULT_DIGEST_CONFIG,
} from '../memory-system.js'
import type {
  WorkingMemorySystemConfig,
  EpisodicMemoryConfig,
  SemanticMemoryConfig,
  DigestSystemConfig,
} from '../memory-system.js'

/** Concrete episodic config after defaulting. */
export interface ResolvedEpisodicConfig {
  scope: 'user' | 'org'
  significanceThreshold: number
  maxEpisodes: number
}

/** Concrete semantic config after defaulting. */
export interface ResolvedSemanticConfig {
  scope: 'user' | 'org'
  consolidation: {
    episodicThreshold: number
    onEviction: boolean
    minInterval: number
  }
  pruneThreshold: number
}

/** Concrete digest config after defaulting. Scope is inherited from semantic. */
export interface ResolvedDigestConfig {
  scope: 'user' | 'org'
  maxTokens: number
  topN: { facts: number; episodes: number }
}

/** The four resolved tier configs. Undefined tiers are omitted. */
export interface ResolvedMemoryConfigs {
  resolvedWorking: WorkingMemoryHelperConfig
  episodicConfig?: ResolvedEpisodicConfig
  semanticConfig?: ResolvedSemanticConfig
  digestConfig?: ResolvedDigestConfig
}

/** Subset of tier options both entry points share. */
export interface MemoryTierOptions {
  working: WorkingMemorySystemConfig | true
  episodic?: EpisodicMemoryConfig | true
  semantic?: SemanticMemoryConfig | true
  digest?: DigestSystemConfig | true
}

/**
 * Resolve the tier configs, applying defaults for `true` and omitted fields.
 *
 * Does NOT validate tier dependencies (semantic→episodic, digest→semantic) —
 * callers validate those up front so the error surfaces before any
 * construction. `digestConfig` is only produced when both `digest` and a
 * resolved `semanticConfig` are present (digest scope is inherited from
 * semantic).
 */
export function resolveMemoryConfigs(config: MemoryTierOptions): ResolvedMemoryConfigs {
  const workingConfig: WorkingMemorySystemConfig = config.working === true
    ? {}
    : config.working

  const resolvedWorking: WorkingMemoryHelperConfig = {
    capacity: workingConfig.capacity ?? DEFAULT_WORKING_MEMORY_CONFIG.capacity,
    maxPinnedSlots: workingConfig.maxPinnedSlots ?? DEFAULT_WORKING_MEMORY_CONFIG.maxPinnedSlots,
    decay: {
      strategy: workingConfig.decay?.strategy ?? DEFAULT_WORKING_MEMORY_CONFIG.decay.strategy,
      rate: workingConfig.decay?.rate ?? DEFAULT_WORKING_MEMORY_CONFIG.decay.rate,
    },
  }

  const episodicConfig: ResolvedEpisodicConfig | undefined = config.episodic
    ? {
        scope: (config.episodic === true ? DEFAULT_EPISODIC_CONFIG.scope : config.episodic.scope) ?? DEFAULT_EPISODIC_CONFIG.scope,
        significanceThreshold: config.episodic === true ? DEFAULT_EPISODIC_CONFIG.significanceThreshold : (config.episodic.significanceThreshold ?? DEFAULT_EPISODIC_CONFIG.significanceThreshold),
        maxEpisodes: config.episodic === true ? DEFAULT_EPISODIC_CONFIG.maxEpisodes : (config.episodic.maxEpisodes ?? DEFAULT_EPISODIC_CONFIG.maxEpisodes),
      }
    : undefined

  const semanticConfig: ResolvedSemanticConfig | undefined = config.semantic
    ? {
        scope: ((config.semantic === true
          ? (episodicConfig?.scope ?? DEFAULT_EPISODIC_CONFIG.scope)
          : config.semantic.scope) ?? (episodicConfig?.scope ?? DEFAULT_EPISODIC_CONFIG.scope)) as 'user' | 'org',
        consolidation: {
          episodicThreshold: config.semantic === true ? DEFAULT_CONSOLIDATION_CONFIG.episodicThreshold : (config.semantic.consolidation?.episodicThreshold ?? DEFAULT_CONSOLIDATION_CONFIG.episodicThreshold),
          onEviction: config.semantic === true ? DEFAULT_CONSOLIDATION_CONFIG.onEviction : (config.semantic.consolidation?.onEviction ?? DEFAULT_CONSOLIDATION_CONFIG.onEviction),
          minInterval: config.semantic === true ? DEFAULT_CONSOLIDATION_CONFIG.minInterval : (config.semantic.consolidation?.minInterval ?? DEFAULT_CONSOLIDATION_CONFIG.minInterval),
        },
        pruneThreshold: config.semantic === true ? DEFAULT_PRUNE_CONFIG.pruneThreshold : (config.semantic.pruneThreshold ?? DEFAULT_PRUNE_CONFIG.pruneThreshold),
      }
    : undefined

  const digestConfig: ResolvedDigestConfig | undefined = config.digest && semanticConfig
    ? {
        scope: semanticConfig.scope,
        maxTokens: config.digest === true
          ? DEFAULT_DIGEST_CONFIG.maxTokens
          : (config.digest.maxTokens ?? DEFAULT_DIGEST_CONFIG.maxTokens),
        topN: {
          facts: config.digest === true
            ? DEFAULT_DIGEST_CONFIG.topN.facts
            : (config.digest.topN?.facts ?? DEFAULT_DIGEST_CONFIG.topN.facts),
          episodes: config.digest === true
            ? DEFAULT_DIGEST_CONFIG.topN.episodes
            : (config.digest.topN?.episodes ?? DEFAULT_DIGEST_CONFIG.topN.episodes),
        },
      }
    : undefined

  return { resolvedWorking, episodicConfig, semanticConfig, digestConfig }
}
