/**
 * Shared shape for the hand-built resource refs memory's tests pass to tier
 * code. Each mock stubs only the ref members that code reads.
 */
import type { JsonObject, ResourceRef } from '@flow-state-dev/core/types'

/** Types a hand-built mock ref as a full `ResourceRef<TState>`, keeping its methods contextually typed. */
export function partialRef<TState extends JsonObject>(
  ref: Partial<ResourceRef<TState>> & { name?: string },
): ResourceRef<TState> {
  // Deliberately partial: tier code never reaches the members a mock omits.
  return ref as unknown as ResourceRef<TState>
}
