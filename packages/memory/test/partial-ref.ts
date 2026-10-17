/**
 * Shared in-memory resource ref for memory's tests: each factory passes a
 * name, scope, schema and initial state, and gets working state methods.
 */
import type { JsonObject, ResourceRef, ResourceScope } from '@flow-state-dev/core/types'

/** Tests never reach the omitted members. */
export function partialRef<TState extends JsonObject>(
  name: string,
  scope: ResourceScope,
  stateSchema: ResourceRef<TState>['config']['stateSchema'],
  initial: TState,
): ResourceRef<TState> {
  let state = initial
  const ref: Omit<
    ResourceRef<TState>,
    'path' | 'uri' | 'incState' | 'pushState' | 'getOrPatchState' | 'readContentRaw'
  > & { name: string } = {
    name,
    scope,
    get state() { return state },
    async patchState(updates) {
      state = { ...state, ...updates } as TState
    },
    async setState(next) {
      state = next
    },
    async updateState(fn) {
      state = await fn(state)
    },
    async readContent() {
      return JSON.stringify(state)
    },
    async writeContent() {},
    config: { scope, stateSchema, writable: true },
  }
  return ref as unknown as ResourceRef<TState>
}
