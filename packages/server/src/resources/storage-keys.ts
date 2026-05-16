/**
 * Accessor → storage-key resolution for resource registries.
 *
 * Two `resources:` accessors that point at the same `DefinedResource`
 * object share a single persisted storage slot — the canonical key is
 * the config's `ref` when set, otherwise the first accessor encountered
 * in declaration order. Collections aren't single-slot resources; their
 * instances use pattern-derived keys, so collection accessors map to
 * themselves.
 *
 * Lives in its own module so both `createExecutionContext` and
 * `routes/route-utils` can import it without creating a cycle through
 * `resources/internal.ts`.
 *
 * FIX-591: resource state is keyed by ref identity, not accessor name.
 *
 * ## Stability of the canonical key
 *
 * When `config.ref` is set, the canonical key is `ref` — stable across
 * deploys, refactors, and declaration-order changes. **Set `ref`
 * explicitly on `defineResource()` for any non-session-scoped resource
 * you intend to dual-register**: persisted user/org data only survives
 * declaration reshuffles if the storage key is anchored to a stable
 * value rather than an accessor name.
 *
 * Without `ref`, the canonical key is the first accessor encountered in
 * `Object.entries(configs)` order. For a single accessor this is the
 * accessor name itself (stable). For dual-registered aliases the chosen
 * key depends on how block-level resource declarations bubble up into
 * `flow.resources` — reorganising actions, swapping sibling blocks, or
 * moving a declaration from block-level to flow-level can shift it. For
 * session-scoped resources this is harmless (session storage is
 * transient); for user/org scope it can orphan data.
 */
import type { ResourceCollectionConfig } from "@flow-state-dev/core/types";

function isCollectionConfig(value: unknown): value is ResourceCollectionConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "pattern" in value &&
    typeof (value as ResourceCollectionConfig).pattern === "string"
  );
}

/**
 * Build `accessor → storage key` mapping for a per-scope resource config
 * map. See module header for the canonicalization rule.
 */
export function resourceStorageKeys(
  configs: Record<string, unknown> | undefined
): Record<string, string> {
  const result: Record<string, string> = {};
  if (configs === undefined) return result;

  const canonicalByConfig = new Map<unknown, string>();
  for (const [accessor, config] of Object.entries(configs)) {
    if (isCollectionConfig(config)) {
      result[accessor] = accessor;
      continue;
    }
    const seen = canonicalByConfig.get(config);
    if (seen !== undefined) {
      result[accessor] = seen;
      continue;
    }
    const ref = (config as { ref?: unknown } | null | undefined)?.ref;
    const canonical = typeof ref === "string" && ref.length > 0 ? ref : accessor;
    canonicalByConfig.set(config, canonical);
    result[accessor] = canonical;
  }
  return result;
}
