/**
 * Internal: the tier resource a lifecycle block uses.
 *
 * `system()` hands every block the capability's own resources
 * (`_episodicResource` and siblings), so the blocks and the capability share
 * one `defineResource()` reference. A block built without them falls back to
 * a fresh resource from its tier config, which must carry the tier's
 * `flowIsolation` or it keys somewhere the capability never writes.
 */
import { createEpisodicMemoryResource } from '../episodic-memory'
import { createSemanticMemoryResource } from '../semantic-memory'
import { createDigestMemoryResource } from '../digest-memory'

type TierConfig = { scope: 'user' | 'org'; flowIsolation?: boolean }

/** The episodic resource: the shared one, else one built from `episodic`, else none. */
export function episodicResourceOf(config: {
  episodic?: TierConfig
  _episodicResource?: ReturnType<typeof createEpisodicMemoryResource>
}) {
  return config._episodicResource ?? (config.episodic
    ? createEpisodicMemoryResource(config.episodic.scope, { flowIsolation: config.episodic.flowIsolation })
    : undefined)
}

/** The semantic resource: the shared one, else one built from `semantic`, else none. */
export function semanticResourceOf(config: {
  semantic?: TierConfig
  _semanticResource?: ReturnType<typeof createSemanticMemoryResource>
}) {
  return config._semanticResource ?? (config.semantic
    ? createSemanticMemoryResource(config.semantic.scope, undefined, { flowIsolation: config.semantic.flowIsolation })
    : undefined)
}

/** The digest resource: the shared one, else one built from `digest`. */
export function digestResourceOf(config: {
  digest: TierConfig
  _digestResource?: ReturnType<typeof createDigestMemoryResource>
}) {
  return config._digestResource ?? createDigestMemoryResource(config.digest.scope, { flowIsolation: config.digest.flowIsolation })
}
