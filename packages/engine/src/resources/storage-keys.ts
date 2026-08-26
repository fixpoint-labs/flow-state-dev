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
import { isCollectionConfig } from "./is-collection-config";

/**
 * Build `accessor → storage key` mapping for a per-scope resource config
 * map. See module header for the canonicalization rule.
 */
export function resourceStorageKeys(
  configs: Record<string, unknown> | undefined
): Record<string, string> {
  // Null-prototype: accessor names are author-supplied and are used as keys
  // here. On a plain `{}` an accessor of `__proto__` writes through the
  // inherited setter — with a string value that is a silent no-op, so no own
  // mapping is created and every reader below falls through to
  // `Object.prototype`, which then persists as the key `"[object Object]"`.
  // Callers would disagree about where that resource lives. No consumer needs
  // `Object.prototype` on this map.
  const result: Record<string, string> = Object.create(null);
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
