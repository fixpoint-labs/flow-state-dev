/**
 * Tombstone for the removed `createFSDProvider` API (FIX-633).
 *
 * The original model-groups API was conceptually replaced by
 * `createModelResolver({ intents })` in FIX-512/FIX-516, and now that
 * `intentDefaults` (FIX-633) covers the last remaining gap (per-intent
 * `providerOptions`), the legacy implementation is gone. The export is kept
 * for one minor version so downstream callers see a helpful migration error
 * instead of a missing-module crash.
 */

/**
 * @deprecated Removed in FIX-633. Migrate to {@link createModelResolver} with
 * `intents` and `intentDefaults`. Calling this function throws a runtime
 * error with migration guidance.
 */
export function createFSDProvider(_config: unknown): never {
  throw new Error(
    "createFSDProvider has been removed. Migrate to " +
      "createModelResolver({ intents, intentDefaults }). " +
      "Note: the legacy explain() introspection is no longer available — file " +
      "an issue if you depended on it. " +
      "See https://www.flow-state.dev/docs/fundamentals/models for the migration."
  );
}
