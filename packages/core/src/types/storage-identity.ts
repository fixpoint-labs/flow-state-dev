/**
 * Storage identity of a declared resource — which durable cell it occupies.
 *
 * One rule, used by both sides that need it: the engine's persistence path
 * (resource registry, routes, the cross-flow schema registry) and `defineFlow`'s
 * build-time collision check. Keeping a single implementation is the point: a
 * check that reasons about different cells than the ones written either misses
 * a real collision or invents one.
 *
 * - **Collections** are recognised **structurally** — any object with a string
 *   `pattern` — not by brand. A `defineResource` that happens to carry a
 *   `pattern` is routed down the collection branch. Every instance key is
 *   `resolveCollectionKey(pattern, key)`, so a collection's identity is its
 *   `pattern`; a `ref` on a collection is never read.
 * - **Single resources** key on their `ref` when set, otherwise on the first
 *   accessor a given definition object appears under — see `resourceStorageKeys`.
 */
import type { ResourceCollectionConfig } from "./resource-collection";

/** True when `value` is a collection config (has a string `pattern`). */
export function isCollectionConfig(
  value: unknown
): value is ResourceCollectionConfig {
  return (
    typeof value === "object" &&
    value !== null &&
    "pattern" in value &&
    typeof (value as ResourceCollectionConfig).pattern === "string"
  );
}

/**
 * Build the `accessor → storage key` mapping for a resource config map.
 *
 * Two accessors that point at the same `DefinedResource` object share a single
 * persisted slot. The canonical key is the config's `ref` when set, otherwise
 * the first accessor encountered in declaration order. Collections aren't
 * single-slot resources — their instances use pattern-derived keys — so
 * collection accessors map to themselves.
 *
 * ## Stability of the canonical key
 *
 * When `config.ref` is set, the canonical key is `ref` — stable across
 * deploys, refactors, and declaration-order changes. **Set `ref` explicitly on
 * `defineResource()` for any non-session-scoped resource you intend to
 * dual-register**: persisted user/org data only survives declaration
 * reshuffles if the storage key is anchored to a stable value rather than an
 * accessor name.
 *
 * Without `ref`, the canonical key is the first accessor encountered in
 * `Object.entries(configs)` order. For a single accessor this is the accessor
 * name itself (stable). For dual-registered aliases the chosen key depends on
 * how block-level resource declarations bubble up into `flow.resources` —
 * reorganising actions, swapping sibling blocks, or moving a declaration from
 * block-level to flow-level can shift it. For session-scoped resources this is
 * harmless (session storage is transient); for user/org scope it can orphan
 * data.
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
