/**
 * Configurable memory context formatter.
 *
 * Returns an object whose keys become nested XML tags under the parent key
 * the formatter is registered against. With `context: { memory: fn }` and a
 * return like `{ digest, working }`, the framework renders
 * `<memory><digest>…</digest><working>…</working></memory>`. Returning an
 * object (rather than a pre-formatted string with embedded tags) is what
 * lets the framework treat each tag as structure — string-leaf values are
 * XML-escaped before rendering, which would garble nested tags in the
 * combined system message.
 *
 * Four sections are supported:
 *
 * - `digest` — the rolling-summary narrative (FIX-408)
 * - `working` — current working-memory entries (FIX-199)
 * - `semantic` — top-N semantic facts by reinforcement count
 * - `episodic` — most recent episodes
 *
 * The capability presets in `memory-system.ts` use the small per-section
 * builders below (`createDigestEntry`, `createWorkingEntry`,
 * `createSemanticEntry`, `createEpisodicEntry`) so each preset contributes
 * just its own section under the shared `memory` context key — the
 * framework's context aggregator merges sibling object contributions there.
 *
 * `createMemoryContextFormatter(options?)` is the consumer-level factory
 * that bundles whichever sections the caller asks for into a single
 * function — useful when bypassing the capability presets to wire a custom
 * mix directly into a generator's `context: { memory: … }` slot.
 */
import { formatForContext } from './working-memory-helpers'
import { topFacts } from './semantic-memory-helpers'
import { recent as recentEpisodes } from './episodic-memory-helpers'
import type { Digest } from './digest-memory'
import type { SemanticFact } from './semantic-memory'
import type { Episode } from './episodic-memory'

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Default top-N facts injected when the semantic section is enabled. */
export const DEFAULT_SEMANTIC_TOP_N = 10

/** Default episode count injected when the episodic section is enabled. */
export const DEFAULT_EPISODIC_LIMIT = 5

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Object-shaped return type understood by the context aggregator. */
export type MemoryContextValue =
  | {
      digest?: string
      working?: string
      semantic?: string
      episodic?: string
    }
  | undefined

/** Section enable flag with optional limit knob (semantic). */
export type SemanticSectionOption = boolean | { topN?: number }

/** Section enable flag with optional limit knob (episodic). */
export type EpisodicSectionOption = boolean | { limit?: number }

/** Options for `createMemoryContextFormatter`. */
export interface MemoryContextFormatterOptions {
  /** Include the rolling digest. Default: true. No-op when no digest tier is configured. */
  digest?: boolean
  /** Include working memory entries. Default: true. */
  working?: boolean
  /** Include top-N semantic facts. Default: false. `topN` defaults to 10. */
  semantic?: SemanticSectionOption
  /** Include most-recent episodes. Default: false. `limit` defaults to 5. */
  episodic?: EpisodicSectionOption
}

// ---------------------------------------------------------------------------
// Per-section builders — used by the capability presets
// ---------------------------------------------------------------------------

/**
 * Returns a context entry function that emits `{ digest: string }` or
 * `undefined`. Defensive against a missing/uninitialised digest resource so a
 * generator running before the digest is first persisted just skips the
 * section instead of throwing.
 */
export function createDigestEntry(): (
  _input: unknown,
  ctx: any,
) => { digest: string } | undefined {
  return function digestEntry(_input, ctx) {
    let digestText = ''
    try {
      const digestRef = ctx.resources?.digestMemory
      const stored = digestRef?.state?.digest as Digest | undefined
      digestText = stored?.content?.trim() ?? ''
    } catch {
      // Digest resource not available in this scope; treat as absent.
    }
    if (!digestText) return undefined
    return { digest: digestText }
  }
}

/**
 * Returns a context entry function that emits `{ working: string }` or
 * `undefined`. Reads the working-memory resource and renders its current
 * entries via `formatForContext` (salience-sorted bullet list).
 */
export function createWorkingEntry(): (
  _input: unknown,
  ctx: any,
) => { working: string } | undefined {
  return function workingEntry(_input, ctx) {
    const wmRef = ctx.resources?.workingMemory
    const workingText = wmRef ? formatForContext(wmRef) : ''
    if (!workingText) return undefined
    return { working: workingText }
  }
}

/**
 * Returns a context entry function that emits `{ semantic: string }` or
 * `undefined`. Pulls the top-N semantic facts by reinforcement count via the
 * shared `topFacts` helper so the selection matches what the digest sees.
 */
