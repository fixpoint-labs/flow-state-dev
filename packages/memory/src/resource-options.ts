/**
 * Options the memory resource factories share. A leaf module, so the three
 * tier files import it without importing each other.
 */

/** Options the memory resource factories share. */
export interface MemoryResourceOptions {
  /**
   * The resource's own `flowIsolation`. `true` keys the store per flow
   * instance, `false` shares it across flows, and either wins over the flow's
   * `isolateUserState` / `isolateOrgState` default. Omit it to take that default.
   */
  flowIsolation?: boolean
}

/** The `flowIsolation` entry a factory spreads into `defineResource`, empty when unset. */
export function flowIsolationEntry(options?: MemoryResourceOptions): { flowIsolation?: boolean } {
  return options?.flowIsolation === undefined ? {} : { flowIsolation: options.flowIsolation }
}