export function createSemanticEntry(
  options?: { topN?: number },
): (_input: unknown, ctx: any) => { semantic: string } | undefined {
  const topN = options?.topN ?? DEFAULT_SEMANTIC_TOP_N
  return function semanticEntry(_input, ctx) {
    let facts: SemanticFact[] = []
    try {
      const semRef = ctx.resources?.semanticMemory
      facts = semRef ? topFacts(semRef, topN) : []
    } catch {
      // Semantic resource not available in this scope; treat as absent.
    }
    if (facts.length === 0) return undefined
    return { semantic: formatFacts(facts) }
  }
}

/**
 * Returns a context entry function that emits `{ episodic: string }` or
 * `undefined`. Pulls the most-recent N episodes (by `occurredAtTurn`
 * descending). Recency-only ordering matches the user expectation of "what
 * happened recently" — digest-style significance ranking is reserved for
 * digest regeneration where a longer-horizon view matters.
 */
export function createEpisodicEntry(
  options?: { limit?: number },
): (_input: unknown, ctx: any) => { episodic: string } | undefined {
  const limit = options?.limit ?? DEFAULT_EPISODIC_LIMIT
  return function episodicEntry(_input, ctx) {
    let episodes: Episode[] = []
    try {
      const epRef = ctx.resources?.episodicMemory
      episodes = epRef ? recentEpisodes(epRef, limit) : []
    } catch {
      // Episodic resource not available in this scope; treat as absent.
    }
    if (episodes.length === 0) return undefined
    return { episodic: formatEpisodes(episodes) }
  }
}

// ---------------------------------------------------------------------------
// Bundled factory — single function combining whichever sections are enabled
// ---------------------------------------------------------------------------

/**
 * Build a single context formatter that combines whichever sections the
 * caller asks for. With no options, defaults to `{ digest: true, working:
 * true }` — the same behaviour as the previous `mem.contextFormatter`. Pass
 * `semantic` / `episodic` to opt into the richer sections; pass `false` for
 * any default-on section to suppress it.
 *
 * Use this when bypassing the capability's preset machinery — for example,
 * to inject a custom mix into a generator's `context: { memory: … }` slot
 * with non-default `topN` / `limit` values.
 */
export function createMemoryContextFormatter(
  options?: MemoryContextFormatterOptions,
): (_input: unknown, ctx: any) => MemoryContextValue {
  const includeDigest = options?.digest !== false
  const includeWorking = options?.working !== false

  const semanticOption = options?.semantic
  const includeSemantic =
    semanticOption === true ||
    (typeof semanticOption === 'object' && semanticOption !== null)
  const semanticOpts =
    typeof semanticOption === 'object' && semanticOption !== null
      ? semanticOption
      : undefined

  const episodicOption = options?.episodic
  const includeEpisodic =
    episodicOption === true ||
    (typeof episodicOption === 'object' && episodicOption !== null)
  const episodicOpts =
    typeof episodicOption === 'object' && episodicOption !== null
      ? episodicOption
      : undefined

  const digestEntry = includeDigest ? createDigestEntry() : undefined
  const workingEntry = includeWorking ? createWorkingEntry() : undefined
  const semanticEntry = includeSemantic ? createSemanticEntry(semanticOpts) : undefined
  const episodicEntry = includeEpisodic ? createEpisodicEntry(episodicOpts) : undefined

  return function memoryContextFormatter(input, ctx) {
    const out: NonNullable<MemoryContextValue> = {}
    if (digestEntry) {
      const part = digestEntry(input, ctx)
      if (part) out.digest = part.digest
    }
    if (workingEntry) {
      const part = workingEntry(input, ctx)
      if (part) out.working = part.working
    }
    if (semanticEntry) {
      const part = semanticEntry(input, ctx)
      if (part) out.semantic = part.semantic
    }
    if (episodicEntry) {
      const part = episodicEntry(input, ctx)
      if (part) out.episodic = part.episodic
    }
    if (Object.keys(out).length === 0) return undefined
    return out
  }
}

// ---------------------------------------------------------------------------
// Internal text formatters
// ---------------------------------------------------------------------------

function formatFacts(facts: SemanticFact[]): string {
  return facts
    .map((f) => `- (${f.category}) [subject=${f.subject}] ${f.content}`)
    .join('\n')
}

function formatEpisodes(episodes: Episode[]): string {
  return episodes
    .map((e) => `- (${e.category}, turn ${e.occurredAtTurn}) ${e.content}`)
    .join('\n')
}
